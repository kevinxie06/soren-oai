import numpy as np
from bootstrap.policy import Policy as LoadedNetwork

class Policy(LoadedNetwork):
    def __init__(self,path='artifacts/suturing/policy.npz'):
        super().__init__(path)
    def act(self,observation):
        out,_=self.model.forward((np.asarray(observation,np.float32)-self.mean)/self.std)
        return np.clip(out,-1,1).astype(np.float32)
