import tempfile
import unittest
from pathlib import Path
import numpy as np
from lab.manual import replay
from lab.specs import template_plan, config_for
from lab.tasks import get_task
from lab.runtime import BaselinePolicy


class ManualTests(unittest.TestCase):
    def test_native_movement_and_replay(self):
        for task in ["lifting", "stitch"]:
            scenario = template_plan("Manual correction test", task)["scenarios"][0]
            action = [1, 0, 0, -1] if task == "lifting" else [1, 0, 0, 0, 1, -1, 0]
            with tempfile.TemporaryDirectory() as folder:
                path = Path(folder)
                result = replay(scenario, [action] * 5, path, render=False)
                with np.load(path / "correction.npz") as data:
                    obs = data["observations"].copy()
                    np.testing.assert_array_equal(data["actions"], [action] * 5)
                    self.assertTrue(data["manual"].all())
                self.assertGreater(float(np.linalg.norm(obs[-1] - obs[0])), 0)
                self.assertFalse(result["info"]["success"])
                again = replay(scenario, [action] * 5, path, render=False)
                self.assertEqual(result, again)
                with np.load(path / "correction.npz") as data:
                    np.testing.assert_array_equal(obs, data["observations"])

    def test_success_is_measured_and_prefix_excluded(self):
        scenario = template_plan("Manual success test", "lifting")["scenarios"][0]
        env = get_task("lifting").make_env()
        obs = env.reset(config=config_for(scenario, 0))
        policy = BaselinePolicy(task="lifting")
        commands = []
        for i in range(500):
            action = policy.act(obs)
            commands.append(None if i < 10 else action.tolist())
            obs, _, done, truncated, info = env.step(action)
            if done or truncated:
                break
        self.assertTrue(info["success"])
        with tempfile.TemporaryDirectory() as folder:
            result = replay(scenario, commands, Path(folder), render=False)
            self.assertTrue(result["info"]["success"])
            self.assertEqual(result["manual_steps"], len(commands) - 10)
            with np.load(Path(folder) / "correction.npz") as data:
                self.assertFalse(data["manual"][:10].any())
                self.assertTrue(data["manual"][10:].all())

    def test_invalid_actions_rejected(self):
        scenario = template_plan("Manual validation", "lifting")["scenarios"][0]
        with tempfile.TemporaryDirectory() as folder:
            for commands in [[], [None] * 501, [[0] * 7], [[float("nan"), 0, 0, 0]], [[2, 0, 0, 0]]]:
                with self.assertRaises(ValueError):
                    replay(scenario, commands, Path(folder), render=False)

    def test_correction_is_consumed_by_training(self):
        from lab.rl import train
        scenario = template_plan("Manual training test", "lifting")["scenarios"][0]
        reward = get_task("lifting").reward_defaults.copy()
        reward["placement"] = 4.0
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            # Explicit synthetic operator targets test the optimizer, not success attribution.
            replay(scenario, [[0.2, 0, 0, -1]] * 5, path, render=False)
            report = train([scenario], reward, 256, 7, path / "trained",
                           lambda *_: None, lambda: None, correction=path / "correction.npz")
            self.assertEqual(report["operator_correction"]["samples"], 5)
            self.assertLess(report["operator_correction"]["final_loss"], report["operator_correction"]["initial_loss"])
            self.assertEqual(report["reward"]["placement"], 4)
            self.assertGreater(report["actor_parameter_delta_l2"], 0)
            self.assertTrue((path / "trained" / "policy.zip").exists())
