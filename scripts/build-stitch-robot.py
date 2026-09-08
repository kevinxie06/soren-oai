"""Fit the existing Panda presentation mesh to a suturing tool-carrier pose.

This is presentation IK, not a robot policy or collision-validated motion plan.
The carrier is offset above/behind the recorded needle center, leaving the
opposing-jaw mechanism visible. The heart animation is never reused.
"""
import hashlib
import argparse
import json
from pathlib import Path
import mujoco
import numpy as np


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--source',default='public/motion/stitch.json');parser.add_argument('--output',default='public/motion/stitch-robot.json')
    args=parser.parse_args()
    source=Path(args.source); motion=json.loads(source.read_text())
    model=mujoco.MjModel.from_xml_path('artifacts/asset-source/panda/panda.xml')
    model.body_pos[model.body('link0').id]=[.65,-.28,-.12]
    model.body_quat[model.body('link0').id]=[0,0,0,1]
    data=mujoco.MjData(model);data.qpos[:7]=[0,-.5,0,-2.2,0,1.7,.8]
    hand=model.body('hand').id; rotation=np.array([[0.,1,0],[1,0,0],[0,0,-1]])
    quat=np.zeros(4);mujoco.mju_mat2Quat(quat,rotation.ravel())
    jp,jr=np.zeros((3,model.nv)),np.zeros((3,model.nv));frames=[];errors=[]
    offset=np.array([0,-.10,.16])
    for f in motion['frames']:
        target=np.array(f['center'])+offset
        for _ in range(200):
            mujoco.mj_forward(model,data);dp=target-data.xpos[hand];dr=np.zeros(3)
            mujoco.mju_subQuat(dr,quat,data.xquat[hand]);dr=data.xmat[hand].reshape(3,3)@dr
            if np.linalg.norm(dp)<1e-6 and np.linalg.norm(dr)<1e-5:break
            mujoco.mj_jacBody(model,data,jp,jr,hand);jac=np.vstack([jp[:,:7],jr[:,:7]*.35])
            delta=jac.T@np.linalg.solve(jac@jac.T+np.eye(6)*1e-5,np.r_[dp,dr*.35])
            data.qpos[:7]=np.clip(data.qpos[:7]+np.clip(delta,-.12,.12),model.jnt_range[:7,0]+.001,model.jnt_range[:7,1]-.001)
        data.qpos[7:]=.012;mujoco.mj_forward(model,data)
        error=float(np.linalg.norm(target-data.xpos[hand]));errors.append(error)
        if error>.001 or np.linalg.norm(dr)>.01:raise RuntimeError(f'IK failed {error}')
        nodes=[]
        for j in range(model.njnt):
            b=model.jnt_bodyid[j];p=model.body_pos[b].copy();q=model.body_quat[b].copy()
            if model.jnt_type[j]==mujoco.mjtJoint.mjJNT_SLIDE:p+=model.jnt_axis[j]*data.qpos[j]
            else:
                delta=np.zeros(4);mujoco.mju_axisAngle2Quat(delta,model.jnt_axis[j],data.qpos[j]);mujoco.mju_mulQuat(q,model.body_quat[b],delta)
            nodes.append(dict(name=model.body(b).name,position=p.tolist(),quaternion_xyzw=[*q[1:],q[0]]))
        frames.append(dict(time_s=f['time_s'],nodes=nodes,hand_position=data.xpos[hand].tolist()))
    result=dict(schema_version='soren.robot-fit.v1',source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                checkpoint_sha256=motion['result']['checkpoint_sha256'],seed=motion['scene']['seed'],sample_hz=20,
                carrier_offset_m=offset.tolist(),max_position_error_m=max(errors),joint_limits_satisfied=True,
                note='Presentation IK only. Does not validate robot dynamics, collisions, instrument mechanism, or surgical capability.',frames=frames)
    out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(result,separators=(',',':')))
    print(f'Exported {len(frames)} robot poses; maximum position error {max(errors)*1000:.6f} mm')


if __name__=='__main__':main()
