# Policy comparison

Both `/showcase` (heart extraction) and `/suturing` (across-wound stitch) offer
**Current version** and **Old version**. The current checkpoints are unchanged.
“Old version” is an intentionally degraded demonstration baseline, not a historical
checkpoint or evidence that past policy versions had these results.

The baselines retain the parent checkpoints with these explicit faults:

- Heart: a +52 mm Y error in perceived heart position, implemented through the
  observation normalization means for object and relative positions. All network
  weights stay unchanged. An explicitly enabled demo sequencer moves beside the
  heart, opens, lets the biased learned approach descend and close on nothing,
  then lifts, transfers to the tray, opens and retracts without checking grasp
  confirmation. The heart itself never attaches or moves in the displayed recording.
  This is a learned approach plus a scripted faulty task sequencer, not a fully
  learned historical policy. Simulator attachment and success flags remain truthful.
- Stitch: receiving jaw forced open and tension disabled, preventing successful transfer.

Both run closed-loop through the same simulator and success criteria as the current
policy. No trajectory poses, success flags, or evaluation scores are fabricated.
The frozen paired set is seeds 41000–41019. The displayed recording is seed 30000
for both versions, matching the existing current recording without selecting a failure seed.

| Task | Current | Degraded “Old version” |
| --- | --- | --- |
| Heart extraction | 20/20 | 0/20 |
| Across-wound stitch | 20/20 | 0/20 |

These comparisons demonstrate specified controller faults, not a general robustness
benchmark. Heart extraction is still the detached-object transfer task, not a full transplant.

## Reproduce

```powershell
.\.venv\Scripts\python.exe scripts/build-policy-comparison.py
.\.venv\Scripts\python.exe scripts/build-robot-presentation.py --source public/motion/heart-old.json --output public/models/robot/panda-old.glb
.\.venv\Scripts\python.exe scripts/build-stitch-robot.py --source public/motion/stitch-old.json --output public/motion/stitch-old-robot.json
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_policy_comparison.py -v
node scripts/test-robot-presentation.mjs --old
node scripts/test-stitch-robot.mjs --old
node scripts/test-policy-comparison.mjs
```

Pass `--task heart` to rebuild only the heart baseline without changing suturing.

`artifacts/comparison/{heart,stitch}` contains checkpoints, exact modification
provenance and parent hashes, paired evaluation results, and measured NPZ/video/JSON
recordings. Public motion files include the same provenance. Video captions and
in-frame labels identify the degraded baseline. Old robot motion is fitted separately;
the current arm animation is never substituted for a failed trajectory.

The retired NVIDIA needle-lift adapter, its tests, artifacts and dedicated i4h source
checkouts were removed. The independent Isaac live-stream workspace is retained.
