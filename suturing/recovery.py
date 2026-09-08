"""Collect teacher corrections after bounded actuator disturbances; no teleporting."""
import argparse
import shutil
from pathlib import Path
import numpy as np
from .env import NeedleDriveEnv, VERSION
from .teacher import Teacher, VERSION as TEACHER_VERSION
from .__main__ import dump


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--output',default='artifacts/suturing/demos_recovery')
    p.add_argument('--episodes',type=int,default=200)
    p.add_argument('--start-seed',type=int,default=1000)
    args=p.parse_args(); out=Path(args.output)
    out.mkdir(parents=True,exist_ok=True)
    if list(out.glob('episode_*.npz')): raise ValueError('Use an empty directory')
    for f in Path('artifacts/suturing/demos').glob('episode_*'):
        shutil.copy2(f,out/f.name)
    failed=[]; count=0
    for seed in range(args.start_seed,args.start_seed+args.episodes):
        env=NeedleDriveEnv(); obs=env.reset(seed); teacher=Teacher(); rng=np.random.default_rng(seed+500000)
        observations=[obs]; states=[env.state()]; actions=[]; targets=[]; labels=[]
        for _ in range(400):
            expert=teacher.act(env); action=expert.copy()
            if env.goal[3]-env.data.qpos[3]>.25 and rng.random()<.5:
                action=np.clip(action+rng.normal(0,[.30,.30,.30,.03]),-1,1)
            obs,_,done,truncated,info=env.step(action)
            observations.append(obs); states.append(env.state()); actions.append(action); targets.append(expert); labels.append(info['termination'])
            if done or truncated: break
        metadata=dict(**info,scene=env.config,simulator_version=VERSION,controller_version=TEACHER_VERSION,
                      collection='teacher plus Gaussian action disturbance p=0.5; std=[.30,.30,.30,.03]; disabled in last .25 rad',noise_seed=seed+500000)
        if info['success']:
            count+=1
            np.savez_compressed(out/f'episode_{seed:06d}.npz',observations=observations,states=states,actions=actions,expert_actions=targets,termination_labels=labels,seed=seed)
            dump(out/f'episode_{seed:06d}.json',metadata)
        else: failed.append(metadata)
        if (seed-args.start_seed+1)%25==0: print(f'{count} recovery successes; {len(failed)} failures',flush=True)
    dump(out/'failures.json',failed)
    frames=0
    for f in out.glob('episode_*.npz'):
        with np.load(f) as d:
            assert len(d['observations'])==len(d['actions'])+1
            assert d['termination_labels'][-1]=='success'
            for key in ['observations','actions','states']:
                assert np.isfinite(d[key]).all()
            assert np.abs(d['actions']).max()<=1
            if 'expert_actions' in d: assert np.isfinite(d['expert_actions']).all() and np.abs(d['expert_actions']).max()<=1
            frames+=len(d['actions'])
    dump(out/'quality.json',dict(successful_episodes=100+count,failed_recovery_episodes=len(failed),frames=frames,finite=True,bounded=True,valid_boundaries=True))


if __name__=='__main__': main()
