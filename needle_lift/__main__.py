"""Thin process adapter. Upstream owns observations, controller, weights and physics."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
SCRIPTS=Path('workflows/robotic_surgery/scripts/simulation/scripts')
PLAY=SCRIPTS/'reinforcement_learning/rsl_rl/play.py'
PREVIEW=SCRIPTS/'environments/state_machine/lift_needle_sm.py'


def save(path,value):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,indent=2),encoding='utf-8')


def resolve(path):
    p=Path(path)
    return p if p.is_absolute() else ROOT/p


def checkpoint_errors(config):
    if not config.get('checkpoint'): return ['No pretrained needle-lift checkpoint was found or configured.']
    errors=[]; checkpoint=resolve(config['checkpoint'])
    if not checkpoint.is_file(): errors.append(f'Checkpoint missing: {checkpoint}')
    metadata=config.get('checkpoint_metadata')
    if not metadata or not resolve(metadata).is_file():
        return errors+['Checkpoint metadata is required; use checkpoint_metadata.example.json and verified training settings.']
    m=json.loads(resolve(metadata).read_text(encoding='utf-8-sig'))
    for key in ['task','simulator','isaaclab','actor_obs_normalization','checkpoint_format']:
        if m.get(key)!=config.get(key): errors.append(f'Checkpoint metadata mismatch: {key}')
    if checkpoint.is_file() and m.get('sha256')!=hashlib.sha256(checkpoint.read_bytes()).hexdigest():
        errors.append('Checkpoint SHA256 does not match metadata.')
    return errors


def doctor(config,python,learned=True):
    errors=[]; upstream=resolve(config['upstream_dir']); facts={}
    if not (upstream/PLAY).is_file(): errors.append('Pinned upstream play.py is missing; see README setup.')
    try:
        head=subprocess.run(['git','-C',str(upstream),'rev-parse','HEAD'],capture_output=True,text=True,timeout=10)
        facts['upstream_commit']=head.stdout.strip()
        if head.returncode or facts['upstream_commit']!=config['upstream_commit']: errors.append('Upstream revision differs from the configured pin.')
    except (OSError,subprocess.TimeoutExpired): errors.append('Cannot verify upstream Git revision.')
    probe="import sys,platform,json,importlib.metadata as m; d={'python':platform.python_version(),'os':platform.system()}; exec('for n in [\"isaacsim\",\"isaaclab\",\"rsl-rl-lib\"]:\\n try: d[n]=m.version(n)\\n except m.PackageNotFoundError: d[n]=None'); print(json.dumps(d))"
    try:
        p=subprocess.run([python,'-c',probe],capture_output=True,text=True,timeout=20)
        facts['runtime']=json.loads(p.stdout) if p.returncode==0 else {'probe_error':p.stderr}
    except (OSError,subprocess.TimeoutExpired,json.JSONDecodeError) as e: facts['runtime']={'probe_error':str(e)}
    runtime=facts['runtime']
    if runtime.get('os')!='Linux': errors.append('This pinned NVIDIA workflow supports Ubuntu 22.04/24.04, not this runtime OS.')
    if not runtime.get('python','').startswith(config['python']+'.'): errors.append('A separate Python 3.11 Isaac environment is required.')
    for name,expected in [('isaacsim',config['simulator']),('isaaclab',config['isaaclab'])]:
        if runtime.get(name)!=expected: errors.append(f'{name} {expected} required; detected {runtime.get(name)}.')
    if learned and not runtime.get('rsl-rl-lib'): errors.append('Upstream RSL-RL dependency is missing.')
    try:
        gpu=subprocess.run(['nvidia-smi','--query-gpu=name,memory.total','--format=csv,noheader,nounits'],capture_output=True,text=True,timeout=10)
        facts['gpu']=gpu.stdout.strip()
        if gpu.returncode or not facts['gpu']: errors.append('No NVIDIA GPU reported by nvidia-smi.')
        elif 'RTX' not in facts['gpu']: errors.append('Verify a supported NVIDIA GPU with RT cores; detected GPU is not recognized as RTX.')
    except (OSError,subprocess.TimeoutExpired):
        facts['gpu']=None; errors.append('nvidia-smi unavailable; this workstation has Intel Arc graphics, not the required NVIDIA RTX GPU.')
    if learned: errors.extend(checkpoint_errors(config))
    return dict(status='blocked' if errors else 'preflight_passed_unverified',success=None,simulation_started=False,
                policy_kind='learned' if learned else 'scripted',blockers=errors,facts=facts)


def launch(config,python,mode,output,headless=True):
    learned=mode!='preview'; result=doctor(config,python,learned)
    out=resolve(output); out.mkdir(parents=True,exist_ok=True)
    if result['blockers']:
        save(out/f'{mode}.json',result); return result,2
    upstream=resolve(config['upstream_dir']); runtime=out/'runtime'; runtime.mkdir(exist_ok=True)
    command=[python,str(upstream/(PLAY if learned else PREVIEW)),'--num_envs',str(config['num_envs'])]
    if learned:
        # The pinned upstream play script resolves files under logs/rsl_rl/needle_lift/<run>.
        staged=runtime/'logs/rsl_rl/needle_lift/imported'; staged.mkdir(parents=True,exist_ok=True)
        shutil.copy2(resolve(config['checkpoint']),staged/'model.pt')
        command+=['--task',config['task'],'--load_run','imported','--checkpoint','model.pt',
                  '--video','--video_length',str(config['video_length'])]
    if headless: command.append('--headless')
    env=os.environ.copy(); search=[str(upstream/'workflows/robotic_surgery/scripts')]
    search.extend(str(upstream/'workflows/robotic_surgery/scripts/simulation/exts'/n) for n in ['robotic.surgery.assets','robotic.surgery.tasks'])
    env['PYTHONPATH']=os.pathsep.join(search+([env['PYTHONPATH']] if env.get('PYTHONPATH') else []))
    result['command']=command
    try:
        with (out/f'{mode}.log').open('w',encoding='utf-8') as log:
            run=subprocess.run(command,cwd=runtime,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=900)
        code=run.returncode
        result.update(status='upstream_exited_unscored' if code==0 else 'upstream_failed',returncode=code,
                      simulation_started=None,success=None)
    except subprocess.TimeoutExpired:
        code=124; result.update(status='upstream_timeout',returncode=code)
    videos=[]
    for video in runtime.glob('logs/rsl_rl/needle_lift/imported/videos/play/*.mp4'):
        target=out/f'learned_{video.name}'; shutil.copy2(video,target); videos.append(str(target))
    result['recordings']=videos
    result['measurement_note']='Upstream play does not emit success/drop/collision metrics. Null values are not successful rollouts.'
    save(out/f'{mode}.json',result)
    return result,code


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['doctor','preview','evaluate','record'])
    parser.add_argument('--config',default='needle_lift/config.json')
    parser.add_argument('--python',default=sys.executable,help='Python executable from the separate Isaac environment')
    parser.add_argument('--checkpoint'); parser.add_argument('--checkpoint-metadata')
    parser.add_argument('--output',default='artifacts/needle_lift')
    parser.add_argument('--gui',action='store_true')
    args=parser.parse_args(); config=json.loads(resolve(args.config).read_text(encoding='utf-8-sig'))
    if args.checkpoint: config['checkpoint']=args.checkpoint
    if args.checkpoint_metadata: config['checkpoint_metadata']=args.checkpoint_metadata
    if args.command=='doctor':
        result=doctor(config,args.python); code=2 if result['blockers'] else 0
        save(resolve(args.output)/'doctor.json',result)
    else: result,code=launch(config,args.python,args.command,args.output,not args.gui)
    print(json.dumps(result,indent=2)); return code

if __name__=='__main__': raise SystemExit(main())
