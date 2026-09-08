"""Create intentionally degraded demo checkpoints and paired measured recordings.

'Old version' is a UI label, not a claim that these are historical checkpoints.
Never change the current checkpoints or fabricate episode outcomes.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from bootstrap.policy import Policy as HeartPolicy
from bootstrap.__main__ import rollout as heart_rollout
from stitch.policy import Policy as StitchPolicy
from stitch.__main__ import rollout as stitch_rollout

def dump(path, data):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, allow_nan=False))

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def degrade(task, source, destination):
    with np.load(source, allow_pickle=False) as data:
        arrays = {key: data[key].copy() for key in data.files}
    if task == 'heart':
        # Equivalent to a consistent +52 mm Y error in the perceived heart position.
        # Keep the trained movement and grasp outputs intact: it approaches and closes
        # normally, but beside the physical heart. No attachment flags are falsified.
        arrays['mean'][4] -= .052   # object_y
        arrays['mean'][10] -= .052  # object_minus_ee_y
        arrays['mean'][13] += .052  # tray_minus_object_y
        arrays['blind_transfer_after_close'] = np.array(True)
        changes = ['Perceived heart position shifted +52 mm along Y through observation calibration',
                   'Relative-position inputs shifted consistently; movement and grasp weights unchanged',
                   'Demo task sequencer lifts, transfers, releases and retracts after closure without checking grasp confirmation']
    else:
        arrays['w2'][:, 5:7] = 0; arrays['b2'][5:7] = -3
        changes = ['Receiving jaw forced open', 'Thread tension output disabled']
    destination.parent.mkdir(parents=True, exist_ok=True)
    np.savez(destination, **arrays)
    provenance = dict(display_name='Old version', kind='synthetic_degraded_baseline', historical_checkpoint=False,
                      parent_checkpoint=str(source), parent_sha256=sha(source), checkpoint_sha256=sha(destination),
                      modifications=changes, purpose='Controlled failure demonstration; not evidence of historical policy performance')
    if task == 'heart':
        provenance.update(failure_mode='missed_grasp_with_blind_transfer', target_offset_m=[0,.052,0],
                          controller='biased learned approach plus explicit blind-transfer demo sequencer')
    dump(destination.with_suffix('.provenance.json'), provenance)
    return provenance

def summarize(episodes, task):
    result = dict(episodes=len(episodes), successes=sum(bool(e['success']) for e in episodes),
                  unwanted_collisions=sum(e['unwanted_collisions'] for e in episodes), rollouts=episodes)
    result['success_rate'] = result['successes'] / len(episodes)
    if task == 'heart':
        result.update(drops=sum(e['drops'] for e in episodes), grasps=sum(e['ever_grasped'] for e in episodes),
                      mean_placement_error_m=float(np.mean([e['placement_error'] for e in episodes])))
    else:
        result.update(catches=sum(e['caught'] for e in episodes), mean_final_gap_m=float(np.mean([e['wound_gap_m'] for e in episodes])))
    return result

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--episodes', type=int, default=20)
    parser.add_argument('--start-seed', type=int, default=41000); parser.add_argument('--evaluate-only', action='store_true')
    parser.add_argument('--task', choices=['all','heart','stitch'], default='all')
    args=parser.parse_args()
    if args.episodes < 1: raise ValueError('At least one paired scene is required')
    for task, source, policy, rollout in [
        ('heart', Path('artifacts/policy_recovery.npz'), HeartPolicy, heart_rollout),
        ('stitch', Path('artifacts/stitch/policy.npz'), StitchPolicy, stitch_rollout),
    ]:
        if args.task != 'all' and args.task != task: continue
        base=Path('artifacts/comparison')/task; old=base/'old_policy.npz'
        provenance=degrade(task,source,old)
        report=dict(task=task,seeds=list(range(args.start_seed,args.start_seed+args.episodes)),
                    old_version_provenance=provenance,current_checkpoint_sha256=sha(source))
        for version, checkpoint in [('current', source), ('old', old)]:
            episodes=[]
            for seed in report['seeds']:
                trajectory, outcome=rollout(seed,policy(checkpoint))
                if task=='heart': outcome['ever_grasped']=bool(trajectory['observations'][:,22].any())
                episodes.append(outcome)
            report[version]=summarize(episodes,task)
            print(task, version, {k:v for k,v in report[version].items() if k!='rollouts'},flush=True)
        dump(base/'evaluation.json',report)
        dump(Path('public/motion')/f'{task}-comparison.json',report)
        if args.evaluate_only: continue
        seed=30000  # Match the current published episode; no search for a convenient failure.
        video=base/'old.mp4'
        trajectory,meta=rollout(seed,policy(old),str(video),label='OLD VERSION / DEGRADED DEMO BASELINE')
        meta.update(checkpoint_sha256=sha(old),comparison_provenance=provenance)
        if task=='heart': meta['ever_grasped']=bool(trajectory['observations'][:,22].any())
        np.savez_compressed(base/'old.npz',**trajectory); dump(base/'old.json',meta)
        output=Path('public/motion')/f'{task}-old.json'
        if task=='heart':
            from bootstrap.export_motion import export_motion,write_captions
            import shutil
            payload=export_motion(old,seed,output)
            if payload['result']['success'] != meta['success']: raise ValueError('Record/export mismatch')
            shutil.copy2(video,output.with_suffix('.mp4')); write_captions(payload,output.with_suffix('.vtt'))
        else:
            from stitch.export_motion import export
            payload=export(base/'old',output)
        payload['comparison_provenance']=provenance
        if task=='heart': payload['policy_kind']='hybrid_failure_demo'
        payload['evaluation']={k:v for k,v in report['old'].items() if k!='rollouts'}
        payload['presentation_assets'] = ({'robot_glb':'/models/robot/panda-old.glb'} if task=='heart'
                                          else {'robot_fit':'/motion/stitch-old-robot.json'})
        dump(output,payload)
        # Captions identify the actual outcome rather than narrating a successful procedure.
        duration=payload['duration_s']; end=f'{int(duration//3600):02d}:{int(duration//60)%60:02d}:{duration%60:06.3f}'
        output.with_suffix('.vtt').write_text(f'WEBVTT\n\n00:00:00.000 --> {end}\nOld version: intentionally degraded demonstration baseline. Recorded outcome: {meta["termination"]}.\n')
        print(f'{task} old recording: {meta["termination"]}',flush=True)

if __name__=='__main__': main()
