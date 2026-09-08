"""Replay operator commands through native physics; never override success."""
import numpy as np
import mujoco
from PIL import Image
from .tasks import get_task
from .specs import config_for
from .runtime import BaselinePolicy, render_frame


def replay(scenario, commands, output, check=lambda: None, render=True):
    task = get_task(scenario.get("task", "stitch"))
    if not isinstance(commands, list) or not 1 <= len(commands) <= 500:
        raise ValueError("Supply 1–500 simulation steps")
    for action in commands:
        if action is not None and (np.asarray(action).shape != (len(task.actions),)
                or not np.isfinite(action).all() or np.max(np.abs(action)) > 1):
            raise ValueError("Invalid manual action")
    env = task.make_env()
    obs = env.reset(config=config_for(scenario, 0))
    policy = BaselinePolicy(task=task.id)
    observations, actions, manual = [], [], []
    done = truncated = False
    for command in commands:
        check()
        action = policy.act(obs) if command is None else np.asarray(command, dtype=float)
        observations.append(obs.copy())
        actions.append(action.copy())
        manual.append(command is not None)
        obs, _, done, truncated, info = env.step(action)
        if done or truncated:
            break
    output.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(output / "correction.npz", observations=observations,
                        actions=actions, manual=manual, task=task.id)
    if render:
        renderer = mujoco.Renderer(env.model, height=480, width=640)
        try:
            Image.fromarray(render_frame(env, renderer, "operator", task.id)).save(output / "manual.jpg")
        finally:
            renderer.close()
    return dict(info=info, task=task.id, scenario_id=scenario["id"],
                executed_steps=len(actions), manual_steps=sum(manual), terminal=bool(done or truncated))
