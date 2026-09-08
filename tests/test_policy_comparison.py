import hashlib
import json
from pathlib import Path
import unittest
import numpy as np

class PolicyComparisonTests(unittest.TestCase):
    def test_degraded_checkpoints_preserve_parent_and_apply_documented_faults(self):
        for task in ['heart', 'stitch']:
            base=Path('artifacts/comparison')/task
            provenance=json.loads((base/'old_policy.provenance.json').read_text())
            self.assertFalse(provenance['historical_checkpoint'])
            self.assertEqual(provenance['kind'],'synthetic_degraded_baseline')
            parent=Path(provenance['parent_checkpoint'])
            self.assertEqual(hashlib.sha256(parent.read_bytes()).hexdigest(),provenance['parent_sha256'])
            with np.load(parent) as current, np.load(base/'old_policy.npz') as old:
                for key in ['w0','b0','w1','b1','std']:
                    np.testing.assert_array_equal(current[key],old[key])
                if task=='heart':
                    for key in ['w2','b2']: np.testing.assert_array_equal(current[key],old[key])
                    expected=current['mean'].copy()
                    expected[[4,10]]-=.052; expected[13]+=.052
                    np.testing.assert_array_equal(expected,old['mean'])
                else:
                    np.testing.assert_array_equal(current['mean'],old['mean'])
                    self.assertFalse(np.array_equal(current['w2'],old['w2']))

    def test_heart_completes_empty_transfer_without_grasping(self):
        with np.load('artifacts/comparison/heart/old.npz') as trajectory:
            obs=trajectory['observations']
            self.assertFalse(obs[:,22].any(), 'The old policy must never attach the heart')
            self.assertFalse(obs[:,23].any(), 'The old policy must never clear the heart')
            stages=trajectory['teacher_stages']
            order=list(dict.fromkeys(stages.tolist()))
            self.assertEqual(order,['align_miss','open_above_miss','approach','close_empty','lift_empty',
                'transfer_empty','lower_empty','release_empty','retract_empty','empty_attempt_complete'])
            close=int(np.flatnonzero(stages=='close_empty')[-1])+1
            self.assertLess(obs[close,2],.035, 'Descend to grasp height before lifting')
            self.assertGreater(obs[close,21],.5, 'Close beside the heart')
            self.assertGreater(obs[close,1]-obs[close,4],.045, 'Miss laterally')
            self.assertGreater(obs[-1,2],.18, 'Finish retracted above the tray')
            np.testing.assert_allclose(obs[-1,:2],obs[-1,6:8],atol=.005)
            release=np.flatnonzero(stages=='release_empty')[-1]+1
            self.assertLess(obs[release,21],.5, 'Open above the tray')
            self.assertLess(abs(obs[release,2]-obs[release,8]),.01)
            np.testing.assert_allclose(obs[:,3:6],np.broadcast_to(obs[0,3:6],obs[:,3:6].shape),atol=1e-5)

    def test_heart_demo_sequence_resets_between_rollouts(self):
        from bootstrap.policy import Policy
        from bootstrap.__main__ import rollout
        policy=Policy('artifacts/comparison/heart/old_policy.npz')
        a,_=rollout(30000,policy);b,_=rollout(30000,policy)
        np.testing.assert_array_equal(a['actions'],b['actions'])

    def test_reports_use_identical_scenes_and_measured_outcomes(self):
        for task in ['heart', 'stitch']:
            report=json.loads(Path(f'public/motion/{task}-comparison.json').read_text())
            for version in ['current','old']:
                result=report[version]
                self.assertEqual([r['scene']['seed'] for r in result['rollouts']],report['seeds'])
                self.assertEqual(result['successes'],sum(r['success'] for r in result['rollouts']))
                self.assertEqual(result['episodes'],len(result['rollouts']))
            self.assertLess(report['old']['success_rate'],report['current']['success_rate'])

    def test_old_recordings_are_finite_failures_with_matching_exports(self):
        for task in ['heart','stitch']:
            base=Path('artifacts/comparison')/task
            meta=json.loads((base/'old.json').read_text())
            motion=json.loads(Path(f'public/motion/{task}-old.json').read_text())
            self.assertFalse(meta['success']); self.assertEqual(meta['success'],motion['result']['success'])
            self.assertEqual(meta['termination'],motion['result']['termination'])
            with np.load(base/'old.npz') as trajectory:
                self.assertEqual(len(trajectory['states']),len(trajectory['actions'])+1)
                self.assertEqual(len(motion['frames']),len(trajectory['states']))
                self.assertTrue(np.isfinite(trajectory['states']).all())
                self.assertLessEqual(np.abs(trajectory['actions']).max(),1)
            self.assertTrue(Path(f'public/motion/{task}-old.mp4').stat().st_size>1000)

if __name__=='__main__': unittest.main()
