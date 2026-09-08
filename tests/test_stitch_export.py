import tempfile
import unittest
from pathlib import Path
import numpy as np
from stitch.export_motion import export


class StitchExportTests(unittest.TestCase):
    def test_export_matches_measured_recording_and_preserves_handoff(self):
        with tempfile.TemporaryDirectory() as temporary:
            output=Path(temporary)/'stitch.json'
            motion=export(output=output)
            with np.load('artifacts/stitch/learned.npz',allow_pickle=False) as data:
                self.assertEqual(len(motion['frames']),len(data['actions'])+1)
                self.assertEqual(motion['duration_s'],len(data['actions'])/20)
                left=next(i for i,g in enumerate(motion['geometry']) if g['name']=='pad_left')
                movement=motion['frames'][-1]['poses'][left]['position_m'][0]-motion['frames'][0]['poses'][left]['position_m'][0]
                self.assertAlmostEqual(movement,data['states'][-1,0]-data['states'][0,0])
                for i in [0,60,90,len(motion['frames'])-1]:
                    f=motion['frames'][i]
                    self.assertEqual(len(f['poses']),len(motion['geometry']))
                    np.testing.assert_allclose([np.linalg.norm(p['quaternion_wxyz']) for p in f['poses']],1,atol=1e-6)
                    np.testing.assert_allclose(f['tip'],data['observations'][i,15:18],atol=1e-7)
                    np.testing.assert_allclose(f['jaws'],data['states'][i,-6:].reshape(2,3))
                    self.assertAlmostEqual(f['gap_m'],float(data['observations'][i,32]))
                final=motion['frames'][-1]
                self.assertTrue(final['receiver_holding']);self.assertFalse(final['donor_holding'])
                self.assertLess(final['gap_m'],.0007)
            self.assertTrue(output.with_suffix('.mp4').exists())
            self.assertIn('00:00:10.400',output.with_suffix('.vtt').read_text())


if __name__=='__main__': unittest.main()
