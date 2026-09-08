# Recovery collection and second checkpoint

The original checkpoint remains `artifacts/policy.npz`. The recovery candidate is `artifacts/policy_recovery.npz`.

The original seed 20012 timeout showed the gripper oscillating above the object before attachment. To improve this behavior without adding teacher logic at inference, recovery collection lets the frozen baseline act for 15-85 steps, then gives control to the teacher. Teacher labels are recorded at every visited state, including the learned prefix. Only successful complete episodes enter training. No evaluation scenes enter the training dataset.

Reproduce using new output paths:

```powershell
.\.venv\Scripts\python.exe -m bootstrap.recovery --checkpoint artifacts/policy.npz --base-dataset artifacts/demos --start-seed 1000 --episodes 120 --output artifacts/recovery_demos_new
.\.venv\Scripts\python.exe -m bootstrap train --dataset artifacts/recovery_demos_new --output artifacts/policy_recovery_new.npz --epochs 480
.\.venv\Scripts\python.exe -m bootstrap evaluate --checkpoint artifacts/policy_recovery_new.npz --baseline-checkpoint artifacts/policy.npz --start-seed 30000 --episodes 100 --output artifacts/recovery_evaluation_new.json
.\.venv\Scripts\python.exe -m bootstrap record --checkpoint artifacts/policy_recovery_new.npz --seed 30000 --video artifacts/learned_recovery_new.mp4
```

`actions` always contains actions actually applied to simulation, for replay. The optional `expert_actions` array contains supervised teacher targets and is preferred by training when present. These two arrays are intentionally different during the learned prefix. T+1 observations, T labels/actions and per-episode boundaries remain unchanged. Recovery metadata records the prefix length and frozen baseline SHA256. The replay test checks exact observation agreement after applying `actions`.

The shipped recovery dataset contains the original 120 episodes plus 120 successful recovery episodes (seeds 1000-1119), 26,884 total frames and 5,749 frames with teacher corrections. No recovery runs failed. Whole scene seeds retain the modulo-five split: 192 training episodes and 48 validation episodes. Normalization is recomputed only from training episodes. The network architecture, action interface and physical grasp assistance are unchanged; weights are trained anew with seed 7.

Final paired evaluation results and checkpoint choice are recorded in `artifacts/recovery_results.md`. Previously examined scenes are development/regression checks only; seeds 30000-30099 are reserved for the new frozen comparison.
