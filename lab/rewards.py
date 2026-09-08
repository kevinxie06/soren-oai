import numpy as np
from .specs import REWARD_DEFAULTS, validate_reward


class Reward:
    """Bounded potential progress and one-time milestones; success stays in StitchEnv."""

    def __init__(self, weights=None):
        self.weights = validate_reward(weights or REWARD_DEFAULTS)
        self.reset()

    def reset(self):
        self.milestones = set()
        self.previous_closure = 0.0
        self.previous_action = None
        self.terminal_paid = False

    def compute(self, env, action, info):
        w = self.weights
        milestones = []
        for key in ["entered", "exited", "caught", "needle_clear"]:
            if info.get(key) and key not in self.milestones:
                self.milestones.add(key)
                milestones.append(key)
        closure = (
            float(np.clip(1 - env.gap / env.config["gap"], 0, 1))
            if env.clear and env.caught and not env.donor
            else 0.0
        )
        progress = closure - self.previous_closure
        self.previous_closure = closure
        change = (
            float(np.mean((action - self.previous_action) ** 2))
            if self.previous_action is not None
            else 0.0
        )
        self.previous_action = np.array(action).copy()
        failed = info["termination"] not in ["running", "success"]
        terms = dict(
            completion=w["completion"]
            * float(info["success"] and not self.terminal_paid),
            milestones=w["milestones"] * len(milestones),
            closure=w["closure"] * progress,
            smoothness=-w["smoothness"] * change,
            failure=-w["failure"] * float(failed and not self.terminal_paid),
        )
        self.terminal_paid = self.terminal_paid or info["success"] or failed
        return float(sum(terms.values())), terms


class LiftingReward:
    """One-time grasp/clearance milestones and net horizontal placement progress."""

    def __init__(self, weights=None):
        from .tasks import get_task

        self.weights = validate_reward(
            weights or get_task("lifting").reward_defaults, "lifting"
        )
        self.reset()

    def reset(self):
        self.milestones = set()
        self.previous_progress = 0.0
        self.previous_action = None
        self.terminal_paid = False

    def compute(self, env, action, info):
        w = self.weights
        events = {
            "grasp": env.attached,
            "clearance": info["cleared"],
            "placed_release": info["cleared"] and info["released"] and env.in_tray(),
        }
        new = {key for key, value in events.items() if value} - self.milestones
        self.milestones.update(new)
        initial_distance = max(
            np.linalg.norm(np.array(env.config["object_xy"]) - env.config["tray_xy"]),
            0.001,
        )
        progress = (
            float(np.clip(1 - info["placement_error"] / initial_distance, 0, 1))
            if info["cleared"]
            else 0.0
        )
        delta = progress - self.previous_progress
        self.previous_progress = progress
        change = (
            float(np.mean((action - self.previous_action) ** 2))
            if self.previous_action is not None
            else 0.0
        )
        self.previous_action = np.array(action).copy()
        failed = info["termination"] not in ["running", "success"]
        terms = dict(
            completion=w["completion"]
            * float(info["success"] and not self.terminal_paid),
            milestones=w["milestones"] * len(new),
            placement=w["placement"] * delta,
            smoothness=-w["smoothness"] * change,
            failure=-w["failure"] * float(failed and not self.terminal_paid),
        )
        self.terminal_paid = self.terminal_paid or info["success"] or failed
        return float(sum(terms.values())), terms


def make_reward(task="stitch", weights=None):
    from .tasks import get_task

    get_task(task)
    return LiftingReward(weights) if task == "lifting" else Reward(weights)
