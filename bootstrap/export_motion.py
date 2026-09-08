"""Export a measured learned rollout for browser and Unreal playback."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import mujoco
import numpy as np
from .env import ExtractionEnv,DT
from .policy import Policy
from .__main__ import rollout


def unreal_pose(position, wxyz):
    w,x,y,z=map(float,wxyz)
    return dict(location_cm=[100*float(position[0]),-100*float(position[1]),100*float(position[2])],
                quaternion_xyzw=[-x,y,-z,w])


def export_motion(checkpoint,seed,output):
    trajectory,result=rollout(seed,Policy(checkpoint))
    env=ExtractionEnv(); env.reset(seed); model=env.model
    snapshot=mujoco.MjData(model)
    geometry=[]
    for i in range(model.ngeom):
        shape={0:'plane',2:'sphere',4:'ellipsoid',6:'box'}.get(int(model.geom_type[i]))
        if shape is None: raise ValueError(f'Unsupported geometry {model.geom_type[i]}')
        geometry.append(dict(id=i,name=model.geom(i).name or f'visual_{i}',body=model.body(int(model.geom_bodyid[i])).name or 'world',
            shape=shape,half_size_m=model.geom_size[i].tolist(),rgba=model.geom_rgba[i].tolist(),dynamic=bool(model.geom_bodyid[i])))
    frames=[]
    for index,state in enumerate(trajectory['states']):
        snapshot.qpos[:]=state[:model.nq]
        snapshot.qvel[:]=state[model.nq:model.nq+model.nv]
        mujoco.mj_forward(model,snapshot)
        poses=[]
        for i in range(model.ngeom):
            q=np.zeros(4); mujoco.mju_mat2Quat(q,snapshot.geom_xmat[i])
            p=snapshot.geom_xpos[i]
            poses.append(dict(position_m=p.tolist(),quaternion_wxyz=q.tolist(),unreal=unreal_pose(p,q)))
        o=trajectory['observations'][index]
        flags=dict(closed=bool(o[21]),attached=bool(o[22]),cleared=bool(o[23]),released=bool(o[24]))
        frames.append(dict(time_s=index*DT,joint_positions=state[:5].tolist(),object_position_m=o[3:6].tolist(),
                           gripper_position_m=o[:3].tolist(),state=flags,poses=poses))
        phases={'align_miss':'Move beside heart','open_above_miss':'Open gripper','approach':'Descend beside heart',
                'close_empty':'Close on empty space','lift_empty':'Lift empty gripper','transfer_empty':'Empty transfer to tray',
                'lower_empty':'Lower empty gripper','release_empty':'Release over tray','retract_empty':'Retract empty gripper',
                'empty_attempt_complete':'Empty attempt complete'}
        stage=str(trajectory['teacher_stages'][max(0,index-1)])
        if stage in phases: frames[-1]['demonstration_phase']=phases[stage]
    # Decorative context is deliberately separate from the physics geometry.
    context=[
        dict(name='operating_table',shape='box',position_m=[0,.1,-.20],half_size_m=[.25,.65,.045],color='#475d6b'),
        dict(name='patient_torso',shape='ellipsoid',position_m=[0,.06,-.085],half_size_m=[.18,.33,.085],color='#b88978'),
        dict(name='patient_head',shape='ellipsoid',position_m=[0,.49,-.075],half_size_m=[.085,.11,.085],color='#b88978'),
        dict(name='drape_left',shape='box',position_m=[-.16,.08,-.005],half_size_m=[.065,.40,.008],color='#246b78'),
        dict(name='drape_right',shape='box',position_m=[.16,.08,-.005],half_size_m=[.065,.40,.008],color='#246b78'),
        dict(name='drape_lower',shape='box',position_m=[0,-.30,-.005],half_size_m=[.095,.20,.008],color='#246b78'),
        dict(name='drape_upper',shape='box',position_m=[0,.29,-.005],half_size_m=[.095,.19,.008],color='#246b78'),
        dict(name='instrument_stand',shape='box',position_m=[*result['scene']['tray_xy'],-.08],half_size_m=[.105,.105,.025],color='#647985')]
    payload=dict(schema_version='soren.motion.v1',policy_kind='learned',renderer_source='MuJoCo',task='detached_heart_extraction',
        seed=seed,checkpoint_sha256=hashlib.sha256(Path(checkpoint).read_bytes()).hexdigest(),sample_hz=20,
        duration_s=frames[-1]['time_s'],source_coordinates='right-handed XYZ, Z-up, meters; quaternion wxyz',
        unreal_coordinates='left-handed XYZ, Z-up, centimeters; reflect Y; quaternion xyzw=(-x,y,-z,w)',
        joints=[dict(name=model.joint(i).name,unit='m',type='prismatic') for i in range(5)],
        geometry=geometry,frames=frames,presentation_context=context,result=result,
        limitations=['assisted grasp','rigid already-detached object','fixed-orientation Cartesian gantry','decorative patient has no tissue physics'])
    output=Path(output); output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(payload,separators=(',',':'),allow_nan=False))
    return payload



def write_captions(data, path):
    def label(frame):
        if frame.get('demonstration_phase'): return frame['demonstration_phase']
        state=frame['state']
        return ('Release and settle' if state['released'] else 'Transfer to tray' if state['cleared']
                else 'Lift clear' if state['attached'] else 'Grasp' if state['closed'] else 'Approach')
    def stamp(t):
        ms=round(t*1000)
        return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02}.{ms%1000:03}'
    lines=['WEBVTT','']; start=0; previous=label(data['frames'][0])
    for frame in data['frames'][1:]:
        current=label(frame); end=max(0,frame['time_s']-DT)
        if current!=previous:
            if end>start: lines.extend([f'{stamp(start)} --> {stamp(end)}',previous,''])
            start=end; previous=current
    lines.extend([f'{stamp(start)} --> {stamp(data["duration_s"])}',previous,''])
    Path(path).write_text('\n'.join(lines),encoding='utf-8')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--checkpoint',default='artifacts/policy_recovery.npz'); p.add_argument('--seed',type=int,default=30000)
    p.add_argument('--output',default='public/motion/heart.json'); p.add_argument('--video',action='store_true')
    a=p.parse_args(); data=export_motion(a.checkpoint,a.seed,a.output)
    if a.video:
        _,result=rollout(a.seed,Policy(a.checkpoint),str(Path(a.output).with_suffix('.mp4')))
        if result!=data['result']: raise RuntimeError('Export/video rollout results differ')
        write_captions(data,Path(a.output).with_suffix('.vtt'))
    print(json.dumps(dict(frames=len(data['frames']),duration_s=data['duration_s'],result=data['result']),indent=2))

if __name__=='__main__': main()
