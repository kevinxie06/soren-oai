import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from .env import StitchEnv, OBS_NAMES, DELTA, VERSION
from .policy import Policy


def dump(path,obj):
    p=Path(path); p.parent.mkdir(parents=True,exist_ok=True); p.write_text(json.dumps(obj,indent=2))


def rollout(seed,policy=None,video=None,noise=0,label=None):
    env=StitchEnv(); obs=env.reset(seed); rng=np.random.default_rng(seed+900000)
    if policy is None:
        from .teacher import Teacher
        teacher=Teacher()
    observations=[obs]; states=[env.state()]; actions=[]; targets=[]; labels=[]; renderer=writer=None
    if video:
        import mujoco,imageio.v2 as imageio
        Path(video).parent.mkdir(parents=True,exist_ok=True)
        renderer=mujoco.Renderer(env.model,height=720,width=960); writer=imageio.get_writer(video,fps=20)
    try:
        for _ in range(500):
            expert=teacher.act(env) if policy is None else policy.act(obs); action=expert.copy()
            if noise and rng.random()<.35 and not env.clear:
                action[:4]=np.clip(action[:4]+rng.normal(0,[noise,noise,noise,noise*.1]),-1,1)
            if noise and env.clear and rng.random()<.35:
                action[6]=np.clip(action[6]+rng.normal(0,.05),-1,1)
            obs,_,done,truncated,info=env.step(action)
            observations.append(obs); states.append(env.state()); actions.append(action); targets.append(expert); labels.append(info['termination'])
            if renderer:
                from PIL import Image,ImageDraw
                renderer.update_scene(env.data,camera='overview')
                # Render trailing filament from measured tail to tissue exit after emergence.
                if env.exited:
                    sc=renderer.scene; geom=sc.geoms[sc.ngeom]
                    mujoco.mjv_initGeom(geom,mujoco.mjtGeom.mjGEOM_CAPSULE,np.zeros(3),np.zeros(3),np.eye(3).ravel(),np.array([.12,.16,.22,1],np.float32))
                    mujoco.mjv_connector(geom,mujoco.mjtGeom.mjGEOM_CAPSULE,.00025,env.data.site('right_stitch').xpos,env.data.site('tail').xpos)
                    sc.ngeom+=1
                frame=Image.fromarray(renderer.render()); draw=ImageDraw.Draw(frame)
                draw.rectangle((0,0,960,66),fill='black')
                phase='TENSION / CLOSE' if env.clear else 'RECEIVER PULL' if env.caught else 'DRIVE / RECEIVE'
                title=label or ('SCRIPTED' if policy is None else 'LEARNED POLICY')
                draw.text((12,8),f'{title} | {phase} | wound gap {env.gap*1000:.2f} mm',fill='white')
                draw.text((12,28),f'entry {env.entered} | exit {env.exited} | caught {env.caught} | donor {env.donor} | receiver {env.receiver}',fill='white')
                draw.text((12,48),'Simplified puncture + assisted jaws + tensioned thread surrogate / no knot',fill='white')
                writer.append_data(np.asarray(frame))
            if done or truncated: break
    finally:
        if writer: writer.close()
        if renderer: renderer.close()
    trajectory=dict(observations=np.array(observations),states=np.array(states),actions=np.array(actions),expert_actions=np.array(targets),termination_labels=np.array(labels),seed=seed)
    if policy is not None:
        del trajectory['expert_actions']
    return trajectory,dict(**info,scene=env.config,task_version=VERSION,noise=noise,noise_seed=seed+900000,controller='scripted' if policy is None else 'learned')


def main():
    parser=argparse.ArgumentParser(); sub=parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('preview'); p.add_argument('--seed',type=int,default=0); p.add_argument('--video',default='artifacts/stitch/scripted.mp4')
    p=sub.add_parser('collect'); p.add_argument('--episodes',type=int,default=200); p.add_argument('--start-seed',type=int,default=0); p.add_argument('--noise',type=float,default=.20); p.add_argument('--output',default='artifacts/stitch/demos')
    p=sub.add_parser('train'); p.add_argument('--dataset',default='artifacts/stitch/demos_feedback'); p.add_argument('--output',default='artifacts/stitch/policy.npz'); p.add_argument('--epochs',type=int,default=300)
    p=sub.add_parser('evaluate'); p.add_argument('--checkpoint',default='artifacts/stitch/policy.npz'); p.add_argument('--start-seed',type=int,default=30000); p.add_argument('--episodes',type=int,default=100); p.add_argument('--output',default='artifacts/stitch/evaluation_feedback.json')
    p=sub.add_parser('record'); p.add_argument('--checkpoint',default='artifacts/stitch/policy.npz'); p.add_argument('--seed',type=int,default=30000); p.add_argument('--video',default='artifacts/stitch/learned.mp4')
    args=parser.parse_args()
    if args.command=='collect':
        from .teacher import VERSION as teacher_version
        out=Path(args.output); out.mkdir(parents=True,exist_ok=True)
        if list(out.glob('episode_*.npz')): raise ValueError('Use an empty dataset directory')
        failed=[]; count=frames=0
        for seed in range(args.start_seed,args.start_seed+args.episodes):
            trajectory,m=rollout(seed,noise=args.noise); m['teacher_version']=teacher_version
            if m['success']:
                assert np.isfinite(trajectory['observations']).all() and np.isfinite(trajectory['states']).all()
                assert np.abs(trajectory['actions']).max()<=1 and np.abs(trajectory['expert_actions']).max()<=1
                assert len(trajectory['observations'])==len(trajectory['actions'])+1
                np.savez_compressed(out/f'episode_{seed:06d}.npz',**trajectory); dump(out/f'episode_{seed:06d}.json',m)
                count+=1; frames+=len(trajectory['actions'])
            else: failed.append(m)
            if (seed-args.start_seed+1)%20==0: print(count,'successes',len(failed),'failures',flush=True)
        dump(out/'failures.json',failed); dump(out/'quality.json',dict(successful_episodes=count,failed_episodes=len(failed),frames=frames,finite=True,bounded=True,valid_boundaries=True))
    elif args.command=='train':
        from bootstrap.policy import train
        train(args.dataset,args.output,args.epochs,7,'continuous',std_floor=.001)
        dump(Path(args.output).with_suffix('.schema.json'),dict(task=VERSION,observations=OBS_NAMES,actions=['dx','dy','dz','dtheta','donor_closure','receiver_closure','tension'],bounds=[-1,1],movement_scale=DELTA.tolist(),control_hz=20,physics_hz=500,frame='world XYZ meters; angle radians about negative Y',jaw_mapping='(action+1)/2 closure; proximity-guarded assisted latches',tension_mapping='max(0,action)*0.6 newtons; active only after pass, catch, donor release, and clearance'))
    elif args.command=='evaluate':
        result={}
        for name,p in [('scripted',None),('learned',Policy(args.checkpoint))]:
            episodes=[rollout(seed,p)[1] for seed in range(args.start_seed,args.start_seed+args.episodes)]
            good=[e for e in episodes if e['success']]
            result[name]=dict(successes=len(good),episodes=len(episodes),success_rate=len(good)/len(episodes),
                catches=sum(e['caught'] for e in episodes),lost_needles=sum(e['termination']=='lost_needle' for e in episodes),
                unwanted_collisions=sum(e['unwanted_collisions'] for e in episodes),
                mean_final_gap_m=float(np.mean([e['wound_gap_m'] for e in episodes])),rollouts=episodes)
            print(name,{k:v for k,v in result[name].items() if k!='rollouts'},flush=True)
        result['checkpoint_sha256']=hashlib.sha256(Path(args.checkpoint).read_bytes()).hexdigest(); result['seed_range']=[args.start_seed,args.start_seed+args.episodes-1]; dump(args.output,result)
    else:
        trajectory,result=rollout(args.seed,None if args.command=='preview' else Policy(args.checkpoint),args.video)
        if args.command=='record': result['checkpoint_sha256']=hashlib.sha256(Path(args.checkpoint).read_bytes()).hexdigest()
        np.savez_compressed(Path(args.video).with_suffix('.npz'),**trajectory); dump(Path(args.video).with_suffix('.json'),result); print(json.dumps(result,indent=2))


if __name__=='__main__': main()
