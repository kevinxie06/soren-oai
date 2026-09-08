import copy
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
import numpy as np
from lab.specs import (
    template_plan,
    validate_plan,
    planner_schema,
    config_for,
    validate_reward,
)
from lab.runtime import BaselinePolicy, rollout
from lab.rewards import LiftingReward
from lab.tasks import get_task


class LiftingExperiments(unittest.TestCase):
    def setUp(self):
        self.plan = template_plan("Improve reliable lifting and placement", "lifting")

    def test_bounded_task_specific_generation_and_legacy_compatibility(self):
        self.assertEqual(len(self.plan["scenarios"]), 16)
        schema = planner_schema("lifting")["properties"]
        self.assertIn("object_yaw_deg", schema["scenarios"]["items"]["properties"])
        self.assertNotIn("gap_mm", schema["scenarios"]["items"]["properties"])
        for key, value in [
            ("object_x_mm", 23),
            ("tray_x_mm", 200),
            ("object_yaw_deg", float("nan")),
            ("object_y_mm", True),
            ("seed", True),
            ("mass", 1),
        ]:
            bad = copy.deepcopy(self.plan)
            bad["scenarios"][0][key] = value
            with self.assertRaises(ValueError):
                validate_plan(bad, "lifting")
        with self.assertRaisesRegex(ValueError, "task"):
            validate_plan(self.plan, "stitch")
        with self.assertRaises(ValueError):
            template_plan("Unsupported task", "unknown")
        with self.assertRaises(ValueError):
            validate_reward(template_plan("Closure")["reward"], "lifting")
        legacy = template_plan("Closure")
        del legacy["task"]
        for s in legacy["scenarios"]:
            del s["task"]
        self.assertEqual(validate_plan(legacy)["task"], "stitch")

    def test_repeats_pair_seeded_gripper_variation_and_validate_all_native_scenes(self):
        for s in self.plan["scenarios"]:
            first, second = config_for(s, 0), config_for(s, 1)
            self.assertEqual(first, config_for(s, 0))
            self.assertEqual(first["object_xy"], second["object_xy"])
            self.assertEqual(first["tray_xy"], second["tray_xy"])
            self.assertNotEqual(first["ee_xy"], second["ee_xy"])
            env = get_task("lifting").make_env()
            obs = env.reset(config=first)
            self.assertEqual(obs.shape, (32,))
            self.assertTrue(np.isfinite(obs).all())
            trained = config_for(s, training=True, rng=np.random.default_rng(3))
            self.assertGreaterEqual(trained["seed"], 1_100_000_000)
            self.assertTrue(np.all(np.abs(trained["object_xy"]) <= 0.022))

    def test_real_lifting_rollout_artifacts_match_metrics_and_checkpoint(self):
        policy = BaselinePolicy(task="lifting")
        with tempfile.TemporaryDirectory() as tmp:
            result = rollout(self.plan["scenarios"][0], 0, policy, tmp)
            folder = Path(tmp)
            manifest = json.loads((folder / "manifest.json").read_text())
            frames = json.loads((folder / "telemetry.json").read_text())["frames"]
            with np.load(folder / "trajectory.npz") as data:
                self.assertEqual(data["observations"].shape[1], 32)
                self.assertEqual(data["actions"].shape[1], 4)
                self.assertEqual(len(frames), len(data["actions"]) + 1)
                self.assertEqual(set(np.unique(data["actions"][:, 3])), {-1, 1})
            self.assertTrue(result["info"]["success"])
            self.assertTrue(result["info"]["cleared"] and result["info"]["released"])
            self.assertEqual(manifest["task"], "lifting")
            self.assertEqual(manifest["task_version"], "gantry-v1")
            self.assertEqual(manifest["checkpoint_sha256"], policy.sha256)
            self.assertEqual(manifest["info"], result["info"])
            self.assertAlmostEqual(
                frames[-1]["placement_error_mm"],
                result["info"]["placement_error"] * 1000,
            )
            self.assertNotIn("gap_mm", frames[0])
            self.assertGreater(max(f["object_height_mm"] for f in frames), 105)

    def test_lifting_reward_does_not_pay_for_idle_or_repeated_events(self):
        reward = LiftingReward()
        env = SimpleNamespace(
            attached=False,
            config=dict(object_xy=[0, 0], tray_xy=[0.3, 0]),
            in_tray=lambda: False,
        )
        info = dict(
            success=False,
            termination="running",
            cleared=False,
            released=False,
            placement_error=0.3,
        )
        action = np.zeros(4)
        self.assertEqual(reward.compute(env, action, info)[0], 0)
        info["placement_error"] = 0.01
        self.assertEqual(reward.compute(env, action, info)[1]["placement"], 0)
        env.attached = True
        self.assertGreater(reward.compute(env, action, info)[1]["milestones"], 0)
        self.assertEqual(reward.compute(env, action, info)[1]["milestones"], 0)
        info["cleared"] = True
        self.assertGreater(reward.compute(env, action, info)[1]["placement"], 0)
        info["placement_error"] = 0.3
        self.assertLess(reward.compute(env, action, info)[1]["placement"], 0)
        info.update(success=True, termination="success")
        self.assertGreater(reward.compute(env, action, info)[1]["completion"], 0)
        self.assertEqual(reward.compute(env, action, info)[1]["completion"], 0)

    def test_actual_ppo_preserves_action_contract_and_rejects_wrong_task_checkpoint(
        self,
    ):
        from lab.rl import StitchGym, train, CandidatePolicy
        from stable_baselines3.common.env_checker import check_env

        env = StitchGym(self.plan["scenarios"], self.plan["reward"])
        check_env(env)
        obs, _ = env.reset(seed=33)
        raw = obs * env.std + env.mean
        with tempfile.TemporaryDirectory() as tmp:
            report = train(
                self.plan["scenarios"],
                self.plan["reward"],
                1024,
                7,
                tmp,
                lambda *_: None,
                lambda: None,
            )
            candidate = CandidatePolicy(Path(tmp) / "policy.zip", task="lifting")
            self.assertEqual(report["task"], "lifting")
            self.assertTrue(report["action_parity_verified"])
            action = candidate.act(raw)
            self.assertEqual(action.shape, (4,))
            self.assertIn(action[3], [-1, 1])
            self.assertTrue(np.isfinite(action).all())
            original = BaselinePolicy(task="lifting")
            weights = candidate.model.policy.action_net.weight.detach().numpy()
            self.assertGreater(
                np.max(np.abs(weights - original.policy.model.params["w2"].T)), 1e-8
            )
            again = CandidatePolicy(Path(tmp) / "policy.zip")
            np.testing.assert_array_equal(action, again.act(raw))
            with self.assertRaisesRegex(ValueError, "task mismatch"):
                CandidatePolicy(Path(tmp) / "policy.zip", task="stitch")
            resumed = train(
                self.plan["scenarios"],
                self.plan["reward"],
                1024,
                7,
                Path(tmp) / "resumed",
                lambda *_: None,
                lambda: None,
                resume=Path(tmp) / "policy.zip",
            )
            self.assertEqual(resumed["steps"], 2048)
            self.assertEqual(resumed["parent_sha256"], report["checkpoint_sha256"])
