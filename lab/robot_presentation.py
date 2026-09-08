"""Fit the shared Panda mesh to each measured tool path (presentation only).

Uses the same damped inverse kinematics as build-stitch-robot.py and
build-robot-presentation.py. No policy, physics stepping, or asset downloads.
"""
from functools import lru_cache
from pathlib import Path
import mujoco
import numpy as np


@lru_cache(maxsize=1)
def robot_model():
    model = mujoco.MjModel.from_xml_path(str(Path(__file__).parent / "assets/panda-kinematics.xml"))
    model.body_pos[model.body("link0").id] = [.65, -.28, -.12]
    model.body_quat[model.body("link0").id] = [0, 0, 0, 1]
    return model


def fit_robot(motion, task):
    model = robot_model()
    data = mujoco.MjData(model)
    data.qpos[:7] = [0, -.5, 0, -2.2, 0, 1.7, .8]
    hand = model.body("hand").id
    rotation = np.array([[0., 1, 0], [1, 0, 0], [0, 0, -1]])
    quat = np.zeros(4)
    mujoco.mju_mat2Quat(quat, rotation.ravel())
    jp, jr = np.zeros((3, model.nv)), np.zeros((3, model.nv))
    indices = {g["name"]: i for i, g in enumerate(motion["geometry"])}
    frames, errors = [], []
    for f in motion["frames"]:
        target = (np.array(f["center"]) + [0, -.10, .16] if task == "stitch" else
                  np.array(f["poses"][indices["palm"]]["position_m"]) + [0, 0, .0384])
        for _ in range(200):
            mujoco.mj_forward(model, data)
            dp, dr = target - data.xpos[hand], np.zeros(3)
            mujoco.mju_subQuat(dr, quat, data.xquat[hand])
            dr = data.xmat[hand].reshape(3, 3) @ dr
            if np.linalg.norm(dp) < 1e-6 and np.linalg.norm(dr) < 1e-5:
                break
            mujoco.mj_jacBody(model, data, jp, jr, hand)
            jac = np.vstack([jp[:, :7], jr[:, :7] * .35])
            delta = jac.T @ np.linalg.solve(jac @ jac.T + np.eye(6) * 1e-5, np.r_[dp, dr * .35])
            data.qpos[:7] = np.clip(data.qpos[:7] + np.clip(delta, -.12, .12),
                                   model.jnt_range[:7, 0] + .001, model.jnt_range[:7, 1] - .001)
        if task == "stitch":
            data.qpos[7:] = .012
        else:
            left, right = [np.array(f["poses"][indices[name]]["position_m"]) for name in ["finger_l", "finger_r"]]
            data.qpos[7:] = np.clip(np.linalg.norm(left - right) / 2 - .004, 0, .04)
        mujoco.mj_forward(model, data)
        error = float(np.linalg.norm(target - data.xpos[hand]))
        if error > .001 or np.linalg.norm(dr) > .01:
            # Keep the measured instrument view for paths the presentation robot cannot reach.
            return None
        errors.append(error)
        nodes = []
        for j in range(model.njnt):
            b = model.jnt_bodyid[j]
            p, q = model.body_pos[b].copy(), model.body_quat[b].copy()
            if model.jnt_type[j] == mujoco.mjtJoint.mjJNT_SLIDE:
                # Convert the body-local slide axis to the parent frame used by Three.js.
                axis = np.zeros(3)
                mujoco.mju_rotVecQuat(axis, model.jnt_axis[j], model.body_quat[b])
                p += axis * data.qpos[j]
            else:
                delta = np.zeros(4)
                mujoco.mju_axisAngle2Quat(delta, model.jnt_axis[j], data.qpos[j])
                mujoco.mju_mulQuat(q, model.body_quat[b], delta)
            nodes.append(dict(name=model.body(b).name, position=p.tolist(), quaternion_xyzw=[*q[1:], q[0]]))
        frames.append(dict(nodes=nodes, hand_position=data.xpos[hand].tolist()))
    return dict(frames=frames, seed=motion["seed"], checkpoint_sha256=motion["checkpoint_sha256"],
                max_position_error_m=max(errors),
                note="Presentation IK only; not a robot controller or a collision-validated motion plan.")
