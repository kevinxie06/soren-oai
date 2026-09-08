"""Supported task mechanics and checkpoints; planners may only vary these fields."""

from dataclasses import dataclass
from importlib import import_module
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Task:
    id: str
    module: str
    env_class: str
    checkpoint: str
    bounds: dict
    reward_defaults: dict
    description: str
    units: str
    actions: tuple
    progress_term: str

    @property
    def baseline(self):
        return ROOT / self.checkpoint

    @property
    def environment(self):
        return import_module(f"{self.module}.env")

    def make_env(self):
        return getattr(self.environment, self.env_class)()

    def make_policy(self, path=None):
        return import_module(f"{self.module}.policy").Policy(path or self.baseline)


TASKS = {
    "stitch": Task(
        "stitch",
        "stitch",
        "StitchEnv",
        "artifacts/stitch/policy.npz",
        dict(
            gap_mm=(6, 10),
            stiffness=(65, 85),
            radius_mm=(12, 16),
            offset_x_mm=(-3, 3),
            offset_y_mm=(-3, 3),
            offset_z_mm=(3, 6),
        ),
        dict(
            completion=20.0, milestones=2.0, closure=3.0, smoothness=0.01, failure=10.0
        ),
        "MuJoCo opposing-jaw stitch task: rigid spring-mounted patches, assisted jaw transfer, "
        "seven continuous actions, numerical simulator observations; no image policy, real robot, "
        "puncture resistance, deformable tissue, or knot.",
        "All *_mm fields are millimeters; stiffness is N/m. offset_z_mm is the initial offset above the wound.",
        ("dx", "dy", "dz", "dtheta", "donor", "receiver", "tension"),
        "closure",
    ),
    "lifting": Task(
        "lifting",
        "bootstrap",
        "ExtractionEnv",
        "artifacts/policy_recovery.npz",
        dict(
            object_x_mm=(-22, 22),
            object_y_mm=(-22, 22),
            object_yaw_deg=(-8.5, 8.5),
            tray_x_mm=(250, 320),
            tray_y_mm=(-45, 45),
        ),
        dict(
            completion=20.0,
            milestones=2.0,
            placement=3.0,
            smoothness=0.01,
            failure=10.0,
        ),
        "MuJoCo object lifting and placement task: a fixed-orientation XYZ gantry with a two-finger "
        "gripper lifts a rigid heart-shaped object out of a cavity, clears its rim, and releases it "
        "into a tray. Grasping uses a proximity-and-finger-closure-gated assisted weld. "
        "32 numerical observations, delta XYZ plus a binary close/open command. Object geometry, "
        "mass, friction, cavity dimensions, and tray dimensions are fixed; no arbitrary object shapes, "
        "deformable objects, articulated arms, vision, or real-robot execution. "
        "Success requires rim clearance followed by open-gripper release in the tray, "
        "within 50 mm on each horizontal axis and 12 mm vertically, and speed below 0.04 for 0.75 seconds. "
        "Drops and unwanted contact events are reported separately.",
        "All *_mm fields are millimeters in world coordinates; object_yaw_deg is degrees around Z. "
        "Initial gripper XY is randomized within +/-25 mm using each episode seed, so repeats "
        "test different approaches while retaining the scenario's object and tray configuration.",
        ("dx", "dy", "dz", "close"),
        "placement",
    ),
}


def get_task(task_id="stitch"):
    if not isinstance(task_id, str) or task_id not in TASKS:
        raise ValueError(f"Unsupported task: {task_id}")
    return TASKS[task_id]


def reward_limits(task_id="stitch"):
    task = get_task(task_id)
    return dict(
        completion=(1, 100),
        milestones=(0, 10),
        **{task.progress_term: (0, 10)},
        smoothness=(0, 1),
        failure=(0, 100),
    )
