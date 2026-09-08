# Frozen policy evaluation

Untouched scene seeds 20000-20049. Closed-loop simulation; identical scenes for both controllers.

| Controller | Success | Drops / early releases | Unwanted contact events | Mean final XY error |
| --- | --- | --- | --- | --- |
| scripted | 50/50 (100.0%) | 0 | 0 | 0.000 mm |
| learned | 49/50 (98.0%) | 0 | 0 | 7.974 mm |

Drops conservatively include releases outside the settled-placement region. Intended grasp and support contacts are excluded from unwanted contacts. Zero events here does not establish force safety.

Checkpoint SHA256: `6742fc4850d9afe6d7046a7bc71b13e029977438ca1901c82fdb234ba6ede9c0`

Validated: native learned MP4, standalone inference, three tests (numerical backpropagation gradient, remote attachment guard, deterministic successful teacher rollout).

Training: 120 successful episodes, 96 train / 24 validation, 480 epochs, seed 7, NumPy MLP from random initialization. See README for development-set results and simplifications.

Mean XY error over the 49 successful learned episodes: 1.146 mm. The remaining episode timed out; inspect failure_analysis.json and learned_failure.npz. No tuning followed this final evaluation.
