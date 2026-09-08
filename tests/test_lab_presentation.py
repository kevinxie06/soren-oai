import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
from lab.presentation import frame, motion, restore_recording
from lab.runtime import BaselinePolicy, rollout
from lab.specs import config_for, template_plan, validate_plan
from lab.tasks import get_task


class LabPresentationTests(unittest.TestCase):
    def test_all_scenarios_preserve_their_geometry_and_parameters(self):
        for task in ["stitch", "lifting"]:
            plan = template_plan("Presentation test", task)
            for scenario in plan["scenarios"]:
                env = get_task(task).make_env()
                config = config_for(scenario)
                env.reset(config=config)
                before = env.state().copy()
                data = motion(env, task, [frame(env, task, 0)])
                np.testing.assert_array_equal(env.state(), before)
                self.assertEqual(data["scene"], config)
                self.assertEqual(len(data["geometry"]), len(data["frames"][0]["poses"]))
                self.assertEqual(data["duration_s"], 0)
                self.assertTrue(data["presentation_assets"]["recording_specific"])
                fit = data["presentation_assets"]["robot_motion"]
                self.assertIsNotNone(fit)
                self.assertEqual(len(fit["frames"]), 1)
                self.assertLess(fit["max_position_error_m"], .001)
                if task == "stitch":
                    self.assertAlmostEqual(data["frames"][0]["gap_m"], scenario["gap_mm"] / 1000)
                else:
                    np.testing.assert_allclose(data["frames"][0]["object_position_m"][:2],
                                               [scenario["object_x_mm"] / 1000, scenario["object_y_mm"] / 1000], atol=1e-7)
                scenario["motion"] = f"preview/{scenario['id']}.json"
            validate_plan(plan, task)

    def test_legacy_recordings_reconstruct_without_policy_or_physics_steps(self):
        for task in ["stitch", "lifting"]:
            with tempfile.TemporaryDirectory() as temporary:
                folder = Path(temporary)
                scenario = template_plan("Presentation test", task)["scenarios"][0]
                rollout(scenario, 0, BaselinePolicy(task=task), folder)
                manifest = json.loads((folder / "manifest.json").read_text())
                with np.load(folder / "trajectory.npz") as archive:
                    with patch("mujoco.mj_step", side_effect=AssertionError("Must not integrate physics")):
                        data = restore_recording(manifest, archive)
                    self.assertEqual(len(data["frames"]), len(archive["states"]))
                    legacy_manifest = dict(manifest)
                    legacy_manifest.pop("task")
                    if task == "stitch":
                        legacy = restore_recording(legacy_manifest, archive)
                        self.assertEqual(legacy["frames"], data["frames"])
                    self.assertEqual(data["result"]["success"], manifest["info"]["success"])
                    for index in [0, len(data["frames"]) // 2, len(data["frames"]) - 1]:
                        f = data["frames"][index]
                        obs = archive["observations"][index]
                        for pose in f["poses"]:
                            self.assertAlmostEqual(np.linalg.norm(pose["quaternion_wxyz"]), 1)
                        if task == "stitch":
                            np.testing.assert_allclose(f["tip"], obs[15:18], atol=1e-7)
                            np.testing.assert_allclose(f["jaws"], archive["states"][index, -6:].reshape(2, 3))
                            self.assertAlmostEqual(f["gap_m"], obs[32], places=7)
                        else:
                            np.testing.assert_allclose(f["object_position_m"], obs[3:6], atol=1e-7)
                            geom = next(i for i, g in enumerate(data["geometry"]) if g["name"] == "object_collision")
                            np.testing.assert_allclose(f["poses"][geom]["position_m"], f["object_position_m"])

    def test_recording_presentation_preserves_policy_results_and_saved_states(self):
        for task in ["stitch", "lifting"]:
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                scenario = template_plan("Presentation test", task)["scenarios"][0]
                policy = BaselinePolicy(task=task)
                plain = rollout(scenario, 0, policy, root / "plain")
                recorded = rollout(scenario, 0, policy, root / "recorded", record=True)
                self.assertEqual(plain, recorded)
                with np.load(root / "plain/trajectory.npz") as a, np.load(root / "recorded/trajectory.npz") as b:
                    for key in ["observations", "states", "actions"]:
                        np.testing.assert_array_equal(a[key], b[key])
                data = json.loads((root / "recorded/motion.json").read_text())
                self.assertEqual(data["result"]["success"], plain["info"]["success"])
                self.assertEqual(len(data["frames"]), plain["info"]["steps"] + 1)
                self.assertEqual(data["duration_s"], round(plain["info"]["steps"] / 20, 3))
