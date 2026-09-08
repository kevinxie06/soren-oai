import json
from pathlib import Path
import tempfile
import unittest
import mujoco
import numpy as np
from bootstrap.export_motion import export_motion, unreal_pose

class MotionExportTests(unittest.TestCase):
    def test_coordinate_handedness_and_units(self):
        q=np.array([.8,.2,.3,.4]); q/=np.linalg.norm(q)
        pose=unreal_pose([1,2,3],q)
        self.assertEqual(pose['location_cm'],[100,-200,300])
        x,y,z,w=pose['quaternion_xyzw']; a=np.zeros(9); b=np.zeros(9)
        mujoco.mju_quat2Mat(a,q); mujoco.mju_quat2Mat(b,np.array([w,x,y,z]))
        reflect=np.diag([1,-1,1])
        np.testing.assert_allclose(b.reshape(3,3),reflect@a.reshape(3,3)@reflect,atol=1e-12)

    def test_export_contains_measured_terminal_placement(self):
        with tempfile.TemporaryDirectory() as tmp:
            data=export_motion('artifacts/policy_recovery.npz',30000,Path(tmp)/'motion.json')
        self.assertTrue(data['result']['success'])
        self.assertEqual(len(data['frames']),data['result']['steps']+1)
        self.assertAlmostEqual(data['duration_s'],data['result']['steps']/20)
        object_id=next(g['id'] for g in data['geometry'] if g['name']=='object_collision')
        for frame in data['frames']:
            self.assertEqual(len(frame['poses']),len(data['geometry']))
            np.testing.assert_allclose(frame['poses'][object_id]['position_m'],frame['object_position_m'],atol=2e-8)
            for pose in frame['poses']:
                self.assertAlmostEqual(np.linalg.norm(pose['quaternion_wxyz']),1,places=8)
        self.assertTrue(data['frames'][-1]['state']['released'])
        self.assertFalse(data['frames'][-1]['state']['attached'])

if __name__=='__main__': unittest.main()
