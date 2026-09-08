"""PPO actor initialized exactly from the existing NumPy behavior-cloning checkpoint."""

from pathlib import Path
import numpy as np
import gymnasium as gym
from gymnasium import spaces
import torch
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.policies import ActorCriticPolicy
from .tasks import get_task
from .specs import config_for
from .rewards import make_reward
from .runtime import digest, dump


class StitchGym(gym.Env):
    metadata = {"render_modes": []}

    def __init__(self, scenarios, reward):
        self.scenarios = scenarios
        self.task = get_task(scenarios[0].get("task", "stitch"))
        self.reward_fn = make_reward(self.task.id, reward)
        self.env = self.task.make_env()
        self.observation_space = spaces.Box(
            -np.inf, np.inf, (len(self.task.environment.OBS_NAMES),), np.float32
        )
        self.action_space = spaces.Box(-1, 1, (len(self.task.actions),), np.float32)
        with np.load(self.task.baseline) as ck:
            self.mean = ck["mean"].copy()
            self.std = ck["std"].copy()

    def normalized(self, obs):
        return ((obs - self.mean) / self.std).astype(np.float32)

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        s = self.scenarios[int(self.np_random.integers(len(self.scenarios)))]
        self.reward_fn.reset()
        obs = self.env.reset(config=config_for(s, training=True, rng=self.np_random))
        return self.normalized(obs), {}

    def step(self, action):
        obs, _, done, truncated, info = self.env.step(action)
        reward, terms = self.reward_fn.compute(self.env, action, info)
        info = {**info, "reward_terms": terms, "is_success": info["success"]}
        return self.normalized(obs), float(reward), bool(done), bool(truncated), info


class WarmStartPolicy(ActorCriticPolicy):
    def __init__(self, *args, task="stitch", **kwargs):
        kwargs.update(
            net_arch=dict(pi=[64, 64], vf=[64, 64]),
            activation_fn=torch.nn.Tanh,
            ortho_init=False,
            log_std_init=-3.0,
        )
        super().__init__(*args, **kwargs)
        with np.load(get_task(task).baseline) as ck, torch.no_grad():
            for index, layer in enumerate(
                [
                    self.mlp_extractor.policy_net[0],
                    self.mlp_extractor.policy_net[2],
                    self.action_net,
                ]
            ):
                layer.weight.copy_(torch.from_numpy(ck[f"w{index}"].T.copy()))
                layer.bias.copy_(torch.from_numpy(ck[f"b{index}"]))


class CandidatePolicy:
    def __init__(self, path, task=None):
        self.model = PPO.load(path, device="cpu")
        self.task = self.model.soren_metadata.get("task", "stitch")
        if task is not None and task != self.task:
            raise ValueError("Checkpoint task mismatch")
        self.sha256 = digest(path)
        # Frozen normalization travels in the checkpoint, independent of later baseline changes.
        self.mean = np.asarray(self.model.soren_mean, np.float32)
        self.std = np.asarray(self.model.soren_std, np.float32)

    def act(self, obs):
        action = self.model.predict((obs - self.mean) / self.std, deterministic=True)[
            0
        ].astype(np.float32)
        if self.task == "lifting":
            action[3] = 1.0 if action[3] > 0 else -1.0
        return action


class TrainingProgress(BaseCallback):
    def __init__(self, budget, progress, check, start=0):
        super().__init__()
        self.budget = budget
        self.progress = progress
        self.check = check
        self.history = []
        self.start = start

    def _on_step(self):
        self.check()
        if self.num_timesteps % 256 == 0:
            self.progress(
                (self.num_timesteps - self.start) / self.budget,
                f"PPO: {self.num_timesteps - self.start:,} / {self.budget:,} new transitions",
            )
        for info in self.locals.get("infos", []):
            if "episode" in info:
                self.history.append(
                    dict(
                        step=self.num_timesteps,
                        return_value=float(info["episode"]["r"]),
                        length=int(info["episode"]["l"]),
                        success=bool(info.get("success")),
                    )
                )
        return True


def train(scenarios, reward, steps, seed, output, progress, check, resume=None):
    from stable_baselines3.common.monitor import Monitor

    torch.set_num_threads(1)
    env = Monitor(StitchGym(scenarios, reward))
    # Recheck import parity before any optimizer update; action clipping matches the original.
    model = (
        PPO.load(resume, env=env, device="cpu")
        if resume
        else PPO(
            WarmStartPolicy,
            env,
            policy_kwargs={"task": env.unwrapped.task.id},
            n_steps=256,
            batch_size=64,
            n_epochs=4,
            learning_rate=1e-5,
            seed=seed,
            device="cpu",
            verbose=0,
            target_kl=0.02,
        )
    )
    source = env.unwrapped
    from .runtime import BaselinePolicy

    baseline = BaselinePolicy(task=source.task.id)
    if resume:
        if model.soren_metadata.get("task", "stitch") != source.task.id:
            raise ValueError("Checkpoint task mismatch")
        source.mean = np.asarray(model.soren_mean, np.float32)
        source.std = np.asarray(model.soren_std, np.float32)
    probe = (
        np.random.default_rng(seed)
        .normal(size=(32, len(source.mean)))
        .astype(np.float32)
    )
    with torch.no_grad():
        predicted = model.predict(probe, deterministic=True)[0]
    expected = np.array([baseline.act(p * source.std + source.mean) for p in probe])
    if source.task.id == "lifting":
        predicted[:, 3] = np.where(predicted[:, 3] > 0, 1, -1)
    if not resume and not np.allclose(predicted, expected, atol=2e-5):
        raise AssertionError("Checkpoint migration failed action parity")
    model.soren_mean = source.mean
    model.soren_std = source.std
    model.soren_metadata = dict(
        schema="soren-ppo-v1",
        task=source.task.id,
        parent_sha256=digest(resume) if resume else baseline.sha256,
        reward=reward,
        seed=seed,
        scenarios=scenarios,
        training_seeds="random seeds >=1100000000; evaluation seeds <1000000000",
    )
    start = model.num_timesteps if resume else 0
    callback = TrainingProgress(steps, progress, check, start)
    try:
        model.learn(
            total_timesteps=steps,
            callback=callback,
            reset_num_timesteps=not bool(resume),
        )
        out = Path(output)
        out.mkdir(parents=True, exist_ok=True)
        model.save(out / "policy.zip")
        report = dict(
            algorithm="PPO",
            task=source.task.id,
            steps=model.num_timesteps,
            requested_steps=steps,
            seed=seed,
            checkpoint_sha256=digest(out / "policy.zip"),
            parent_sha256=digest(resume) if resume else baseline.sha256,
            resumed=bool(resume),
            previous_steps=start,
            new_steps=model.num_timesteps - start,
            reward=reward,
            history=callback.history,
            action_parity_verified=True,
            learning_rate=1e-5,
            n_steps=256,
            batch_size=64,
            n_epochs=4,
            observation_normalization="frozen baseline statistics saved in checkpoint",
        )
        dump(out / "training.json", report)
        return report
    finally:
        env.close()
