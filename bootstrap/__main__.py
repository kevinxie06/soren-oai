import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from .env import ExtractionEnv, OBS_NAMES, VERSION, DT, MAX_DELTA

def dump(path, value):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,indent=2))

def rollout(seed, policy=None, video=None, label=None):
    env=ExtractionEnv(); obs=env.reset(seed)
    if policy is not None and hasattr(policy,'reset'): policy.reset()
    if policy is None:
        from .teacher import Teacher
        teacher=Teacher()
    renderer=writer=None
    if video:
        import mujoco, imageio.v2 as imageio
        Path(video).parent.mkdir(parents=True,exist_ok=True)
        renderer=mujoco.Renderer(env.model,height=600,width=800)
        writer=imageio.get_writer(video,fps=20,macro_block_size=1)
    observations=[obs]; actions=[]; states=[env.state()]; labels=[]; stages=[]
    try:
        for _ in range(240):
            action=teacher.act(env) if policy is None else policy.act(obs)
            obs,_,done,truncated,info=env.step(action)
            observations.append(obs); actions.append(action); states.append(env.state())
            labels.append(info['termination']); stages.append(teacher.stage if policy is None else
                (policy.failure_baseline.stage if getattr(policy,'failure_baseline',None) else 'learned'))
            if renderer:
                from PIL import Image, ImageDraw
                renderer.update_scene(env.data,camera='overview')
                frame=Image.fromarray(renderer.render()); draw=ImageDraw.Draw(frame)
                draw.rectangle((0,0,800,30),fill='black')
                title=label or ('SCRIPTED TEACHER' if policy is None else 'LEARNED POLICY')
                draw.text((10,8),f'{title} | seed {seed} | step {env.steps} | {info["termination"]}',fill='white')
                writer.append_data(np.asarray(frame))
            if done or truncated: break
    finally:
        if writer: writer.close()
        if renderer: renderer.close()
    return dict(observations=np.array(observations),actions=np.array(actions),states=np.array(states),
                termination_labels=np.array(labels),teacher_stages=np.array(stages),seed=np.array(seed)),dict(**info,scene=env.config,simulator_version=VERSION)

def collect(args):
    from .teacher import VERSION as teacher_version
    out=Path(args.output); out.mkdir(parents=True,exist_ok=True)
    if list(out.glob('episode_*.npz')): raise ValueError('Use an empty dataset directory to prevent stale episodes')
    success=[]; failed=[]
    for seed in range(args.start_seed,args.start_seed+args.episodes):
        trajectory,meta=rollout(seed); meta['controller_version']=teacher_version
        if meta['success']:
            np.savez_compressed(out/f'episode_{seed:06d}.npz',**trajectory)
            dump(out/f'episode_{seed:06d}.json',meta); success.append(meta)
        else: failed.append(meta)
        if (seed-args.start_seed+1)%20==0: print(f'collected {len(success)} successes, {len(failed)} failures',flush=True)
    dump(out/'failures.json',failed)
    files=list(out.glob('episode_*.npz'))
    arrays=[np.load(f) for f in files]
    quality=dict(successful_episodes=len(success),failed_episodes=len(failed),
        frames=sum(len(d['actions']) for d in arrays),finite=all(np.isfinite(d['observations']).all() and np.isfinite(d['actions']).all() for d in arrays),
        bounded_actions=all(np.abs(d['actions']).max()<=1 for d in arrays),
        valid_boundaries=all(len(d['observations'])==len(d['actions'])+1 and d['termination_labels'][-1]=='success' for d in arrays),
        lengths=[len(d['actions']) for d in arrays],stages=sorted(set(s for d in arrays for s in d['teacher_stages'].tolist())),
        unwanted_collisions=sum(m['unwanted_collisions'] for m in success),drops=sum(m['drops'] for m in success))
    dump(out/'quality.json',quality); print(json.dumps({k:v for k,v in quality.items() if k!='lengths'},indent=2))

def evaluate(args):
    from .policy import Policy
    policy=Policy(args.checkpoint); result={}
    seeds=range(args.start_seed,args.start_seed+args.episodes)
    controllers=[('scripted',None),('learned',policy)]
    if args.baseline_checkpoint:
        controllers.append(('baseline',Policy(args.baseline_checkpoint)))
    for name,p in controllers:
        episodes=[rollout(s,p)[1] for s in seeds]
        result[name]=dict(successes=sum(e['success'] for e in episodes),episodes=len(episodes),
            success_rate=sum(e['success'] for e in episodes)/len(episodes),
            drops=sum(e['drops'] for e in episodes),unwanted_collisions=sum(e['unwanted_collisions'] for e in episodes),
            mean_placement_error_m=float(np.mean([e['placement_error'] for e in episodes])),rollouts=episodes)
        successful_errors=[e['placement_error'] for e in episodes if e['success']]
        result[name]['successful_mean_placement_error_m']=float(np.mean(successful_errors)) if successful_errors else None
        print(name, {k:v for k,v in result[name].items() if k!='rollouts'},flush=True)
    result['checkpoint']=args.checkpoint
    result['checkpoint_sha256']=hashlib.sha256(Path(args.checkpoint).read_bytes()).hexdigest()
    result['evaluation_seeds']=[args.start_seed,args.start_seed+args.episodes-1]
    if args.baseline_checkpoint:
        result['baseline_checkpoint']=args.baseline_checkpoint
        result['baseline_checkpoint_sha256']=hashlib.sha256(Path(args.baseline_checkpoint).read_bytes()).hexdigest()
    dump(args.output,result)

def main():
    parser=argparse.ArgumentParser(); sub=parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('preview'); p.add_argument('--seed',type=int,default=0); p.add_argument('--video',default='artifacts/scripted_rollout.mp4')
    p=sub.add_parser('collect'); p.add_argument('--episodes',type=int,default=120); p.add_argument('--start-seed',type=int,default=0); p.add_argument('--output',default='artifacts/demos')
    p=sub.add_parser('train'); p.add_argument('--dataset',default='artifacts/demos'); p.add_argument('--output',default='artifacts/policy.npz'); p.add_argument('--epochs',type=int,default=480); p.add_argument('--seed',type=int,default=7)
    p=sub.add_parser('evaluate'); p.add_argument('--checkpoint',default='artifacts/policy.npz'); p.add_argument('--episodes',type=int,default=50); p.add_argument('--start-seed',type=int,default=20000); p.add_argument('--output',default='artifacts/evaluation.json'); p.add_argument('--baseline-checkpoint')
    p=sub.add_parser('record'); p.add_argument('--checkpoint',default='artifacts/policy.npz'); p.add_argument('--seed',type=int,default=20000); p.add_argument('--video',default='artifacts/learned_rollout.mp4')
    args=parser.parse_args()
    if args.command=='collect': collect(args)
    elif args.command=='train':
        from .policy import train
        train(args.dataset,args.output,args.epochs,args.seed)
        dump(Path(args.output).with_suffix('.schema.json'),dict(observation=OBS_NAMES,observation_dtype='float32',
            action=['delta_x / 0.012m','delta_y / 0.012m','delta_z / 0.012m','close if >0 else open'],
            bounds=[-1,1],frame='world right-handed XYZ; Z up',control_hz=1/DT,orientation='fixed gripper identity; object quaternion wxyz',simulator=VERSION))
    elif args.command=='evaluate': evaluate(args)
    else:
        policy=None
        if args.command=='record':
            from .policy import Policy
            policy=Policy(args.checkpoint)
        _,meta=rollout(args.seed,policy,args.video); dump(Path(args.video).with_suffix('.json'),meta); print(json.dumps(meta,indent=2))

if __name__=='__main__': main()

