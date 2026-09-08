import hashlib
import json
import platform
from pathlib import Path
import numpy as np
import mujoco
from PIL import Image, ImageDraw
from .tasks import get_task, ROOT
from .specs import config_for
from .rewards import make_reward
from .presentation import frame as presentation_frame, motion as presentation_motion

BASELINE = Path(__file__).resolve().parents[1] / "artifacts/stitch/policy.npz"


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def dump(path, value):
    Path(path).write_text(json.dumps(value, indent=2, allow_nan=False))


def render_frame(env, renderer, controller, task="stitch"):
    renderer.update_scene(env.data, camera="overview")
    if task == "stitch" and env.exited:
        sc = renderer.scene
        if sc.ngeom < sc.maxgeom:
            geom = sc.geoms[sc.ngeom]
            mujoco.mjv_initGeom(
                geom,
                mujoco.mjtGeom.mjGEOM_CAPSULE,
                np.zeros(3),
                np.zeros(3),
                np.eye(3).ravel(),
                np.array([0.8, 0.85, 0.9, 1], np.float32),
            )
            mujoco.mjv_connector(
                geom,
                mujoco.mjtGeom.mjGEOM_CAPSULE,
                0.00025,
                env.data.site("right_stitch").xpos,
                env.data.site("tail").xpos,
            )
            sc.ngeom += 1
    frame = Image.fromarray(renderer.render())
    draw = ImageDraw.Draw(frame)
    draw.rectangle((0, 0, 640, 28), fill=(12, 18, 24))
    draw.text(
        (12, 8),
        (
            f"{controller.upper()}  |  height {env.obj[2] * 1000:.1f} mm  |  placement {np.linalg.norm(env.obj[:2] - env.target[:2]) * 1000:.1f} mm"
            if task == "lifting"
            else f"{controller.upper()}  |  gap {env.gap * 1000:.2f} mm  |  tension {env.tension:.3f} N"
        ),
        fill=(226, 235, 239),
    )
    return np.asarray(frame)


def thumbnail(scenario, path):
    spec = get_task(scenario.get("task", "stitch"))
    env = spec.make_env()
    env.reset(config=config_for(scenario))
    dump(Path(path).with_suffix('.motion.json'), presentation_motion(
        env, spec.id, [presentation_frame(env, spec.id, 0.0)]))
    renderer = mujoco.Renderer(env.model, height=480, width=640)
    try:
        Image.fromarray(render_frame(env, renderer, "initial state", spec.id)).save(
            path
        )
    finally:
        renderer.close()


def rollout(
    scenario,
    episode,
    policy,
    output,
    controller="baseline",
    record=False,
    reward_weights=None,
    check=lambda: None,
):
    import imageio.v2 as imageio

    out = Path(output)
    out.mkdir(parents=True, exist_ok=True)
    spec = get_task(scenario.get("task", "stitch"))
    env = spec.make_env()
    config = config_for(scenario, episode)
    obs = env.reset(config=config)
    observations = [obs.copy()]
    states = [env.state()]
    actions = []
    frames = []
    motion_frames = [presentation_frame(env, spec.id, 0.0)] if record else []
    reward = make_reward(spec.id, reward_weights)
    total = 0.0
    renderer = writer = None
    try:
        if record:
            renderer = mujoco.Renderer(env.model, height=480, width=640)
            writer = imageio.get_writer(
                out / "rollout.mp4",
                fps=10,
                codec="libx264",
                quality=7,
                ffmpeg_params=["-movflags", "+faststart"],
            )
            frame = render_frame(env, renderer, controller, spec.id)
            Image.fromarray(frame).save(out / "thumbnail.jpg")
            writer.append_data(frame)
        frames.append(telemetry_frame(env, spec.id, 0.0, {}))
        for step in range(500):
            check()
            action = policy.act(obs)
            obs, _, done, truncated, info = env.step(action)
            r, terms = reward.compute(env, action, info)
            total += r
            observations.append(obs.copy())
            states.append(env.state())
            if record:
                motion_frames.append(presentation_frame(env, spec.id, round((step + 1) * 0.05, 3)))
            actions.append(action.copy())
            frames.append(
                telemetry_frame(env, spec.id, round((step + 1) * 0.05, 3), terms)
            )
            if writer and (step % 2 == 1 or done or truncated):
                writer.append_data(render_frame(env, renderer, controller, spec.id))
            if done or truncated:
                break
        if not all(np.isfinite(x).all() for x in [observations, states, actions]):
            raise ValueError("Non-finite simulation trajectory")
        np.savez_compressed(
            out / "trajectory.npz",
            observations=observations,
            states=states,
            actions=actions,
        )
        dump(out / "telemetry.json", dict(frames=frames))
        if record:
            dump(out / 'motion.json', presentation_motion(env, spec.id, motion_frames, policy.sha256, info))
        manifest = dict(
            schema="soren-rollout-v1",
            task=spec.id,
            task_version=spec.environment.VERSION,
            scenario=scenario,
            scene=config,
            controller=controller,
            checkpoint_sha256=policy.sha256,
            source_hashes={
                name: digest(ROOT / name)
                for name in [
                    f"{spec.module}/env.py",
                    "lab/tasks.py",
                    "lab/runtime.py",
                    "lab/rewards.py",
                    "lab/specs.py",
                ]
            },
            observation_names=spec.environment.OBS_NAMES,
            action_names=list(spec.actions),
            physics_hz=500,
            control_hz=20,
            video_fps=10,
            reward_weights=reward.weights,
            info=info,
            runtime=dict(
                mujoco=mujoco.__version__,
                numpy=np.__version__,
                python=platform.python_version(),
            ),
            note=spec.description
            + " Measured simulator trajectory. Training reward does not alter task success.",
        )
        dump(out / "manifest.json", manifest)
        return dict(info=info, reward_total=total, seed=config["seed"])
    finally:
        if writer:
            writer.close()
        if renderer:
            renderer.close()


class BaselinePolicy:
    def __init__(self, path=None, task="stitch"):
        spec = get_task(task)
        self.task = task
        self.policy = spec.make_policy(path)
        self.sha256 = digest(path or spec.baseline)

    def act(self, obs):
        return self.policy.act(obs)


def telemetry_frame(env, task, t, terms):
    if task == "lifting":
        phase = (
            "Settling"
            if env.released
            else "Transport"
            if env.cleared
            else "Lift"
            if env.attached
            else "Approach"
        )
        return dict(
            t=t,
            object_height_mm=float(env.obj[2] * 1000),
            placement_error_mm=float(
                np.linalg.norm(env.obj[:2] - env.target[:2]) * 1000
            ),
            attached=bool(env.attached),
            cleared=bool(env.cleared),
            released=bool(env.released),
            drops=env.drops,
            unwanted_collisions=env.unwanted,
            phase=phase,
            reward=terms,
        )
    phase = (
        "Closure"
        if env.clear
        else "Transfer"
        if env.caught
        else "Needle pass"
        if env.entered
        else "Approach"
    )
    return dict(
        t=t, gap_mm=env.gap * 1000, tension_n=env.tension, phase=phase, reward=terms
    )
