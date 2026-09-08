from suturing.policy import Policy as ContinuousPolicy

class Policy(ContinuousPolicy):
    def __init__(self,path='artifacts/stitch/policy.npz'):
        super().__init__(path)
        if self.model.params['b2'].shape!=(7,): raise ValueError('Expected seven-action stitch checkpoint')
