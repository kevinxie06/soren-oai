"""Validated configuration boundary. All distances exposed to people are millimeters."""

import copy
import math
import numpy as np
from .tasks import get_task, reward_limits

# Backward-compatible defaults for existing stitch callers and stored experiments.
REWARD_DEFAULTS = get_task().reward_defaults
REWARD_LIMITS = reward_limits()
BOUNDS = get_task().bounds
VERSION_SPEC = "stitch-experiment-v1"


def validate_reward(reward, task="stitch"):
    limits = reward_limits(task)
    if not isinstance(reward, dict) or set(reward) != set(limits):
        raise ValueError("Reward must contain exactly the supported terms")
    for key, (lo, hi) in limits.items():
        v = reward[key]
        if (
            isinstance(v, bool)
            or not isinstance(v, (int, float))
            or not math.isfinite(v)
            or not lo <= v <= hi
        ):
            raise ValueError(f"Invalid reward {key}: expected {lo}–{hi}")
    return dict(reward)


def validate_plan(plan, task=None):
    p = copy.deepcopy(plan)
    task = task or p.get("task", "stitch")
    spec = get_task(task)
    if p.get("task", task) != task:
        raise ValueError("Plan task does not match experiment")
    if not isinstance(p.get("title"), str) or not 1 <= len(p["title"]) <= 120:
        raise ValueError("Invalid plan title")
    if (
        not isinstance(p.get("hypothesis"), str)
        or not isinstance(p.get("assumptions"), list)
        or not all(isinstance(a, str) for a in p["assumptions"])
    ):
        raise ValueError("Invalid plan description")
    validate_reward(p["reward"], task)
    scenarios = p["scenarios"]
    if not isinstance(scenarios, list) or len(scenarios) != 16:
        raise ValueError("Exactly 16 scenarios are required")
    seen, seeds = set(), []
    for i, s in enumerate(scenarios):
        if s.get("task", task) != task:
            raise ValueError("Scenario task does not match experiment")
        allowed = set(spec.bounds) | {
            "id",
            "name",
            "rationale",
            "seed",
            "thumbnail",
            "task",
            "training_bounds",
        }
        if set(s) - allowed:
            raise ValueError("Unsupported scenario parameter")
        for key, (lo, hi) in spec.bounds.items():
            v = s.get(key)
            if (
                isinstance(v, bool)
                or not isinstance(v, (int, float))
                or not math.isfinite(v)
                or not lo <= v <= hi
            ):
                raise ValueError(f"Scenario {i + 1}: {key} outside {lo}–{hi}")
        envelope = s.get("training_bounds")
        if envelope is not None:
            if not isinstance(envelope, dict) or set(envelope) != set(spec.bounds):
                raise ValueError("Invalid training envelope parameters")
            for key, (lo, hi) in spec.bounds.items():
                limits = envelope[key]
                if (not isinstance(limits, list) or len(limits) != 2
                    or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in limits)
                    or not lo <= limits[0] <= s[key] <= limits[1] <= hi):
                    raise ValueError(f"Invalid training envelope for {key}")
        values = tuple(s[k] for k in spec.bounds)
        if values in seen:
            raise ValueError("Duplicate scenario parameters")
        seen.add(values)
        if type(s.get("seed")) is not int or not 0 <= s["seed"] < 1_000_000_000:
            raise ValueError("Invalid scene seed")
        if any(abs(s["seed"] - prior) < 100 for prior in seeds):
            raise ValueError("Scenario seeds must be separated by at least 100")
        seeds.append(s["seed"])
        if not isinstance(s.get("name"), str) or not isinstance(
            s.get("rationale"), str
        ):
            raise ValueError("Missing scenario description")
        s["id"] = f"scene-{i + 1:02d}"
        s["task"] = task
    p["task"] = task
    p["version"] = f"{task}-experiment-v1"
    return p


def config_for(scenario, episode=0, training=False, rng=None):
    spec = get_task(scenario.get("task", "stitch"))
    seed = int(scenario["seed"]) + episode
    if training:
        rng = rng or np.random.default_rng()
        seed = int(rng.integers(1_100_000_000, 2_000_000_000))
    c = spec.environment.scene(seed)
    if spec.id == "lifting":
        c.update(
            object_xy=[scenario["object_x_mm"] / 1000, scenario["object_y_mm"] / 1000],
            object_yaw=math.radians(scenario["object_yaw_deg"]),
            tray_xy=[scenario["tray_x_mm"] / 1000, scenario["tray_y_mm"] / 1000],
        )
        if training:
            c["object_xy"] = np.clip(
                np.array(c["object_xy"]) + rng.normal(0, 0.001, 2), -0.022, 0.022
            ).tolist()
            c["object_yaw"] = float(
                np.clip(
                    c["object_yaw"] + rng.normal(0, 0.01),
                    math.radians(-8.5),
                    math.radians(8.5),
                )
            )
    else:
        c.update(
            gap=scenario["gap_mm"] / 1000,
            tissue_stiffness=scenario["stiffness"],
            radius=scenario["radius_mm"] / 1000,
            initial_offset=[
                scenario[k] / 1000
                for k in ["offset_x_mm", "offset_y_mm", "offset_z_mm"]
            ],
        )
        if training:
            c["gap"] = float(np.clip(c["gap"] + rng.normal(0, 0.0002), 0.006, 0.01))
            c["tissue_stiffness"] = float(
                np.clip(c["tissue_stiffness"] + rng.normal(0, 1), 65, 85)
            )
    envelope = scenario.get("training_bounds")
    if training and envelope:
        if spec.id == "lifting":
            c["object_xy"] = [float(np.clip(c["object_xy"][i], *(np.array(envelope[key]) / 1000)))
                              for i, key in enumerate(["object_x_mm", "object_y_mm"])]
            c["object_yaw"] = float(np.clip(c["object_yaw"], *np.radians(envelope["object_yaw_deg"])))
        else:
            c["gap"] = float(np.clip(c["gap"], *(np.array(envelope["gap_mm"]) / 1000)))
            c["tissue_stiffness"] = float(np.clip(c["tissue_stiffness"], *envelope["stiffness"]))
    return c


def template_plan(prompt, task="stitch"):
    spec = get_task(task)
    scenes = []
    if task == "lifting":
        for row, (x, y, yaw) in enumerate(
            [(-22, -22, -8.5), (-22, 22, 8.5), (22, -22, 8.5), (22, 22, -8.5)]
        ):
            for col, (tx, ty) in enumerate(
                [(250, -45), (250, 45), (320, -45), (320, 45)]
            ):
                scenes.append(
                    dict(
                        name=f"Object ({x}, {y}) mm · tray ({tx}, {ty}) mm",
                        rationale=(f"Combined boundary case: object at ({x}, {y}) mm with {yaw:g}° rotation, "
                                   f"tray at ({tx}, {ty}) mm. Tests grasp alignment near the cavity corner "
                                   f"and {'longer' if tx == 320 else 'shorter'} transport to the tray. "
                                   "Check grasp acquisition, rim contacts, drops, and placement error. "
                                   "Compare the same object configuration at other tray positions to assess target sensitivity; "
                                   "difficulty is a hypothesis until evaluated."),
                        seed=50000 + (row * 4 + col) * 100,
                        object_x_mm=x,
                        object_y_mm=y,
                        object_yaw_deg=yaw,
                        tray_x_mm=tx,
                        tray_y_mm=ty,
                    )
                )
        title = "Object lifting and placement robustness"
        assumptions = [spec.description, spec.units]
    else:
        for row, stiffness in enumerate([65, 72, 78, 85]):
            for col, gap in enumerate([6, 7.3, 8.7, 10]):
                scenes.append(
                    dict(
                        name=f"Gap {gap:g} mm · spring {stiffness} N/m",
                        rationale=(f"{'Boundary' if gap in (6, 10) or stiffness in (65, 85) else 'Interior coverage'} case: "
                                   f"{gap:g} mm wound gap and {stiffness} N/m spring stiffness. "
                                   "Tests needle span and closure travel under this spring resistance. "
                                   "Compare cases at the same gap to assess stiffness sensitivity, and at the same stiffness "
                                   "to assess gap sensitivity. Check receiving catch, final gap, and thread tension. "
                                   "Spring stiffness affects dynamics, not initial visible shape; no failure is assumed."),
                        seed=40000 + (row * 4 + col) * 100,
                        gap_mm=gap,
                        stiffness=stiffness,
                        radius_mm=14,
                        offset_x_mm=0,
                        offset_y_mm=0,
                        offset_z_mm=4.5,
                    )
                )
        title = "Wound closure robustness"
        assumptions = [
            "Rigid spring-mounted wound patches; assisted needle transfer.",
            "No tissue tearing, puncture resistance, or knot retention is modeled.",
        ]
    return validate_plan(
        dict(
            task=task,
            title=title,
            hypothesis=prompt,
            assumptions=assumptions,
            scenarios=scenes,
            reward=spec.reward_defaults,
            provider="Built-in parameter sweep",
            model="deterministic",
        )
    )


def planner_schema(task="stitch"):
    spec = get_task(task)
    properties = {k: {"type": "number"} for k in spec.bounds}
    properties.update(
        name={"type": "string"}, rationale={"type": "string"}, seed={"type": "integer"}
    )

    def obj(props):
        return dict(
            type="object",
            properties=props,
            required=list(props),
            additionalProperties=False,
        )

    return obj(
        dict(
            title={"type": "string"},
            hypothesis={"type": "string"},
            assumptions={"type": "array", "items": {"type": "string"}},
            reward=obj({k: {"type": "number"} for k in spec.reward_defaults}),
            scenarios={
                "type": "array",
                "minItems": 16,
                "maxItems": 16,
                "items": obj(properties),
            },
        )
    )
