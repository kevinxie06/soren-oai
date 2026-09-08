"""Opt-in demo fault: continue the transfer after closing without grasp confirmation.

Only enabled by a marked demonstration checkpoint. This task sequencer sends
ordinary simulator actions; it never sets attachment, object pose or success flags.
"""
import numpy as np
from .env import MAX_DELTA


class BlindTransfer:
    def __init__(self):
        self.reset()

    def reset(self):
        self.stage = 'align_miss'
        self.hold = 0
        self.miss_position = None

    def act(self, observation, learned_action):
        o = np.asarray(observation)
        ee, tray = o[:3], o[6:9]
        if self.stage in ('align_miss', 'open_above_miss'):
            goal = np.r_[o[3:5] + [0,.052], .19]
            if self.stage == 'align_miss' and np.linalg.norm(ee-goal) < .005:
                self.stage = 'open_above_miss'
                self.hold = 0
            elif self.stage == 'open_above_miss':
                self.hold += 1
                if self.hold >= 8:
                    self.stage = 'approach'
            return np.r_[np.clip((goal-ee)/MAX_DELTA,-1,1),-1.].astype(np.float32)
        if self.stage == 'approach':
            # The biased learned policy decides where to descend and when to close.
            if learned_action[3] <= 0 or ee[2] > .055:
                return learned_action
            self.miss_position = ee.copy()
            self.stage = 'close_empty'
            self.hold = 0

        close = True
        if self.stage == 'close_empty':
            goal = self.miss_position.copy()
            self.hold += 1
            if self.hold >= 8:
                self.stage = 'lift_empty'
        elif self.stage == 'lift_empty':
            goal = np.r_[self.miss_position[:2], .19]
            if np.linalg.norm(ee-goal) < .005:
                self.stage = 'transfer_empty'
        elif self.stage == 'transfer_empty':
            goal = np.r_[tray[:2], .19]
            if np.linalg.norm(ee-goal) < .005:
                self.stage = 'lower_empty'
        elif self.stage == 'lower_empty':
            goal = tray + [0,0,.003]
            if np.linalg.norm(ee-goal) < .005:
                self.stage = 'release_empty'
                self.hold = 0
        elif self.stage == 'release_empty':
            goal = tray + [0,0,.003]
            close = False
            self.hold += 1
            if self.hold >= 12:
                self.stage = 'retract_empty'
        else:
            goal = np.r_[tray[:2], .19]
            close = False
            if np.linalg.norm(ee-goal) < .005:
                self.stage = 'empty_attempt_complete'
        return np.r_[np.clip((goal-ee)/MAX_DELTA,-1,1),1. if close else -1.].astype(np.float32)
