"""Cross-language contract checks for reviewed study execution."""
import copy
import json
from pathlib import Path
import subprocess
import unittest
import numpy as np
from lab.specs import validate_plan, config_for
from lab.tasks import get_task

ROOT = Path(__file__).resolve().parents[1]

class ReviewedStudyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        code = '''import {buildStudy, defaultSpecification, taskPackages} from './lib/experiment-spec.ts';
const studies = {};
for (const task of ['stitch', 'lifting']) {
  const s=defaultSpecification(task);
  if(task==='stitch') { s.ranges.gap_mm=[7,8]; s.ranges.stiffness=[70,70]; }
  else {s.ranges.object_x_mm=[-1,1];s.ranges.object_y_mm=[0,0];s.ranges.object_yaw_deg=[0,0];}
  studies[task]={...buildStudy(s),package:taskPackages[task]};
}
for (const task of ['stitch', 'lifting']) {
  for (const environments of [1, 5, 9, 17, 32]) {
    studies[`${task}-${environments}`] = {...buildStudy({...defaultSpecification(task), environments}), package:taskPackages[task]};
  }
}
console.log(JSON.stringify(studies));'''
        result = subprocess.run(['node', '--experimental-strip-types', '--input-type=module', '-e', code], cwd=ROOT, capture_output=True, text=True, check=True)
        cls.studies = json.loads(result.stdout)

    def test_frontend_packages_match_worker_capabilities(self):
        for study in self.studies.values():
            task = study['specification']['task']
            pkg, actual = study['package'], get_task(task)
            self.assertEqual(pkg['policy'], actual.checkpoint)
            self.assertEqual({p['key']: tuple(p['bounds']) for p in pkg['parameters']}, actual.bounds)
            self.assertEqual(pkg['reward'], actual.reward_defaults)
            self.assertEqual(pkg['actions'], len(actual.actions))
            self.assertEqual(pkg['observations'], len(actual.environment.OBS_NAMES))

    def test_reviewed_plans_survive_worker_validation_unchanged(self):
        for study in self.studies.values():
            task = study['specification']['task']
            self.assertEqual(validate_plan(study['plan'], task), study['plan'])
            self.assertEqual(len(study['plan']['scenarios']), study['specification']['environments'])

    def test_training_cannot_escape_reviewed_ranges_or_move_fixed_parameters(self):
        rng = np.random.default_rng(47)
        for task in ['stitch', 'lifting']:
            study = self.studies[task]
            for scenario in study['plan']['scenarios']:
                for _ in range(10):
                    c = config_for(scenario, training=True, rng=rng)
                    if task == 'stitch':
                        self.assertTrue(.007 <= c['gap'] <= .008)
                        self.assertEqual(c['tissue_stiffness'], 70)
                    else:
                        self.assertTrue(-.001 <= c['object_xy'][0] <= .001)
                        self.assertEqual(c['object_xy'][1], 0)
                        self.assertEqual(c['object_yaw'], 0)

    def test_invalid_or_mismatched_envelope_is_rejected(self):
        plan = self.studies['stitch']['plan']
        for bounds in [[8,7], [0,100], [True,9], [float('nan'),8], [7,7.5]]:
            bad = copy.deepcopy(plan)
            max(bad['scenarios'], key=lambda s: s['gap_mm'])['training_bounds']['gap_mm'] = bounds
            with self.assertRaises(ValueError): validate_plan(bad)

if __name__ == '__main__': unittest.main()
