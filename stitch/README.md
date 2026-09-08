# Across-wound needle transfer and closure

This replaces the earlier channel-only demonstration with a single stitch sequence: a semicircular needle travels across a longitudinal wound, emerges at the opposite marked point, is caught by opposing receiving jaws, is released by the donor, and is pulled clear. A policy-controlled thread tension then physically draws two spring-mounted wound edges together. The wound runs along world Y; the entry-to-exit line runs along X, perpendicular to it.

## Verified results

The final learned checkpoint completed **98/100 fresh closed-loop scenes**, seeds 30000–30099. The scripted teacher completed 100/100 on the same configurations. Both caught/transferred the needle in all 100 scenes, with zero lost needles and zero flagged floor contacts. Mean final wound gap across all learned runs was **0.367 mm**, compared with 0.402 mm for the teacher. These are simulator measurements, not real tissue accuracy.

The two learned failures (30070 and 30080) completed the pass, transfer and clearance but had oscillating thread tension: the gap repeatedly exceeded 0.7 mm, so they did not hold closure for the required 0.75 seconds before timeout. They remain counted as failures even though their terminal gaps were small. Their debug trajectories are retained in `artifacts/stitch/failure_rollouts/`. The checkpoint was frozen after 30/30 development successes and was not changed after this final test.

[Full paired evaluation](../artifacts/stitch/evaluation_feedback.json) · [Learned video](../artifacts/stitch/learned.mp4) · [Checkpoint](../artifacts/stitch/policy.npz). The native learned video runs 10.4 seconds on seed 30000: initial gap 7.57 mm, final gap 0.223 mm. The matching `learned.npz` contains measured actions and states, while `learned.json` identifies its checkpoint SHA-256. Standalone inference without importing the teacher passed. All 17 policy/component tests passed, including guards against remote catching, early release, and closure without thread tension.

## Scope and mechanics

This is a **simplified simulation**, not a complete tissue-suturing model. The wound edges are two rigid patches on spring/damper slide joints, not deformable skin. Needle/pad collision is intentionally disabled to represent penetration; geometric checks require a correct entry and exit, depth, and bite plane. There is no precut transverse channel in this version, but also no simulated tearing or puncture resistance. Floor collision remains enabled. Reported collision counts exclude intended tissue penetration and the non-colliding jaw proxies.

The two colored donor/receiver jaw assemblies represent opposing instrument ends; the instrument linkage and full robot are omitted. They use an **assisted grasp-transfer model**, not frictional needle grasping. The needle is dynamically servo-controlled through a shared Cartesian/rotation driver. The donor starts latched. The receiver can latch only after exit, within 2 mm of the receiving pose, and with jaw closure above 80%; donor release before receiving fails. Low-level jaw mounts track the held needle endpoint. Grasp ownership changes without resetting or teleporting needle position. Closing the receiver remotely cannot catch it. The model does not establish feasibility for a particular physical suturing instrument.

After the completed pass and transfer, a MuJoCo spatial tendon between the two tissue anchors becomes load-bearing. Policy action controls up to 0.6 N of pulling force, causing the spring-mounted edges to move through physics integration. They are never repositioned by the success checker or scripted controller. The trailing filament rendered between needle tail and exit is a visual straight-line approximation; it is not a free cable with self-collision. Thread routing/installation after a valid pass is assisted. The tendon follows the simplified routed-thread approximation supported by [MuJoCo tendon mechanics](https://mujoco.readthedocs.io/en/latest/computation/).

Closure is maintained under tension at the end of the episode. **No knot or lock is tied; releasing tension allows the wound to reopen.** A secure, independently retained stitch, real forceps mechanics, and deformable tissue remain further work. This checkpoint should not be described as performing a complete surgical suture.

Success requires valid entry and exit within 1.5 mm of their marked positions, sub-surface depth greater than 70% of needle radius, a receiving catch, donor release, full needle clearance, and wound gap below 0.7 mm with low needle velocity for 0.75 seconds. Idle motion, premature release, and a pass without thread tension cannot succeed. The same guards apply to teacher and learned evaluation.

## Setup and runnable commands

Run from the repository root. Reuses the existing CPU MuJoCo/NumPy installation in `requirements-lock.txt`; no Isaac Sim or PyTorch required. Verified runtime versions are exported in `artifacts/stitch/runtime.json`.

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-lock.txt
# 1. Preview the scripted stitch as an MP4
.\.venv\Scripts\python.exe -m stitch preview
# 2. Collect successful demonstrations into an empty directory
.\.venv\Scripts\python.exe -m stitch collect --start-seed 1000 --output artifacts/stitch/demos_new
# 3. Train a new policy from scratch
$env:OPENBLAS_NUM_THREADS='1'
.\.venv\Scripts\python.exe -m stitch train --dataset artifacts/stitch/demos_new --output artifacts/stitch/new_policy.npz
# 4. Evaluate the shipped learned policy against the teacher on identical scenes
.\.venv\Scripts\python.exe -m stitch evaluate --start-seed 30000 --episodes 100 --output artifacts/stitch/evaluation_repeat.json
# 5. Record learned execution with native MuJoCo rendering
.\.venv\Scripts\python.exe -m stitch record
# Minimal teacher-free loading and closed-loop inference
.\.venv\Scripts\python.exe -m examples.stitch_inference
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Evaluate/record accept `--checkpoint`. Videos require OpenGL and write to files. `scripted.mp4` and `learned.mp4` are labeled in-frame, have measured NPZ trajectories, and JSON outcome sidecars. The original `suturing/` channel-only checkpoint is preserved for provenance and does not implement this revised task.

## Policy and interface

`StitchEnv.reset(seed, config=None)` returns 38 float32 observations. `step(action)` returns `(observation, reward, terminated, truncated, info)`; reward is terminal success, horizon is 500 steps (25 seconds). `state()` exports full MuJoCo qpos/qvel/control, jaw closure, and measured jaw mount positions. Physics runs at 500 Hz and policy control at 20 Hz.

Seven bounded actions in [-1,1]: XYZ increment (scale 1.5 mm per step), needle rotation increment (scale 0.05 rad about negative world Y), donor closure, receiver closure, and thread tension. XYZ is world-frame, right-handed, Z-up in meters; angle is unwrapped radians. Jaw commands map to closure `(a+1)/2`, with a first-order response. Tension is `max(0,a)*0.6` newtons, gated by completed pass/catch/release/clearance. Servo limits and gains are in `env.py` and exported example XML.

The observation schema includes measured needle pose/velocities, alignment error and final angular error, radius, tip/entry/exit positions, geometric entry/exit history, catch and current grip states, jaw closure, full-needle clearance, current and initial wound gap, edge velocities, tension, and maximum depth. Units are meters, seconds, radians, newtons, and dimensionless flags. No teacher stage or clock is used as an observation. Tissue stiffness is randomized but not provided to the policy; it can observe closure response.

The original 200 demonstrations (0–199; 40,382 transitions) used a teacher with a feed-forward tension target. Its policy caught the needle on every development scene but only closed 22/30 wounds sufficiently; a further 61/100 succeeded on seeds 20000–20099. That checkpoint is retained as `policy_baseline.npz`, with the unsuccessful runs in `development.json` and `evaluation.json`.

The corrected teacher adjusts tension using observed remaining gap and current tension, without accessing hidden tissue stiffness. Corrective collection used seeds 1000–1199: **199 successes, one invalid exit excluded, 46,522 transitions**. Action disturbances have probability .35 per step before clearance and Gaussian standard deviations `[.20,.20,.20,.02]` on XYZ/rotation; after clearance, tension noise has standard deviation .05 with the same probability. Actions are clipped. Training labels are clean teacher corrections at the resulting perturbed states. NPZs store T actual `actions`, T `expert_actions`, T+1 observations/states, seed, and T termination labels; sidecars capture scene/controller versions, noise seed, and outcomes. Quality checks and failed-run summaries are saved separately. Whole scene seeds with modulo 5 equal to zero are held out for supervised validation. Learned rollout files contain executed actions, not expert labels.

`policy.npz` contains a randomly initialized then trained 38 → 64 tanh → 64 tanh → 7 linear network and observation normalization arrays. All outputs are continuous and clipped at inference. Training uses MSE, Adam learning rate .001, batch size 256, seed 7, 300 epochs, training-only mean/std (std floor .001 to preserve millimeter-scale gap variation), and the best supervised-validation checkpoint. Architecture, seeds and losses are in `policy.training.json`; schema and normalization have separate JSON files. The shared heart trainer retains its original default normalization floor.

Load `stitch.policy.Policy(checkpoint)` and call `.act(fresh_observation)` each step; `examples/stitch_inference.py` runs without importing the teacher. This seven-action checkpoint is distinct from the four-action heart and channel-only policies. For later RL, initialize an equivalent network from its exported arrays and preserve this environment's exact observation/history and action semantics; weights use row-input @ weight. No RL framework compatibility or RL training is implemented.

Scene variation is modest: wound center X ±10 mm, Y ±8 mm, surface Z 24 mm; radius 12–16 mm, open gap 6–10 mm, initial XY offset ±3 mm and Z offset 3–6 mm, tissue spring stiffness 65–85 N/m. Different wound orientation, sensing, instruments and disturbances outside this range are unverified.
