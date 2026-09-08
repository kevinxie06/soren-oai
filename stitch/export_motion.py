"""Export saved, measured suturing states for Three.js; never rerun the teacher."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import mujoco
import numpy as np
from .env import StitchEnv, OBS_NAMES


def export(source='artifacts/stitch/learned',output='public/motion/stitch.json'):
    source=Path(source); meta=json.loads(source.with_suffix('.json').read_text())
    if meta.get('controller')!='learned': raise ValueError('Expected a learned-policy recording')
    with np.load(source.with_suffix('.npz'),allow_pickle=False) as archive:
        states=archive['states']; obs=archive['observations']; actions=archive['actions']
        if len(states)!=len(actions)+1 or len(obs)!=len(states): raise ValueError('Invalid episode boundaries')
        env=StitchEnv(); env.reset(config=meta['scene']); frames=[]
        for i,(state,o) in enumerate(zip(states,obs)):
            nq,nv,nu=env.model.nq,env.model.nv,env.model.nu
            env.data.qpos[:]=state[:nq]; env.data.qvel[:]=state[nq:nq+nv]
            env.data.ctrl[:]=state[nq+nv:nq+nv+nu]
            closure=state[nq+nv+nu:nq+nv+nu+2]
            env.data.mocap_pos[:]=state[-6:].reshape(2,3)
            for j,name in enumerate(['donor','receiver']):
                for suffix,sign in [('a',-1),('b',1)]:
                    env.model.geom(f'{name}_finger_{suffix}').pos[1]=sign*(.0022+.0025*(1-closure[j]))
            mujoco.mj_forward(env.model,env.data)
            poses=[]
            for g in range(env.model.ngeom):
                quaternion=np.zeros(4); mujoco.mju_mat2Quat(quaternion,env.data.geom_xmat[g])
                poses.append(dict(position_m=env.data.geom_xpos[g].tolist(),quaternion_wxyz=quaternion.tolist()))
            values=dict(zip(OBS_NAMES,o.tolist()))
            flags={key:bool(values[key]) for key in ['entered','exited','caught','donor_holding','receiver_holding','needle_clear']}
            phase='Tension & close' if flags['needle_clear'] else 'Receive & pull through' if flags['caught'] else 'Catch the needle' if flags['exited'] else 'Drive across wound' if flags['entered'] else 'Align needle'
            frames.append(dict(time_s=i*.05,center=env.q[:3].tolist(),theta=float(env.q[3]),
                tip=env.tip.tolist(),tail=env.data.site('tail').xpos.tolist(),
                jaws=env.data.mocap_pos.tolist(),closure=closure.tolist(),
                anchors=[env.data.site(n).xpos.tolist() for n in ['left_stitch','right_stitch']],
                gap_m=values['wound_gap'],tension_n=values['tension_n'],phase=phase,poses=poses,**flags))
    report=Path('artifacts/stitch/evaluation_feedback.json')
    evaluation=json.loads(report.read_text()) if report.exists() else None
    if evaluation and evaluation['checkpoint_sha256']!=meta['checkpoint_sha256']: evaluation=None
    result=dict(schema_version='soren.stitch.v1',sample_hz=20,duration_s=len(actions)*.05,
        scene=meta['scene'],result=meta,frames=frames,
        geometry=[dict(name=env.model.geom(g).name or f'geom_{g}',shape=mujoco.mjtGeom(int(env.model.geom_type[g])).name.removeprefix('mjGEOM_').lower(),half_size_m=env.model.geom_size[g].tolist(),rgba=env.model.geom_rgba[g].tolist()) for g in range(env.model.ngeom)],
        evaluation={k:v for k,v in evaluation['learned'].items() if k!='rollouts'} if evaluation else None,
        provenance=dict(source_npz=str(source.with_suffix('.npz')),trajectory_sha256=hashlib.sha256(source.with_suffix('.npz').read_bytes()).hexdigest(),
            checkpoint_sha256=meta['checkpoint_sha256'],coordinates='right-handed world XYZ, Z up, meters; unwrapped angle about -Y',
            measured=['needle pose','jaw mount positions','jaw closure','wound gap','tension','grasp flags'],
            presentation_only=['skin shape, pore detail and shading','forceps handles and serrations','drapes','smooth filament path','lights and cameras']))
    out=Path(output); out.parent.mkdir(parents=True,exist_ok=True); out.write_text(json.dumps(result,separators=(',',':')))
    shutil.copy2(source.with_suffix('.mp4'),out.with_suffix('.mp4'))
    duration=len(actions)*.05
    end=f'{int(duration//3600):02d}:{int(duration//60)%60:02d}:{duration%60:06.3f}'
    out.with_suffix('.vtt').write_text(f'WEBVTT\n\n00:00:00.000 --> {end}\nLearned policy: needle pass, receiving jaw catch, and wound closure under tension. Simplified simulation; no knot.\n')
    print(f'Exported {len(frames)} measured states to {out}')
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--source',default='artifacts/stitch/learned'); parser.add_argument('--output',default='public/motion/stitch.json')
    args=parser.parse_args(); export(args.source,args.output)
