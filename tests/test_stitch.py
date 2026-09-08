import unittest
import numpy as np
from stitch.env import StitchEnv
from stitch.teacher import Teacher
from bootstrap.policy import Network


class StitchTests(unittest.TestCase):
    def test_geometry_is_across_wound_and_gap_cannot_close_before_pass(self):
        e=StitchEnv(); e.reset(0); gap=e.gap
        self.assertLess(e.entry[0],e.center[0]); self.assertGreater(e.exit[0],e.center[0])
        self.assertEqual(e.entry[1],e.exit[1])
        for _ in range(20): e.step([0,0,0,0,1,1,1])
        self.assertAlmostEqual(e.gap,gap,places=7)
        self.assertFalse(e.caught); self.assertEqual(e.tension,0)

    def test_release_without_catch_fails(self):
        e=StitchEnv(); e.reset(0)
        for _ in range(4):
            _,_,done,_,m=e.step([0,0,0,0,-1,-1,0])
            if done: break
        self.assertEqual(m['termination'],'lost_needle')

    def test_pass_without_tension_does_not_close_and_success_needs_transfer(self):
        e=StitchEnv(); e.reset(3); t=Teacher()
        for _ in range(300):
            a=t.act(e); a[6]=0; _,_,done,_,m=e.step(a)
            if e.clear: break
        self.assertTrue(e.caught); self.assertTrue(e.receiver); self.assertFalse(e.donor)
        self.assertAlmostEqual(e.gap,e.config['gap'],places=7); self.assertFalse(m['success'])
        for _ in range(100):
            _,_,done,_,m=e.step(t.act(e))
            if done: break
        self.assertTrue(m['success']); self.assertLess(e.gap,.0007)
        # No hidden permanent closure: without a knot, releasing thread load reopens it.
        for _ in range(30): e.step([0,0,0,0,-1,1,0])
        self.assertGreater(e.gap,.9*e.config['gap'])

    def test_seven_action_gradient(self):
        net=Network(3,5,output_dim=7); net.params={k:v.astype(float) for k,v in net.params.items()}
        rng=np.random.default_rng(0); x=rng.normal(size=(4,3)); y=rng.normal(size=(4,7))
        _,g=net.loss_grad(x,y,'continuous'); p=net.params['w2']; before=p[0,6]; eps=1e-5
        p[0,6]=before+eps; plus,_=net.loss_grad(x,y,'continuous')
        p[0,6]=before-eps; minus,_=net.loss_grad(x,y,'continuous')
        self.assertAlmostEqual(g['w2'][0,6],(plus-minus)/(2*eps),places=7)


if __name__=='__main__': unittest.main()
