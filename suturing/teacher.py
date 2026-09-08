import numpy as np
from .env import DELTA
VERSION='needle-drive-teacher-v1'

class Teacher:
    def act(self,env):
        error=env.goal-env.data.qpos
        action=np.clip(error/DELTA,-1,1)
        # Slow rotation until the curvature center is aligned; this is a continuous feedback law.
        action[3]*=np.exp(-(np.linalg.norm(error[:3])/.0015)**2)
        return action.astype(np.float32)
