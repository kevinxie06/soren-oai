import unittest
import numpy as np
from suturing.env import NeedleDriveEnv,scene
from suturing.__main__ import rollout
from bootstrap.policy import Network

class NeedleDriveTests(unittest.TestCase):
    def test_teacher_completes_both_gates_and_clearance(self):
        _,m=rollout(7)
        self.assertTrue(m['success']); self.assertTrue(m['needle_clear'])
        self.assertLess(m['entry_error_m'],.002); self.assertLess(m['exit_error_m'],.002)
        self.assertGreater(m['maximum_depth_m'],.75*m['scene']['radius'])
        self.assertEqual(m['unwanted_collisions'],0)

    def test_wrong_entry_is_rejected(self):
        config=scene(0); config['initial_offset']=[0,.0025,0]
        e=NeedleDriveEnv(); e.reset(config=config)
        for _ in range(100):
            _,_,done,tr,info=e.step([0,0,0,1])
            if done or tr: break
        self.assertFalse(info['success']); self.assertEqual(info['termination'],'invalid_entry')

    def test_idle_cannot_succeed_and_action_validation(self):
        e=NeedleDriveEnv(); e.reset(0)
        for _ in range(12): _,_,_,_,info=e.step([0,0,0,0])
        self.assertFalse(info['success']); self.assertFalse(e.entered)
        with self.assertRaises(ValueError): e.step([0,0,np.nan,0])

    def test_continuous_rotation_gradient(self):
        n=Network(3,5); n.params={k:v.astype(np.float64) for k,v in n.params.items()}
        r=np.random.default_rng(9); x=r.normal(size=(6,3)); y=r.uniform(-1,1,(6,4))
        _,g=n.loss_grad(x,y,'continuous'); p=n.params['w2']; before=p[1,3]; eps=1e-5
        p[1,3]=before+eps; plus,_=n.loss_grad(x,y,'continuous')
        p[1,3]=before-eps; minus,_=n.loss_grad(x,y,'continuous')
        self.assertAlmostEqual(g['w2'][1,3],(plus-minus)/(2*eps),places=7)

if __name__=='__main__': unittest.main()
