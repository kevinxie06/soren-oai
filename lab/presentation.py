"""Presentation data sampled from the live simulator, without a second rollout."""
import mujoco
import numpy as np


def geometry(env):
    model = env.model
    return [dict(
        name=model.geom(i).name or f"visual_{i}",
        shape=mujoco.mjtGeom(int(model.geom_type[i])).name.removeprefix("mjGEOM_").lower(),
        half_size_m=model.geom_size[i].tolist(), rgba=model.geom_rgba[i].tolist(),
        dynamic=bool(model.geom_bodyid[i]),
    ) for i in range(model.ngeom)]


def frame(env, task, time):
    snapshot = mujoco.MjData(env.model)
    snapshot.qpos[:] = env.data.qpos
    snapshot.mocap_pos[:] = env.data.mocap_pos
    snapshot.mocap_quat[:] = env.data.mocap_quat
    mujoco.mj_kinematics(env.model, snapshot)
    poses = []
    for i in range(env.model.ngeom):
        q = np.zeros(4)
        mujoco.mju_mat2Quat(q, snapshot.geom_xmat[i])
        poses.append(dict(position_m=snapshot.geom_xpos[i].tolist(), quaternion_wxyz=q.tolist()))
    if task == "lifting":
        return dict(time_s=time, poses=poses, joint_positions=env.data.qpos[:5].tolist(),
                    object_position_m=env.obj.tolist(), state=dict(
                        closed=bool(env.closed), attached=bool(env.attached),
                        cleared=bool(env.cleared), released=bool(env.released)))
    return dict(time_s=time, poses=poses, center=env.q[:3].tolist(), theta=float(env.q[3]),
                tip=snapshot.site("tip").xpos.tolist(), tail=snapshot.site("tail").xpos.tolist(),
                jaws=env.data.mocap_pos.tolist(), closure=env.closure.tolist(),
                anchors=[snapshot.site(n).xpos.tolist() for n in ["left_stitch", "right_stitch"]],
                gap_m=float(env.gap), tension_n=float(env.tension),
                phase="Closure" if env.clear else "Transfer" if env.caught else "Needle pass" if env.entered else "Approach",
                entered=bool(env.entered), exited=bool(env.exited), caught=bool(env.caught),
                donor_holding=bool(env.donor), receiver_holding=bool(env.receiver), needle_clear=bool(env.clear))


def motion(env, task, frames, checkpoint="", result=None):
    payload = dict(schema_version="soren.motion.v1" if task == "lifting" else "soren.stitch.v1",
                   sample_hz=20, duration_s=frames[-1]["time_s"], geometry=geometry(env), frames=frames,
                   presentation_assets=dict(recording_specific=True),
                   result=dict(result or {}, checkpoint_sha256=checkpoint),
                   scene=env.config, seed=env.config["seed"], checkpoint_sha256=checkpoint,
                   presentation_context=[], evaluation=None)
    from .robot_presentation import fit_robot
    payload["presentation_assets"]["robot_motion"] = fit_robot(payload, task)
    return payload


def restore_recording(manifest, archive):
    """Reconstruct saved states with mj_forward only; never integrate physics."""
    from .tasks import get_task
    task = manifest.get("task", manifest.get("scenario", {}).get("task", "stitch"))
    env = get_task(task).make_env()
    if task == "lifting":
        from bootstrap.env import xml
        # Build kinematics without reset's settling simulation.
        env.config = manifest["scene"]
        env.model = mujoco.MjModel.from_xml_string(xml(env.config))
        env.data = mujoco.MjData(env.model)
        env.obj_q = env.model.joint("object").qposadr[0]
    else:
        env.reset(config=manifest["scene"])
    states, observations = archive["states"], archive["observations"]
    if len(states) != len(observations) or len(states) != len(archive["actions"]) + 1:
        raise ValueError("Invalid recorded episode boundaries")
    frames = []
    nq, nv, nu = env.model.nq, env.model.nv, env.model.nu
    for i, (state, obs) in enumerate(zip(states, observations)):
        env.data.qpos[:] = state[:nq]
        env.data.qvel[:] = state[nq:nq + nv]
        if task == "lifting":
            for name, value in zip(["closed", "attached", "cleared", "released"], obs[21:25]):
                setattr(env, name, bool(value))
        else:
            env.data.ctrl[:] = state[nq + nv:nq + nv + nu]
            env.closure = state[nq + nv + nu:nq + nv + nu + 2].copy()
            env.data.mocap_pos[:] = state[-6:].reshape(2, 3)
            for j, name in enumerate(["donor", "receiver"]):
                for suffix, sign in [("a", -1), ("b", 1)]:
                    env.model.geom(f"{name}_finger_{suffix}").pos[1] = sign * (.0022 + .0025 * (1 - env.closure[j]))
            for name, value in zip(["entered", "exited", "caught", "donor", "receiver"], obs[24:29]):
                setattr(env, name, bool(value))
            env.tension = float(obs[36])
        mujoco.mj_forward(env.model, env.data)
        frames.append(frame(env, task, i * .05))
    return motion(env, task, frames, manifest["checkpoint_sha256"], manifest["info"])


def backfill_one(client):
    """Upgrade one legacy preview/recording while the worker is otherwise idle."""
    import io
    from .tasks import get_task
    from .specs import config_for
    target = client.request("/worker/presentation")
    if not target:
        return False
    if target["kind"] == "scenario":
        scenario = target["scenario"]
        task = scenario.get("task", "stitch")
        env = get_task(task).make_env()
        env.reset(config=config_for(scenario))
        data = motion(env, task, [frame(env, task, 0.0)])
    else:
        manifest = client.request("/artifacts/" + target["run"]["manifest"])
        blob = client.request("/artifacts/" + target["run"]["trajectory"])
        with np.load(io.BytesIO(blob), allow_pickle=False) as archive:
            data = restore_recording(manifest, archive)
    client.request("/worker/presentation", dict(target=target, motion=data))
    return True
