import math
import numpy as np
from .env import DELTA
VERSION='opposing-jaw-teacher-v2-gap-feedback'

class Teacher:
    def act(self,env):
        q=env.q; goal=env.goal.copy()
        if env.caught:
            goal[2]+=.004*np.clip((q[3]-(3*math.pi-.25))/.25,0,1)
        if not env.caught: goal[3]=2*math.pi+.035
        if env.caught and env.donor: goal[3]=q[3]
        move=np.clip((goal-q)/DELTA,-1,1)
        move[3]*=np.exp(-(np.linalg.norm(goal[:3]-q[:3])/.0008)**2)
        donor=-1 if env.caught else 1
        receiver=1 if q[3]>2*math.pi-.20 else -1
        tension=np.clip(env.tension/.6+.2*np.clip((env.gap-.0004)/.001,-1,1),0,1) if env.clear and not env.donor else 0
        return np.r_[move,donor,receiver,tension].astype(np.float32)
