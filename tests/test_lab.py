import copy
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
import numpy as np
from lab.specs import template_plan, validate_plan, config_for, validate_reward
from lab.rewards import Reward
from lab.runtime import BaselinePolicy, rollout


class ExperimentTests(unittest.TestCase):
    def setUp(self):
        self.plan = template_plan("Improve closure stability")

    def test_exact_distinct_bounded_scenarios(self):
        self.assertEqual(len(self.plan["scenarios"]), 16)
        bad = copy.deepcopy(self.plan)
        bad["scenarios"][1] = copy.deepcopy(bad["scenarios"][0])
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            validate_plan(bad)
        for value in [float("nan"), float("inf"), 11, -1, True]:
            bad = copy.deepcopy(self.plan)
            bad["scenarios"][0]["gap_mm"] = value
            with self.assertRaises(ValueError):
                validate_plan(bad)
        bad = copy.deepcopy(self.plan)
        bad["scenarios"].pop()
        with self.assertRaisesRegex(ValueError, "16"):
            validate_plan(bad)

    def test_reproducible_paired_configs_and_separate_training_seeds(self):
        scenario = self.plan["scenarios"][3]
        self.assertEqual(config_for(scenario, 2), config_for(scenario, 2))
        self.assertNotEqual(
            config_for(scenario, 2)["center"], config_for(scenario, 3)["center"]
        )
        for _ in range(20):
            c = config_for(scenario, training=True)
            self.assertGreaterEqual(c["seed"], 1_100_000_000)
            self.assertTrue(
                0.006 <= c["gap"] <= 0.01 and 65 <= c["tissue_stiffness"] <= 85
            )

    def test_reward_cannot_pay_for_idle_early_closure_or_repeated_milestones(self):
        reward = Reward()
        env = SimpleNamespace(
            gap=0.001, config={"gap": 0.008}, clear=False, caught=False, donor=True
        )
        info = dict(
            success=False,
            termination="running",
            entered=False,
            exited=False,
            caught=False,
            needle_clear=False,
        )
        action = np.zeros(7)
        self.assertEqual(reward.compute(env, action, info)[0], 0)
        info["entered"] = True
        self.assertGreater(reward.compute(env, action, info)[1]["milestones"], 0)
        self.assertEqual(reward.compute(env, action, info)[1]["milestones"], 0)
        info.update(success=True, termination="success")
        self.assertGreater(reward.compute(env, action, info)[1]["completion"], 0)
        self.assertEqual(reward.compute(env, action, info)[1]["completion"], 0)

    def test_reward_schema_and_untrusted_extra_term(self):
        bad = dict(self.plan["reward"], eval="os.system")
        with self.assertRaises(ValueError):
            validate_reward(bad)
        bad = dict(self.plan["reward"], completion=-3)
        with self.assertRaises(ValueError):
            validate_reward(bad)

    def test_runtime_manifest_matches_executed_trajectory(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = rollout(self.plan["scenarios"][0], 0, BaselinePolicy(), tmp)
            folder = Path(tmp)
            manifest = json.loads((folder / "manifest.json").read_text())
            telemetry = json.loads((folder / "telemetry.json").read_text())
            with np.load(folder / "trajectory.npz") as data:
                self.assertEqual(len(data["observations"]), len(data["actions"]) + 1)
                self.assertEqual(len(telemetry["frames"]), len(data["observations"]))
                self.assertEqual(result["info"]["steps"], len(data["actions"]))
                self.assertTrue(np.isfinite(data["actions"]).all())
            self.assertEqual(manifest["info"], result["info"])
            self.assertEqual(manifest["checkpoint_sha256"], BaselinePolicy().sha256)


class RLTests(unittest.TestCase):
    def test_gym_seeded_reset_and_real_optimizer_checkpoint_reload(self):
        from lab.rl import StitchGym, train, CandidatePolicy
        from stable_baselines3.common.env_checker import check_env

        plan = template_plan("Closure robustness")
        env = StitchGym(plan["scenarios"], plan["reward"])
        check_env(env)
        first, _ = env.reset(seed=123)
        second, _ = env.reset(seed=123)
        np.testing.assert_array_equal(first, second)
        with tempfile.TemporaryDirectory() as tmp:
            report = train(
                plan["scenarios"],
                plan["reward"],
                1024,
                7,
                tmp,
                lambda *_: None,
                lambda: None,
            )
            self.assertEqual(report["steps"], 1024)
            self.assertTrue(report["action_parity_verified"])
            self.assertEqual(report["schema"], "soren-training-v2")
            self.assertEqual([row["step"] for row in report["updates"]], [256, 512, 768, 1024])
            self.assertGreater(report["actor_parameter_delta_l2"], 0)
            self.assertEqual(report["gamma"], 0.99)
            self.assertEqual(report["clip_range"], 0.2)
            for row in report["updates"]:
                self.assertGreaterEqual(row["approx_kl"], 0)
                self.assertTrue(0 <= row["clip_fraction"] <= 1)
                self.assertTrue(np.isfinite(list(row.values())).all())
            for episode in report["history"]:
                self.assertAlmostEqual(
                    sum(episode["reward_terms"].values()), episode["return_value"], places=4
                )
            candidate = CandidatePolicy(Path(tmp) / "policy.zip")
            original = BaselinePolicy()
            raw = first * env.std + env.mean
            action = candidate.act(raw)
            self.assertEqual(action.shape, (7,))
            self.assertTrue(np.isfinite(action).all())
            self.assertLessEqual(np.abs(action).max(), 1)
            # Assert the actual trained tensors changed; a copied baseline cannot pass.
            weights = candidate.model.policy.action_net.weight.detach().numpy()
            self.assertGreater(
                float(np.max(np.abs(weights - original.policy.model.params["w2"].T))),
                1e-8,
            )
            again = CandidatePolicy(Path(tmp) / "policy.zip")
            np.testing.assert_array_equal(action, again.act(raw))
            resumed_dir = Path(tmp) / "resumed"
            resumed = train(
                plan["scenarios"],
                plan["reward"],
                1024,
                19,
                resumed_dir,
                lambda *_: None,
                lambda: None,
                resume=Path(tmp) / "policy.zip",
            )
            self.assertEqual(resumed["steps"], 2048)
            self.assertEqual(resumed["previous_steps"], 1024)
            self.assertEqual(resumed["parent_sha256"], report["checkpoint_sha256"])
            self.assertEqual(resumed["seed"], 19)
            self.assertEqual([row["step"] for row in resumed["updates"]], [1280, 1536, 1792, 2048])
            self.assertGreater(resumed["actor_parameter_delta_l2"], 0)
            loaded = CandidatePolicy(resumed_dir / "policy.zip")
            self.assertEqual(loaded.model.seed, 19)
            persisted = json.loads((resumed_dir / "training.json").read_text())
            self.assertEqual(persisted["updates"], resumed["updates"])


if __name__ == "__main__":
    unittest.main()
