import json
import unittest
from pathlib import Path

import mujoco
import numpy as np

from lab.robot_presentation import fit_robot, robot_model


class RobotFingerPresentationTests(unittest.TestCase):
    def test_exported_finger_translations_match_mujoco_kinematics(self):
        motion = json.loads((Path(__file__).resolve().parents[1] / "public/motion/heart.json").read_text())
        indices = [next(i for i, g in enumerate(motion["geometry"]) if g["name"] == name)
                   for name in ("finger_l", "finger_r")]

        def separation(frame):
            left, right = [np.array(frame["poses"][i]["position_m"]) for i in indices]
            return np.linalg.norm(left - right)

        motion["frames"] = [motion["frames"][0], min(motion["frames"], key=separation), motion["frames"][-1]]
        fit = fit_robot(motion, "lifting")
        self.assertIsNotNone(fit)
        model = robot_model()
        data = mujoco.MjData(model)
        openings = []
        for source, exported in zip(motion["frames"], fit["frames"]):
            data.qpos[7:] = np.clip(separation(source) / 2 - .004, 0, .04)
            mujoco.mj_forward(model, data)
            nodes = {node["name"]: node for node in exported["nodes"]}
            for name in ("left_finger", "right_finger"):
                body = model.body(name).id
                parent = model.body_parentid[body]
                # Independent reference: world-space simulator poses converted to parent space.
                expected = data.xmat[parent].reshape(3, 3).T @ (data.xpos[body] - data.xpos[parent])
                np.testing.assert_allclose(nodes[name]["position"], expected, atol=1e-10)
            openings.append(np.linalg.norm(np.array(nodes["left_finger"]["position"]) - nodes["right_finger"]["position"]))
        self.assertGreater(openings[0] - openings[1], .01)
        self.assertGreater(openings[2] - openings[1], .01)
