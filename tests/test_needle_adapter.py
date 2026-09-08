import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from needle_lift.__main__ import checkpoint_errors,launch

class NeedleAdapterTests(unittest.TestCase):
    def test_missing_weights_are_not_treated_as_policy(self):
        self.assertTrue(checkpoint_errors({'checkpoint':None}))

    def test_wrong_task_and_tampered_checkpoint_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); weights=root/'model.pt'; weights.write_bytes(b'test bytes, not a real model')
            config=dict(checkpoint=str(weights),checkpoint_metadata=str(root/'metadata.json'),task='needle',simulator='5.1.0',isaaclab='2.3.0',actor_obs_normalization=False,checkpoint_format='rsl_rl')
            metadata={k:v for k,v in config.items() if not k.startswith('checkpoint')}; metadata['checkpoint_format']='rsl_rl'
            metadata.update(task='generic-cube-lift',sha256='wrong')
            (root/'metadata.json').write_text(json.dumps(metadata))
            errors=checkpoint_errors(config)
            self.assertIn('Checkpoint metadata mismatch: task',errors)
            self.assertIn('Checkpoint SHA256 does not match metadata.',errors)

    def test_blocked_launch_does_not_run_or_report_success(self):
        blocked=dict(status='blocked',success=None,simulation_started=False,blockers=['missing checkpoint'])
        with tempfile.TemporaryDirectory() as tmp, patch('needle_lift.__main__.doctor',return_value=blocked), patch('needle_lift.__main__.subprocess.run') as runner:
            result,code=launch({},'unused','evaluate',tmp)
            self.assertEqual(code,2); self.assertIsNone(result['success']); runner.assert_not_called()
            self.assertEqual(json.loads((Path(tmp)/'evaluate.json').read_text())['status'],'blocked')

if __name__=='__main__': unittest.main()
