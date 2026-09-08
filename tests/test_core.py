import unittest
import numpy as np
from bootstrap.env import ExtractionEnv
from bootstrap.policy import Network
from bootstrap.__main__ import rollout

class CoreTests(unittest.TestCase):
    def test_network_gradient(self):
        net=Network(3,5); net.params={k:v.astype(np.float64) for k,v in net.params.items()}
        rng=np.random.default_rng(0); x=rng.normal(size=(7,3)); y=rng.uniform(-1,1,(7,4)); y[:,3]=1
        _,grad=net.loss_grad(x,y)
        for key,idx in [('w0',(1,2)),('w1',(2,3)),('w2',(1,3)),('b0',(0,)),('b2',(3,))]:
            original=net.params[key][idx]; eps=1e-5
            net.params[key][idx]=original+eps; plus,_=net.loss_grad(x,y)
            net.params[key][idx]=original-eps; minus,_=net.loss_grad(x,y)
            net.params[key][idx]=original
            self.assertAlmostEqual(grad[key][idx],(plus-minus)/(2*eps),places=6)

    def test_no_remote_attachment_or_idle_success(self):
        e=ExtractionEnv(); e.reset(0)
        for _ in range(30): _,_,done,_,info=e.step([0,0,0,1])
        self.assertFalse(e.attached); self.assertFalse(info['success']); self.assertFalse(done)
        with self.assertRaises(ValueError): e.step([np.nan,0,0,1])

    def test_recovery_replay_uses_executed_actions(self):
        from bootstrap.recovery import recovery_rollout
        class OffsetPolicy:
            def act(self, obs): return np.array([.2, 0, 0, -1], np.float32)
        trajectory, meta = recovery_rollout(1001, OffsetPolicy(), 15)
        self.assertTrue(meta['success'])
        self.assertTrue(np.any(trajectory['actions'] != trajectory['expert_actions']))
        env = ExtractionEnv(); env.reset(1001)
        for i, action in enumerate(trajectory['actions']):
            obs, _, _, _, _ = env.step(action)
            np.testing.assert_array_equal(obs, trajectory['observations'][i+1])

    def test_scripted_determinism_and_success(self):
        a,ma=rollout(21); b,mb=rollout(21)
        self.assertTrue(ma['success']); self.assertTrue(ma['cleared']); self.assertTrue(ma['released'])
        self.assertEqual(ma['unwanted_collisions'],0); self.assertEqual(ma,mb)
        np.testing.assert_array_equal(a['observations'],b['observations'])
        self.assertEqual(len(a['observations']),len(a['actions'])+1)

if __name__=='__main__': unittest.main()
