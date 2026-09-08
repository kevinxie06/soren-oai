"""Convert attributed Panda meshes and fit its joints to the recorded tool path.

Presentation IK only: this does not retrain or validate the Panda as a controller.
"""
import hashlib
import argparse
import json
from pathlib import Path
import struct
import mujoco
import numpy as np

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', default='public/motion/heart.json')
    parser.add_argument('--output', default='public/models/robot/panda.glb')
    args = parser.parse_args()
    source = ROOT / args.source
    motion = json.loads(source.read_text())
    model = mujoco.MjModel.from_xml_path(str(ROOT / "artifacts/asset-source/panda/panda.xml"))
    model.body_pos[model.body("link0").id] = [.65, -.28, -.12]
    model.body_quat[model.body("link0").id] = [0, 0, 0, 1]
    data = mujoco.MjData(model)
    data.qpos[:7] = [0, -.5, 0, -2.2, 0, 1.7, .8]
    hand = model.body("hand").id
    desired_rotation = np.array([[0., 1, 0], [1, 0, 0], [0, 0, -1]])
    desired_quat = np.zeros(4)
    mujoco.mju_mat2Quat(desired_quat, desired_rotation.flatten())
    jp, jr = np.zeros((3, model.nv)), np.zeros((3, model.nv))
    indices = {g["name"]: i for i, g in enumerate(motion["geometry"])}
    angles, errors, rotations = [], [], []
    for frame in motion["frames"]:
        palm = np.array(frame["poses"][indices["palm"]]["position_m"])
        target = palm + [0, 0, .0384]
        for _ in range(160):
            mujoco.mj_forward(model, data)
            position_error = target - data.xpos[hand]
            orientation_error = np.zeros(3)
            mujoco.mju_subQuat(orientation_error, desired_quat, data.xquat[hand])
            # subQuat is in the local frame of the second quaternion.
            orientation_error = data.xmat[hand].reshape(3, 3) @ orientation_error
            if np.linalg.norm(position_error) < 1e-6 and np.linalg.norm(orientation_error) < 1e-5:
                break
            mujoco.mj_jacBody(model, data, jp, jr, hand)
            jac = np.vstack([jp[:, :7], jr[:, :7] * .35])
            error = np.r_[position_error, orientation_error * .35]
            delta = jac.T @ np.linalg.solve(jac @ jac.T + np.eye(6) * 1e-5, error)
            data.qpos[:7] += np.clip(delta, -.12, .12)
            data.qpos[:7] = np.clip(data.qpos[:7], model.jnt_range[:7, 0] + .001, model.jnt_range[:7, 1] - .001)
        left = np.array(frame["poses"][indices["finger_l"]]["position_m"])
        right = np.array(frame["poses"][indices["finger_r"]]["position_m"])
        data.qpos[7:] = np.clip(np.linalg.norm(left - right) / 2 - .004, 0, .04)
        mujoco.mj_forward(model, data)
        angles.append(data.qpos.copy())
        errors.append(float(np.linalg.norm(target - data.xpos[hand])))
        rotations.append(float(np.linalg.norm(orientation_error)))
    if max(errors) > .001 or max(rotations) > .01:
        raise RuntimeError(f"IK fit failed: position={max(errors)}, orientation={max(rotations)}")
    gltf = dict(asset={"version": "2.0", "generator": "Soren Panda presentation conversion; Apache-2.0 source"},
                scene=0, scenes=[{"nodes": [0]}], nodes=[], meshes=[], materials=[], bufferViews=[], accessors=[])
    binary = bytearray()
    def accessor(array, kind, component=5126):
        array = np.asarray(array, dtype=np.float32 if component == 5126 else np.uint32)
        while len(binary) % 4: binary.append(0)
        offset = len(binary); binary.extend(array.tobytes())
        view = len(gltf["bufferViews"])
        gltf["bufferViews"].append(dict(buffer=0, byteOffset=offset, byteLength=array.nbytes))
        entry = dict(bufferView=view, componentType=component, count=len(array), type=kind)
        if kind in ("VEC3", "SCALAR"):
            entry.update(min=np.atleast_1d(array.min(axis=0)).tolist(), max=np.atleast_1d(array.max(axis=0)).tolist())
        gltf["accessors"].append(entry)
        return len(gltf["accessors"]) - 1
    for mat in range(model.nmat):
        color = model.mat_rgba[mat].tolist()
        if model.material(mat).name == "black": color = [.045, .055, .06, 1]
        gltf["materials"].append(dict(name=model.material(mat).name, pbrMetallicRoughness={
            "baseColorFactor": color, "metallicFactor": .18, "roughnessFactor": .28}))
    mujoco.mj_resetData(model, data); mujoco.mj_forward(model, data)
    for body in range(1, model.nbody):
        q = model.body_quat[body]
        gltf["nodes"].append(dict(name=model.body(body).name, translation=model.body_pos[body].tolist(),
                                  rotation=[*q[1:], q[0]], children=[]))
        parent = model.body_parentid[body]
        if parent: gltf["nodes"][parent - 1]["children"].append(body - 1)
    for geom in range(model.ngeom):
        if model.geom_group[geom] != 2: continue
        mesh = model.geom_dataid[geom]
        va, fa, na = model.mesh_vertadr[mesh], model.mesh_faceadr[mesh], model.mesh_normaladr[mesh]
        count = model.mesh_facenum[mesh]
        pairs = np.stack([model.mesh_face[fa:fa+count].flatten(), model.mesh_facenormal[fa:fa+count].flatten()], axis=1)
        unique, inverse = np.unique(pairs, axis=0, return_inverse=True)
        positions = model.mesh_vert[va + unique[:, 0]]
        normals = model.mesh_normal[na + unique[:, 1]]
        primitive = dict(attributes={"POSITION": accessor(positions, "VEC3"), "NORMAL": accessor(normals, "VEC3")},
                         indices=accessor(inverse, "SCALAR", 5125), material=int(model.geom_matid[geom]))
        mi = len(gltf["meshes"]); gltf["meshes"].append({"primitives": [primitive]})
        q = model.geom_quat[geom]
        ni = len(gltf["nodes"])
        gltf["nodes"].append(dict(name=f"visual_{geom}", mesh=mi, translation=model.geom_pos[geom].tolist(), rotation=[*q[1:], q[0]]))
        gltf["nodes"][model.geom_bodyid[geom] - 1]["children"].append(ni)
    animation = dict(name="Recorded tool path — presentation IK", samplers=[], channels=[])
    times = accessor([f["time_s"] for f in motion["frames"]], "SCALAR")
    angles = np.array(angles)
    for joint in range(model.njnt):
        body = model.jnt_bodyid[joint]
        outputs = []
        slide = model.jnt_type[joint] == mujoco.mjtJoint.mjJNT_SLIDE
        for qpos in angles:
            if slide:
                # Joint axes are body-local; glTF translations are parent-local.
                # The right finger's mount rotates its slide axis by 180 degrees.
                axis = np.zeros(3)
                mujoco.mju_rotVecQuat(axis, model.jnt_axis[joint], model.body_quat[body])
                outputs.append(model.body_pos[body] + axis * qpos[joint])
            else:
                delta, result = np.zeros(4), np.zeros(4)
                mujoco.mju_axisAngle2Quat(delta, model.jnt_axis[joint], qpos[joint])
                mujoco.mju_mulQuat(result, model.body_quat[body], delta)
                outputs.append([*result[1:], result[0]])
        output = accessor(outputs, "VEC3" if slide else "VEC4")
        animation["channels"].append(dict(sampler=len(animation["samplers"]), target=dict(node=int(body - 1), path="translation" if slide else "rotation")))
        animation["samplers"].append(dict(input=times, output=output, interpolation="LINEAR"))
    gltf["animations"] = [animation]
    gltf["buffers"] = [{"byteLength": len(binary)}]
    json_bytes = json.dumps(gltf, separators=(",", ":")).encode()
    json_bytes += b" " * (-len(json_bytes) % 4)
    binary.extend(b"\0" * (-len(binary) % 4))
    output = ROOT / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(struct.pack("<III", 0x46546c67, 2, 28 + len(json_bytes) + len(binary)) +
                       struct.pack("<II", len(json_bytes), 0x4e4f534a) + json_bytes +
                       struct.pack("<II", len(binary), 0x004e4942) + binary)
    report = dict(source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(), sample_count=len(angles),
                  max_position_error_m=max(errors), max_orientation_error_rad=max(rotations),
                  joint_limits_satisfied=True, base_position_m=model.body_pos[1].tolist(),
                  note="Kinematic presentation fit only. Collisions, dynamics and hardware suitability are not validated.")
    report_path = output.parent / 'fit-report.json' if output.name == 'panda.glb' else output.with_suffix('.fit.json')
    report_path.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))

if __name__ == "__main__":
    main()
