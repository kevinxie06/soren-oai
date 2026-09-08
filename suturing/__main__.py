import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from .env import NeedleDriveEnv,OBS_NAMES,DELTA,VERSION,DT
from .policy import Policy


def dump(path,value):
    p=Path(path); p.parent.mkdir(parents=True,exist_ok=True); p.write_text(json.dumps(value,indent=2))


def rollout(seed,policy=None,video=None):
    env=NeedleDriveEnv(); obs=env.reset(seed)
    if policy is None:
        from .teacher import Teacher
        teacher=Teacher()
    observations=[obs]; actions=[]; states=[env.state()]; labels=[]; renderer=writer=None
    if video:
        import mujoco,imageio.v2 as imageio
        # Visualization only: expose the needle while it is below the surface.
        for geom_id in range(env.model.ngeom):
            if env.model.geom(geom_id).name.startswith('pad_'):
                env.model.geom_rgba[geom_id,3]=.35
        Path(video).parent.mkdir(parents=True,exist_ok=True)
        renderer=mujoco.Renderer(env.model,height=720,width=960); writer=imageio.get_writer(video,fps=20)
    try:
        for _ in range(400):
            action=teacher.act(env) if policy is None else policy.act(obs)
            obs,_,done,truncated,info=env.step(action)
            observations.append(obs); actions.append(action); states.append(env.state()); labels.append(info['termination'])
            if renderer:
                from PIL import Image,ImageDraw
                renderer.update_scene(env.data,camera='overview'); frame=Image.fromarray(renderer.render()); draw=ImageDraw.Draw(frame)
                draw.rectangle((0,0,960,48),fill='black')
                draw.text((12,8),f'{"SCRIPTED TEACHER" if policy is None else "LEARNED POLICY"} | curved needle drive | seed {seed} | step {env.steps}',fill='white')
                draw.text((12,28),f'Transparent pad / pre-cut channel / no puncture or thread | entry {env.entered} | exit {env.exited} | {info["termination"]}',fill='white')
                writer.append_data(np.asarray(frame))
            if done or truncated: break
    finally:
        if writer: writer.close()
        if renderer: renderer.close()
    return dict(observations=np.array(observations),actions=np.array(actions),states=np.array(states),termination_labels=np.array(labels),seed=np.array(seed)),dict(**info,scene=env.config,simulator_version=VERSION)


def collect(args):
    from .teacher import VERSION as teacher_version
    out=Path(args.output); out.mkdir(parents=True,exist_ok=True)
    if list(out.glob('episode_*.npz')): raise ValueError('Use an empty collection directory')
    success=[]; failed=[]
    for seed in range(args.start_seed,args.start_seed+args.episodes):
        trajectory,metadata=rollout(seed); metadata['controller_version']=teacher_version
        if metadata['success']:
            np.savez_compressed(out/f'episode_{seed:06d}.npz',**trajectory); dump(out/f'episode_{seed:06d}.json',metadata); success.append(metadata)
        else: failed.append(metadata)
        if (seed-args.start_seed+1)%20==0: print(f'{len(success)} successful, {len(failed)} failed',flush=True)
    dump(out/'failures.json',failed)
    frames=0; finite=True; bounded=True; boundaries=True
    for f in out.glob('episode_*.npz'):
        with np.load(f) as d:
            frames+=len(d['actions']); finite &= bool(np.isfinite(d['observations']).all() and np.isfinite(d['actions']).all())
            bounded &= bool(np.abs(d['actions']).max()<=1); boundaries &= len(d['observations'])==len(d['actions'])+1 and d['termination_labels'][-1]=='success'
    result=dict(successful_episodes=len(success),failed_episodes=len(failed),frames=frames,finite=finite,bounded=bounded,valid_boundaries=bool(boundaries),unwanted_collisions=sum(m['unwanted_collisions'] for m in success))
    dump(out/'quality.json',result); print(result)


def evaluate(args):
    result={}; policy=Policy(args.checkpoint)
    for name,p in [('scripted',None),('learned',policy)]:
        episodes=[rollout(seed,p)[1] for seed in range(args.start_seed,args.start_seed+args.episodes)]
        good=[e for e in episodes if e['success']]
        result[name]=dict(successes=len(good),episodes=len(episodes),success_rate=len(good)/len(episodes),
            unwanted_collisions=sum(e['unwanted_collisions'] for e in episodes),peak_contact_force_n=max(e['peak_contact_force_n'] for e in episodes),
            mean_entry_error_m=float(np.mean([e['entry_error_m'] for e in good])) if good else None,
            mean_exit_error_m=float(np.mean([e['exit_error_m'] for e in good])) if good else None,rollouts=episodes)
        print(name,{k:v for k,v in result[name].items() if k!='rollouts'},flush=True)
    result['checkpoint_sha256']=hashlib.sha256(Path(args.checkpoint).read_bytes()).hexdigest()
    result['seed_range']=[args.start_seed,args.start_seed+args.episodes-1]; dump(args.output,result)


def main():
    p=argparse.ArgumentParser(); sub=p.add_subparsers(dest='command',required=True)
    a=sub.add_parser('preview'); a.add_argument('--seed',type=int,default=0); a.add_argument('--video',default='artifacts/suturing/scripted.mp4')
    a=sub.add_parser('collect'); a.add_argument('--start-seed',type=int,default=0); a.add_argument('--episodes',type=int,default=100); a.add_argument('--output',default='artifacts/suturing/demos')
    a=sub.add_parser('train'); a.add_argument('--dataset',default='artifacts/suturing/demos'); a.add_argument('--output',default='artifacts/suturing/policy.npz'); a.add_argument('--epochs',type=int,default=300); a.add_argument('--seed',type=int,default=7)
    a=sub.add_parser('evaluate'); a.add_argument('--checkpoint',default='artifacts/suturing/policy.npz'); a.add_argument('--start-seed',type=int,default=10000); a.add_argument('--episodes',type=int,default=30); a.add_argument('--output',default='artifacts/suturing/development.json')
    a=sub.add_parser('record'); a.add_argument('--checkpoint',default='artifacts/suturing/policy.npz'); a.add_argument('--seed',type=int,default=20000); a.add_argument('--video',default='artifacts/suturing/learned.mp4')
    args=p.parse_args()
    if args.command=='collect': collect(args)
    elif args.command=='train':
        from bootstrap.policy import train
        train(args.dataset,args.output,args.epochs,args.seed,action_kind='continuous')
        dump(Path(args.output).with_suffix('.schema.json'),dict(observation=OBS_NAMES,action=['delta_center_x','delta_center_y','delta_center_z','delta_needle_rotation'],scale=DELTA.tolist(),bounds=[-1,1],control_hz=1/DT,units=['m','m','m','rad'],frame='world XYZ; rotation around negative world Y',task=VERSION))
    elif args.command=='evaluate': evaluate(args)
    else:
        trajectory,result=rollout(args.seed,None if args.command=='preview' else Policy(args.checkpoint),args.video)
        result['controller']='scripted' if args.command=='preview' else 'learned'
        if args.command=='record':
            result['checkpoint_sha256']=hashlib.sha256(Path(args.checkpoint).read_bytes()).hexdigest()
        np.savez_compressed(Path(args.video).with_suffix('.npz'),**trajectory)
        dump(Path(args.video).with_suffix('.json'),result); print(json.dumps(result,indent=2))

if __name__=='__main__': main()
