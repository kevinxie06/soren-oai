# Heart extraction: initial policy bootstrapping

**Updated handoff:** use `artifacts/policy_recovery.npz`. With 120 additional teacher-recovery episodes, it achieved **100/100** successes on fresh seeds, versus **98/100** for the original baseline on the same scenes, with zero flagged drops or unwanted contacts and 1.03 mm mean placement error. The original checkpoint and results below are preserved. See [recovery commands](RECOVERY.md) and [paired results](artifacts/recovery_results.md).

```powershell
.\.venv\Scripts\python.exe -m examples.inference --checkpoint artifacts/policy_recovery.npz --seed 30000
.\.venv\Scripts\python.exe -m bootstrap evaluate --checkpoint artifacts/policy_recovery.npz --baseline-checkpoint artifacts/policy.npz --start-seed 30000 --episodes 100 --output artifacts/recovery_evaluation.json
.\.venv\Scripts\python.exe -m bootstrap record --checkpoint artifacts/policy_recovery.npz --seed 30000 --video artifacts/learned_recovery_rollout.mp4
```


A runnable, CPU-only demonstration-to-policy component: scripted extraction, successful trajectory collection, behavior cloning from random weights, and closed-loop evaluation. No environment-generation agent, RL training, or frontend is included.

## Setup and commands

Verified on Windows, Python 3.14.3, MuJoCo 3.12.0 and NumPy 2.5.3. The machine has Intel Arc graphics; simulation and training use the CPU. The repository was empty at implementation time. PyTorch was tested but Windows Application Control blocked its DLL, so the network uses NumPy backpropagation and Adam. PyTorch is **not required**.

Run from the repository root in PowerShell:

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-lock.txt
# 1. Scripted preview, using the native MuJoCo renderer; writes a labeled MP4
.\.venv\Scripts\python.exe -m bootstrap preview
# 2. Collect 120 scenes; use a new directory when repeating collection
.\.venv\Scripts\python.exe -m bootstrap collect --episodes 120 --output artifacts/demos_new
# 3. Train a fresh network; shipped checkpoint was trained for 480 epochs
.\.venv\Scripts\python.exe -m bootstrap train --dataset artifacts/demos_new --epochs 480 --output artifacts/new_policy.npz
# 4. Compare shipped learned policy and teacher on the same 50 scenes
.\.venv\Scripts\python.exe -m bootstrap evaluate
# 5. Record the shipped learned policy (seed 20000)
.\.venv\Scripts\python.exe -m bootstrap record
# Load and run without importing the teacher
.\.venv\Scripts\python.exe -m examples.inference
# Numerical gradient, attachment guard, deterministic rollout tests
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

To evaluate or record a newly trained checkpoint, pass `--checkpoint artifacts/new_policy.npz`. Preview writes `artifacts/scripted_rollout.mp4`; record writes `artifacts/learned_rollout.mp4`. Both are labeled in-frame and have JSON sidecars. These commands render to files, without opening a window. Headless collection/training/evaluation do not need the renderer. Offscreen video rendering needs a working OpenGL driver.

## Simulation and interface

`bootstrap/env.py` defines `ExtractionEnv.reset(seed, config=None)`, `observation()`, `step(action)`, and `in_tray()`. Step returns `(observation, sparse_success_reward, terminated, truncated, info)`. Timeout is 240 steps (12 seconds); a successful episode terminates earlier. Seeded reset and identical action sequences reproduce trajectories on this installation.

The robot is an intentionally minimal **custom Cartesian gantry abstraction**, not a pretrained commercial arm. Three prismatic joints and position servos control XYZ; two physical sliding fingers control opening. The carriage rails are omitted visually. Cartesian joints give a direct low-level mapping, so no arm IK or proprietary robot asset is needed. MuJoCo runs at 500 Hz, with 25 physics steps per policy action (20 Hz).

Action is float32 shape `(4,)`, clipped to `[-1, 1]`:

| Index | Meaning |
| --- | --- |
| 0, 1, 2 | XYZ desired displacement / 0.012 meters, relative to current measured gripper position |
| 3 | Positive closes fingers; zero or negative opens |

Coordinates are world-frame, right-handed, Z-up, in meters. The servo target workspace is X `[-0.15, 0.45]`, Y `[-0.18, 0.18]`, Z `[0.025, 0.35]`. Maximum commanded displacement per axis is 12 mm per step (0.24 m/s nominal command rate, not an enforced physical velocity limit). The gripper orientation stays identity; no rotational action is supported. Finger travel is 13 mm each; gains and masses are in the model source and exported baseline XML.

Observation is float32 shape `(32,)`; `artifacts/policy.schema.json` lists each name in order:

| Indices | Contents |
| --- | --- |
| 0:3, 3:6, 6:9 | Gripper, object, and tray placement-center XYZ (m) |
| 9:12, 12:15 | Object minus gripper, tray minus object (m) |
| 15:18, 18:21 | Gripper and object linear velocities (m/s) |
| 21:25 | Closed command, attached constraint, cleared-cavity history, released-after-grasp history (0/1) |
| 25:29 | Object quaternion, **wxyz** |
| 29:32 | Object angular velocity from MuJoCo free-joint qvel (local body frame, rad/s) |

All position vectors and linear velocities use world axes. Clearance and release are event-history flags maintained by the environment's physical checks, not teacher stages. No teacher runs during learned inference. The controller requires these state observations; it does not infer them from images. The closed flag reports the commanded gripper state, and attachment requires measured finger travel.

**Assisted grasp:** a MuJoCo weld enables only if the close command is active, both fingers have moved more than 7 mm, and object/gripper centers are within 12 mm. The weld preserves the measured relative pose and does not teleport the object. Opening removes it. Reattachment after release is disabled in this single-attempt task. Teacher and policy share exactly these mechanics. This is not evidence of reliable friction-only grasping.

The cavity has an 85 mm half-width and a 100 mm rim. The object uses a rigid 46 x 50 x 50 mm collision box, with red lobed placeholder visuals. The tray has an 85 mm half-width, a 10 mm floor top and 35 mm walls. The object is already detached. There is no cutting, tissue, physiology, or real surgical model.

Success requires the rotated object's **lowest collision-box point** to have passed above 105 mm while still over the cavity and attached. Subsequently it must be released, the gripper commanded open, the object center within 50 mm of tray center on each horizontal axis and within 12 mm of resting height, and its combined linear/angular velocity norm below 0.04 for 15 consecutive control steps (0.75 seconds). The mixed velocity threshold is a simple settling heuristic. Retraction occurs during this settling interval.

## Demonstrations and training

The teacher progresses through approach, grasp, lift, transport, release and verification using object/tray geometry. It sends the same four action values as the learned policy. The approach aligns horizontally before descending; transport stays above the cavity. The shipped dataset contains 120 successful scenes / 13,345 actions, after a separate ten-scene pilot. No failed demonstrations were used. Quality checks verify finite values, bounds, episode boundaries and stage coverage before training.

Variation: object XY independently +/-22 mm, yaw +/-0.15 rad, tray X 250-320 mm and Y +/-45 mm, initial gripper XY +/-25 mm. Geometry, object mass, friction and robot orientation remain fixed. This is modest in-distribution randomization, not a broad robustness benchmark.

`artifacts/demos/episode_*.npz` stores T+1 observations and simulator states, T actions and termination labels, scene seed, and teacher stages (debug only; **not** policy inputs). State rows concatenate qpos (12), qvel (11), ctrl (5), and equality-active (1). JSON sidecars contain scene configuration, controller version and outcome metrics. Replay by resetting with the sidecar scene and applying saved actions. Simulator states are debugging snapshots, not complete independently restorable MuJoCo checkpoints. `failures.json` keeps unsuccessful-run summaries separately; `quality.json` records inspection. Each file is one episode, so boundaries are explicit.

Scene seeds 0-119 are split by episode: seed modulo 5 equal to 0 is validation (24 scenes); the other 96 scenes train the network. Normalization mean/std are fitted only to training observations, with std floored at 0.02. The network is 32 -> 64 tanh -> 64 tanh -> 4 linear. Movement uses MSE; gripper uses 0.3-weighted binary cross entropy with logits. Inference clips movement and thresholds the gripper logit at zero. Adam uses learning rate 0.001, batch size 256, seed 7 and 480 epochs. The checkpoint with lowest episode-held-out supervised validation loss is saved.

The initial 180-epoch policy succeeded on 28/30 development scenes (seeds 10000-10029). Failure inspection found a premature reopening after grasp and an incomplete grasp. Extending training improved the policy; the refined checkpoint succeeded on 30/30 further development scenes (11000-11029). Neither set is claimed as the final untouched evaluation. The final frozen checkpoint is evaluated on seeds 20000-20049; see `artifacts/evaluation.json` and `artifacts/results.md` for measured results. Development reports are preserved separately.

## Metrics, artifacts and handoff

`unwanted_collisions` counts new contact-pair events between the robot/object and cavity/tray walls, plus robot/floor penetrations deeper than 1 mm. Intended object support and finger/object contact are excluded. This is a contact-event count, not a force or damage estimate. `drops` conservatively counts opening an attached grasp outside the settled placement region; an early release above the tray can count even if it later succeeds. Placement error is final horizontal object-center distance to tray center; failures are included in the overall mean. These definitions matter when comparing policies.

The handoff consists of `policy.npz` (weights and normalization), `policy.training.json` (architecture/configuration/history), `policy.normalization.json`, `policy.schema.json`, `simulator.json`, `baseline.xml`, the requirements files, evaluation reports and both labeled MP4s. The entire training and inference implementation is in `bootstrap/policy.py`. NPZ loading disables pickle.

For later RL, wrap `ExtractionEnv` or implement an adapter with these exact observation and action meanings. Initialize an equivalent MLP from `w0/b0`, `w1/b1`, `w2/b2`; arrays use `input @ weight + bias` (transpose weights for frameworks whose Linear layers store output-by-input). Preserve normalization. Gripper output is a logit; movement outputs are linear before clipping. Choose your RL algorithm's stochastic action distribution explicitly, especially for binary gripper commands. The checkpoint is **not** claimed compatible with arbitrary RL frameworks; no RL trainer or framework adapter is implemented here.

Remaining limits: assisted grasp, custom fixed-orientation gantry, state access, narrow scene variation, simple collision geometry and short settling checks. Generalization to an articulated arm, real grippers, camera observations, moving objects or clinical tasks is untested.

