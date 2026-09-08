# Learned curved-needle drive

**Superseded for the revised suturing use case:** see [across-wound needle transfer and closure](../stitch/README.md). This older package only drives through a pre-cut channel; it has no receiving jaw or wound closure.

This package trains a needle-driving subskill from random weights using the existing heart-policy NumPy behavior-cloning infrastructure. A rigid curved needle starts held by a simplified Cartesian driver, aligns with two marked points, rotates through a synthetic pad's **pre-cut channel**, and finishes clear of the pad. It does not puncture material, carry thread, tighten a stitch, or tie a knot. It is not a complete suturing policy or a clinically validated controller.

## Verified results

The final checkpoint completed **100/100 fresh closed-loop scenes**, seeds 20000–20099, with zero unwanted needle contacts. The scripted teacher completed the same 100/100. Learned mean entry error was **0.0069 mm**, mean exit error **0.0041 mm**. These are ideal simulator-state measurements in a constrained channel, not physical surgical accuracy. Drops are not applicable because the needle is permanently held. Peak measured unwanted-contact force was zero for both controllers.

The checkpoint was frozen after 30/30 successful development scenes and was not tuned against the final 100 scenes. Full per-scene results and checkpoint hash: [evaluation.json](../artifacts/suturing/evaluation.json). [Learned video](../artifacts/suturing/learned.mp4) is a 12.2-second native simulation rollout, seed 20000. The pad is rendered transparent to expose sub-surface motion; this changes visualization only. The accompanying `learned.npz` contains actual executed actions, observations, and states; `learned.json` identifies the checkpoint and outcome. [Checkpoint](../artifacts/suturing/policy.npz), `policy.schema.json`, `policy.normalization.json`, and `policy.training.json` form the policy handoff. `runtime.json`, `scene.example.json`, and `scene.example.xml` capture simulator versions and a reproducible example scene.

## Setup and commands

Run from the repository root in PowerShell. Uses the existing CPU-only MuJoCo environment and `requirements-lock.txt`; no Isaac Sim, downloaded weights, GPU, or PyTorch is required.

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-lock.txt
# 1. Scripted extraction equivalent: preview a needle pass
.\.venv\Scripts\python.exe -m suturing preview
# 2. Collect into a fresh directory (the shipped demos already exist)
.\.venv\Scripts\python.exe -m suturing collect --episodes 100 --output artifacts/suturing/demos_new
# 3. Collect corrective demonstrations, then train from random initialization
# recovery includes the shipped base demos; use an empty output directory
.\.venv\Scripts\python.exe -m suturing.recovery --output artifacts/suturing/recovery_new
$env:OPENBLAS_NUM_THREADS='1'
.\.venv\Scripts\python.exe -m suturing train --dataset artifacts/suturing/recovery_new --output artifacts/suturing/new_policy.npz --epochs 300
# 4. Evaluate shipped checkpoint against teacher on identical held-out scenes
.\.venv\Scripts\python.exe -m suturing evaluate --start-seed 20000 --episodes 100 --output artifacts/suturing/evaluation_repeat.json
# 5. Native MuJoCo learned-policy video
.\.venv\Scripts\python.exe -m suturing record
# Standalone inference, without importing the teacher
.\.venv\Scripts\python.exe -m examples.suturing_inference
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Pass `--checkpoint artifacts/suturing/new_policy.npz` to evaluate/record a different checkpoint. Videos are file outputs, not interactive windows, and require OpenGL. Their labels distinguish SCRIPTED TEACHER and LEARNED POLICY. JSON sidecars contain measured results and the exact scene configuration.

## Task and interfaces

`NeedleDriveEnv.reset(seed, config=None)` returns an observation; `step(action)` returns `(observation, reward, terminated, truncated, info)`. Reward is terminal success only. Episodes have a 400-step/20-second limit. `env.state()` returns four joint positions, four velocities, and four servo targets. `scene(seed)` generates configuration; `xml(config)` generates the full MuJoCo robot and scene asset without external downloads.

MuJoCo physics runs at 500 Hz; policy control runs at 20 Hz. The world frame is right-handed, Z-up, meters. The four continuous actions are clipped to [-1, 1], then scaled by `[0.002, 0.002, 0.002, 0.04]` (meters, meters, meters, radians) and added to measured joint position. XYZ controls the needle's virtual circle center; rotation is an unwrapped angle about negative world Y. These are commanded increments, not guaranteed physical velocity limits. Unlike the heart policy, the fourth action is rotation, **not gripper closure**. Position servo targets are bounded to XYZ `[-.06,-.05,.025]`–`[.06,.05,.08]` meters and angle `[1.8,9]` radians.

The driver has three slide joints and one hinge with position servos, gravity compensation, and a permanently held 120-degree needle represented by 24 collision capsules. There is no articulated surgical robot, needle pickup, regrasp, or slipping/dropping mechanism. Holder collision is disabled. Needle collision with the rigid pad and floor is enabled; any such contact fails the task. The 7 mm channel represents an already-open path. Contact-force measurements therefore cannot represent puncture forces.

Success requires the measured tip to cross downward within 2 mm of entry, reach at least 75% of needle radius below the surface, cross upward within 2 mm of exit, and leave the full needle clear by 1 mm with the final angle reached and low velocity for 0.5 seconds. Wrong crossings and unwanted contacts terminate immediately. Checks run at physics frequency. Goal points derive from randomized pad center and radius, not teacher phase.

The ordered 27-value float32 observation is exported in `policy.schema.json`: center XYZ and angle, their velocities, goal-minus-current pose, radius, sin/cos angle, tip XYZ, entry XYZ, exit XYZ, entered/exited flags, and maximum depth. Distances are meters; angular quantities radians; velocities per second; flags dimensionless. Flags are geometric history maintained by the environment, independent of teacher actions. A later environment must reproduce these fields and history semantics.

## Dataset, checkpoint, and handoff

100 successful scenes (seeds 0–99) produced 24,929 actions with zero failures or unwanted contacts. The initial network failed all 30 development rollouts (seeds 10000–10029), so it is retained as `policy_baseline.npz` with the original `development.json` report. Low supervised loss did not indicate closed-loop success.

Corrective collection attempted 200 additional scenes (1000–1199), adding Gaussian actuator noise with probability 0.5, standard deviations `[.30,.30,.30,.03]` in normalized action units, disabled within .25 rad of the final angle. The teacher labels the perturbed states; no object or driver teleportation is used. 164 successful episodes were retained; 36 failed (18 invalid entries, 18 invalid exits). Combined dataset: 264 episodes and 72,327 actions. Recovery episodes store both actual executed `actions` for replay and clean `expert_actions` as training targets.

Quality checks verify finite observations/actions, action bounds, and terminal episode boundaries. Each episode NPZ stores T actions, T+1 observations and debug states, T termination labels, and its seed; the JSON sidecar stores configuration, outcomes, and controller version. Failed summaries are separate. Entire scenes with seed modulo 5 equal to zero are validation; no frames from a scene cross splits.

`policy.npz` contains randomly initialized then trained weights `w0,b0,w1,b1,w2,b2` and observation `mean,std`. Architecture: 27 → 64 tanh → 64 tanh → 4 linear, with inference output clipping. Training uses continuous-action MSE, Adam learning rate 0.001, batch size 256, seed 7, 300 epochs; the lowest supervised validation loss selects weights. Normalization is fitted only to training observations with standard-deviation floor 0.02. Configuration, split seeds and history are in `policy.training.json`; normalization also has a readable JSON export.

Load with `from suturing.policy import Policy`, instantiate with the NPZ path, and call `policy.act(observation)` for every fresh simulator observation. The shared loader imports the neural network but does not run/import the scripted teacher. See `examples/suturing_inference.py`. For later RL, copy the exported arrays into an equivalent network (weights use row-input @ weight), retain preprocessing and continuous actions, and implement the task's exact observation/history and actuator semantics. No arbitrary RL-framework checkpoint compatibility is claimed; RL training is not implemented.

Results cover modest scene variation only: pad-center X ±18 mm, Y ±12 mm, surface height 38–48 mm; needle radius 22–28 mm; initial center offset X/Y ±6 mm, Z 4–10 mm; initial angle π minus 0.50–0.70 radians. Generalization to tissue, arbitrary needle planes, different robots, disturbances, and real sensing remains untested.
