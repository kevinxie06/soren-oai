import json
import numpy as np
from bootstrap.__main__ import rollout
from bootstrap.policy import Policy

report=json.load(open('artifacts/evaluation.json'))
policy=Policy()
for episode in report['learned']['rollouts']:
    if episode['drops'] or not episode['success']:
        seed=episode['scene']['seed']; trajectory,meta=rollout(seed,policy)
        obs=trajectory['observations']
        indices=np.where(np.diff(obs[:,24])>0)[0]
        print(seed, 'success',meta['success'],'release states',obs[indices,:9].tolist(),'final object',obs[-1,3:6].tolist())
