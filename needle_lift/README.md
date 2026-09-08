# Needle lift: NVIDIA source package

**Status: source and launch adapter configured; learned inference is blocked. No needle-policy checkpoint is bundled.** The direct upstream launch was attempted on this workstation and failed importing `isaaclab`. Matching entry points also report blockers rather than a successful rollout. No needle rollout, success rate or locally rendered video is claimed.

## What was found and downloaded

| Component | Availability |
| --- | --- |
| Task/environment | Downloaded NVIDIA i4h-workflows v0.5.0, commit `fb7727ef12e980022997fccb6cbca5621e4616e4` |
| Robot | dVRK Patient Side Manipulator configuration and 22.25 MB PSM USD root layer |
| Needle | Suture needle with SDF collision geometry; 0.90 MB USD root layer |
| Table | 18.84 MB USD root layer |
| Demonstrator | Upstream GPU state machine `lift_needle_sm.py`; **scripted, not trained** |
| Training/inference source | RSL-RL `train.py`, `play.py`, needle task registration and agent configuration |
| Pretrained needle checkpoint | **Not found** in the inspected repository, published release attachments, or linked workflow documentation |
| Local inference/recording | Blocked by missing checkpoint, missing Isaac runtime and unsupported workstation hardware/OS |

The current main checkout (`9c3cc5a94238ecf47b7704184201f8a0182313b9`) explicitly registers only `rule-based`, `replay` and `idle` for `surgical_lift_needle`. Its catalog marks needle policy readiness unavailable. Its stack is Isaac Sim 6.0.1 / Python 3.12 with pinned Isaac Lab `ffff603eafc6b74264a5261cc0183d6a65390d78`. This is distinct from the older Isaac Lab task requested here. We chose the pinned v0.5.0 legacy implementation as the adapter reference because it contains the actual RSL-RL play path. Neither inspected version supplies needle weights.

See [source audit](../artifacts/needle_lift/sources.json), [release attachment inventory](../artifacts/needle_lift/release_assets.json), [downloaded asset hashes](../artifacts/needle_lift/assets.json), and [direct upstream failure log](../artifacts/needle_lift/upstream_attempt.log). Asset root layers are downloaded; **their external dependency closure has not been resolved in USD/Isaac**. The upstream configuration retains its original HTTPS asset URLs, so this is not an offline asset bundle.

## Commands on this workstation

Run at the project root, matching the heart package's `python -m ...` convention:

```powershell
# Inspect concrete readiness; exits nonzero while prerequisites are missing
.\.venv\Scripts\python.exe -m needle_lift doctor
# Scripted upstream needle preview (also blocked here)
.\.venv\Scripts\python.exe -m needle_lift preview
# Learned upstream inference (requires a verified checkpoint)
.\.venv\Scripts\python.exe -m needle_lift evaluate
# Learned upstream inference with native recording
.\.venv\Scripts\python.exe -m needle_lift record
```

Results are JSON files under `artifacts/needle_lift/`. `status: blocked`, `success: null`, and `simulation_started: false` describe the actual local outcome. Null is not success or a measured failure rate. Unlike the heart evaluator, the unmodified upstream play script does not provide task success/drop/contact counters. If a supported run later exits successfully, this adapter reports `upstream_exited_unscored`, not task success.

## Setup on a supported machine

The existing host is Windows / Python 3.14.3 / Intel Arc 140V, without `nvidia-smi`, Isaac Sim, Isaac Lab or RSL-RL. This is not an install-only problem: Isaac requires NVIDIA hardware. Use an Ubuntu 22.04/24.04 workstation with a supported NVIDIA RTX GPU. Upstream recommends Ampere-or-newer, RT cores and 24 GB VRAM; its README also contains a conflicting 8 GB memory line, so use the stricter stated recommendation. No cloud resources have been provisioned.

The **v0.5.0 setup script**, rather than its stale overview text, pins **Isaac Sim 5.1.0, Isaac Lab release/2.3.0, Python 3.11**, and `i4h-asset-catalog` v0.3.0. The overview mentions Sim 5.0.0; do not mix that text with the executable 5.1 installer. Do not install these dependencies into the heart `.venv`.

From the project root on that machine:

```bash
# Reproduce the source checkout if it is absent
mkdir -p upstream
git clone --branch v0.5.0 --depth 1 https://github.com/isaac-for-healthcare/i4h-workflows.git upstream/i4h-workflows-v0.5.0
git -C upstream/i4h-workflows-v0.5.0 rev-parse HEAD
# Expected: fb7727ef12e980022997fccb6cbca5621e4616e4
conda create -n needle_isaac python=3.11 -y
conda activate needle_isaac
cd upstream/i4h-workflows-v0.5.0
bash tools/env_setup_robot_surgery.sh
export PYTHONPATH="$PWD/workflows/robotic_surgery/scripts"
# First verify the original scripted demonstration
python workflows/robotic_surgery/scripts/simulation/scripts/environments/state_machine/lift_needle_sm.py --num_envs 1
```

The setup script downloads Isaac and its dependencies; it does not train a policy. Source is preserved unchanged locally. No full Isaac installation was attempted on the unsupported Windows/Intel machine. Setup and simulator execution on the supported machine remain unverified.

## When actual needle weights are supplied

The smallest missing **policy** artifact is an RSL-RL checkpoint for the exact `Isaac-Lift-Needle-PSM-IK-Rel-v0` task, with the matching robot, framework versions and training configuration. Ask the implementation/model provider for that artifact. A generic lift checkpoint, a dVRK reach checkpoint, a GIF, and an empty `model.pt` are not substitutes. If no compatible weights exist, training is a separate next step requiring authorization; none was started.

Copy `checkpoint_metadata.example.json`, fill it from the real checkpoint provenance, and record its actual SHA256. The sample file is a template, not evidence that weights exist. Once dependencies and weights exist:

```bash
# From project root, with the Isaac environment active
python -m needle_lift doctor --checkpoint /path/to/needle_model.pt --checkpoint-metadata /path/to/needle_metadata.json
python -m needle_lift evaluate --checkpoint /path/to/needle_model.pt --checkpoint-metadata /path/to/needle_metadata.json
python -m needle_lift record --checkpoint /path/to/needle_model.pt --checkpoint-metadata /path/to/needle_metadata.json
```

Alternatively pass `--python /path/to/needle_isaac/bin/python` from another Python environment. The adapter launches the pinned upstream `play.py` as a subprocess, stages the unchanged checkpoint under its required `logs/rsl_rl/needle_lift/imported/model.pt` layout, and sets the original module paths. It does not import or convert weights in the heart process. `evaluate` and `record` both use upstream `--video --video_length 200` to bound playback; upstream otherwise runs until closed. Native MP4s, if produced, are copied with a `learned_` prefix and accompanied by the launch log. GUI preview is `preview --gui`; it runs the separate absolute-pose scripted controller and is labeled scripted in JSON.

## Preserved task-specific interface

This is a launch-level adapter, not a fabricated `Policy.act()` implementation. Without trained weights and a working runtime, a per-observation policy wrapper cannot be verified. The external preview/evaluate/record workflow matches the heart package; the internals do not share its dimensions or NPZ format.

- Relative-IK learned task: six pose-delta values plus one binary gripper action, DLS IK at `psm_tool_tip_link`, `PSM_HIGH_PD_CFG`. Upstream pose-delta scale is **0.5**. It is not the heart controller's 12 mm bound. Preserve the upstream action processor and clipping behavior; no new clipping is imposed.
- Gripper commands use the two PSM jaws: open joint targets -0.5/+0.5 rad, close -0.09/+0.09 rad. Upstream scripted actions use positive for open and negative for close, opposite to the heart action convention.
- Pose deltas are applied by Isaac Lab's robot-root-frame relative pose IK; translations use meters, rotations radians, pose quaternions use wxyz. The binary gripper is dimensionless.
- Observations concatenate relative joint positions, relative joint velocities, object position in the robot root frame, generated object pose command and previous action. Dimension/joint ordering must be resolved from the loaded upstream robot, not guessed from the heart schema.
- Policy actor: ELU MLP hidden sizes 256/128/64 in upstream RSL-RL configuration. Actor/critic observation normalization is configured false; preserve checkpoint/configuration agreement rather than applying heart normalization.
- Physics 200 Hz; decimation 4 gives **50 Hz control**; nominal episodes are two seconds. The needle scale is 0.4; initial world center is (0,0,0.015) m and robot base z is 0.15 m. Original physical contact/actuator mechanics are unchanged.
- The legacy task rewards lifting and goal tracking; its termination terms are timeout and object below -0.05 m. These are not the heart task's release-in-tray success test. No new rewards or scoring were added.

## Sources and licenses

- [NVIDIA current workflow catalog](https://github.com/isaac-for-healthcare/i4h-workflows)
- [Pinned legacy task and setup instructions](https://github.com/isaac-for-healthcare/i4h-workflows/tree/fb7727ef12e980022997fccb6cbca5621e4616e4/workflows/robotic_surgery)
- [Pinned executable dependency installer](https://github.com/isaac-for-healthcare/i4h-workflows/blob/fb7727ef12e980022997fccb6cbca5621e4616e4/tools/env_setup/install_isaacsim5.1_isaaclab2.3.sh)
- [NVIDIA release artifacts](https://github.com/isaac-for-healthcare/i4h-workflows/releases)
- [NVIDIA healthcare asset catalog](https://github.com/isaac-for-healthcare/i4h-asset-catalog)
- [Original ORBIT-Surgical lineage](https://github.com/orbit-surgical/orbit-surgical), linked by NVIDIA; task/training examples are not evidence of downloadable trained weights.

Upstream copyright/license headers and root licenses are retained. Workflow integration is Apache-2.0; inherited ORBIT/Isaac Lab files carry BSD-3-Clause headers. Simulator and asset terms remain their respective upstream terms; assets are not relicensed by this adapter.
