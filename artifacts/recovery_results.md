# Recovery policy: frozen paired evaluation

All controllers ran on the same 100 previously unused scene seeds, 30000-30099. The recovery checkpoint was frozen before this evaluation.

| Controller | Success | Drops / early releases | Unwanted contact events | Mean final XY error |
| --- | --- | --- | --- | --- |
| Teacher | 100/100 (100%) | 0 | 0 | 0.000 mm |
| Original learned baseline | 98/100 (98%) | 1 | 57 | 4.653 mm |
| Recovery-trained policy | 100/100 (100%) | 0 | 0 | 1.034 mm |

**Use `artifacts/policy_recovery.npz` for the updated handoff.** The original `policy.npz` and its reports remain intact for reproducibility. The architecture and observation/action interface are unchanged.

The updated policy also completes the previously failing scene 20012 in 130 steps, with 4.425 mm placement error and zero flagged drops or unwanted contacts. This is a regression check, not part of the fresh evaluation.

All four tests pass, including exact replay of a recovery episode using its executed actions. Standalone inference and two native-rendered learned MP4s were verified.

Recommended checkpoint SHA256: `317f08f24f58980c8a03a2f26fef6ce53f07376e1840a6cbab7947cd731fbad8`

Baseline checkpoint SHA256: `6742fc4850d9afe6d7046a7bc71b13e029977438ca1901c82fdb234ba6ede9c0`

Metric definitions are unchanged: drops conservatively include opening outside the settled tray region; unwanted events count wall contacts and robot/floor penetration above the documented tolerance, excluding intended support and grasp contacts. Mean final placement error includes failed episodes. The original baseline has two failures on this new set; its earlier 49/50 report covers different seeds.

100/100 on this narrow distribution does not establish general reliability. Assisted grasp, fixed orientation, state observations and the custom gantry remain limitations. See RECOVERY.md for reproducible collection/training commands and dataset provenance.
