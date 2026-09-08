import numpy as np
from .env import MAX_DELTA

VERSION='geometry-teacher-v1'

class Teacher:
    def __init__(self): self.stage='approach'
    def act(self, env):
        ee,obj,target=env.ee,env.obj,env.target
        close=False
        if env.released:
            self.stage='verify'; goal=target+np.array([0,0,.16])
        elif not env.attached:
            self.stage='approach'; goal=obj.copy()
            if np.linalg.norm(ee[:2]-obj[:2])>.008: goal[2]=.19
            if np.linalg.norm(ee-obj)<.009:
                self.stage='grasp'; close=True
        elif not env.cleared:
            self.stage='lift'; close=True; goal=np.array([obj[0],obj[1],.19])
        elif np.linalg.norm(obj[:2]-target[:2])>.008:
            self.stage='transport'; close=True; goal=target.copy(); goal[2]=.19
        else:
            self.stage='release'; close=True; goal=target.copy(); goal[2]+=.003
            if abs(obj[2]-goal[2])<.007: close=False
        return np.r_[np.clip((goal-ee)/MAX_DELTA,-1,1),1 if close else -1].astype(np.float32)
