"""Collect teacher corrections on states reached by a frozen learned policy."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import numpy as np
from .env import ExtractionEnv
from .teacher import Teacher, VERSION
from .policy import Policy
from .__main__ import dump


def recovery_rollout(seed, policy, roll_in_steps):
    env=ExtractionEnv(); obs=env.reset(seed); teacher=Teacher()
    observations=[obs]; states=[env.state()]; actions=[]; expert=[]; stages=[]; labels=[]
    for step in range(240):
        target=teacher.act(env)
        applied=policy.act(obs) if step<roll_in_steps else target
        obs,_,done,truncated,info=env.step(applied)
        observations.append(obs); states.append(env.state()); actions.append(applied)
        expert.append(target); stages.append(teacher.stage); labels.append(info['termination'])
        if done or truncated: break
    trajectory=dict(observations=np.array(observations),states=np.array(states),actions=np.array(actions),
        expert_actions=np.array(expert),teacher_stages=np.array(stages),termination_labels=np.array(labels),seed=np.array(seed))
    metadata=dict(**info,scene=env.config,controller_version=VERSION,collection='learned roll-in, teacher recovery',
        roll_in_steps=roll_in_steps,training_targets='expert_actions',replay_actions='actions')
    return trajectory,metadata


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--checkpoint',default='artifacts/policy.npz')
    p.add_argument('--base-dataset',default='artifacts/demos')
    p.add_argument('--output',default='artifacts/recovery_demos')
    p.add_argument('--start-seed',type=int,default=1000)
    p.add_argument('--episodes',type=int,default=120)
    a=p.parse_args(); out=Path(a.output)
    if out.exists() and any(out.iterdir()): raise ValueError('Use an empty output directory')
    base=list(Path(a.base_dataset).glob('episode_*.npz'))
    base_seeds={int(np.load(f)['seed']) for f in base}
    seeds=range(a.start_seed,a.start_seed+a.episodes)
    if base_seeds.intersection(seeds): raise ValueError('Recovery and base scene seeds must be disjoint')
    out.mkdir(parents=True,exist_ok=True)
    for f in base:
        shutil.copy2(f,out/f.name); shutil.copy2(f.with_suffix('.json'),out/f.with_suffix('.json').name)
    policy=Policy(a.checkpoint); successes=[]; failures=[]
    checkpoint_hash=hashlib.sha256(Path(a.checkpoint).read_bytes()).hexdigest()
    for seed in seeds:
        roll_in=int(np.random.default_rng(seed+700000).integers(15,86))
        trajectory,metadata=recovery_rollout(seed,policy,roll_in)
        metadata['roll_in_checkpoint_sha256']=checkpoint_hash
        if metadata['success']:
            np.savez_compressed(out/f'episode_{seed:06d}.npz',**trajectory)
            dump(out/f'episode_{seed:06d}.json',metadata); successes.append(metadata)
        else: failures.append(metadata)
        if (seed-a.start_seed+1)%20==0: print(f'recoveries {len(successes)} successful, {len(failures)} failed',flush=True)
    dump(out/'failures.json',failures)
    frames=0; finite=True; bounded=True; boundaries=True; changed=0
    for f in out.glob('episode_*.npz'):
        with np.load(f) as d:
            target=d['expert_actions'] if 'expert_actions' in d else d['actions']
            frames+=len(target); finite &= bool(np.isfinite(d['observations']).all() and np.isfinite(target).all())
            bounded &= bool(np.abs(target).max()<=1 and np.abs(d['actions']).max()<=1)
            boundaries &= len(d['observations'])==len(target)+1 and d['termination_labels'][-1]=='success'
            changed+=int(np.any(target!=d['actions'],axis=1).sum())
    quality=dict(base_episodes=len(base),recovery_successes=len(successes),recovery_failures=len(failures),frames=frames,
        finite=finite,bounded=bounded,valid_boundaries=bool(boundaries),frames_with_expert_correction=changed,
        seed_start=a.start_seed,episodes_attempted=a.episodes,roll_in_steps_range=[15,85],checkpoint_sha256=checkpoint_hash)
    dump(out/'quality.json',quality); print(json.dumps(quality,indent=2))

if __name__=='__main__': main()
