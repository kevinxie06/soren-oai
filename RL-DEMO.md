# A measured RL improvement demo

Use the **lifting corner** experiment as the main demo. In configurations 01
and 02, the original policy cannot acquire the object. PPO post-training enables
it to lift the object, clear the cavity, and release it into the tray.

[Open lifting corner in Compare](http://127.0.0.1:3210/?experiment=72517cad-6c41-4099-9b5c-19142baca9fc&view=compare).
The local lab must be running, with its existing `.wrangler` data intact.

## A one-minute walkthrough

1. Open the link and select **configuration 01** in the comparison table.
2. Point to the scenario counts: **baseline 0/5; candidate 5/5**.
3. Play the paired recordings. The baseline leaves the object in the cavity;
   the candidate completes the lift and placement. These recordings show the
   first matched episode, while counts include all five episodes.
4. Explain: “We identified a repeatable failure in an existing policy, trained
   it through simulator practice, and repeated exactly the same tests. The
   updated policy now completes this task.”
5. Show the complete suite: **54/80 → 70/80 successes**, an increase from 67.5%
   to 87.5%. There are **17 fixed failures and 1 regression**. Configuration 02
   also improves from **0/5 to 5/5**; configuration 04 still fails all five.
6. Open **Rewards & training** to show the saved PPO run, learning curves, and
   downloadable policy checkpoint. Return to Compare for the measured outcome.

In the first recorded configuration-01 episode, the baseline times out at
12 seconds without lifting the object. The candidate completes at **7.9 seconds**,
with **5.31 mm** horizontal placement error, **zero drops**, and **zero flagged
contacts**. [View the final recorded frames side by side](artifacts/rl-demo-2026-09-08/paired-outcome.jpg).

## Saved comparison experiments

All suites have 16 configurations and five paired episodes per configuration.

| Experiment | Baseline | Candidate | Fixed failures | Regressions | PPO transitions / training seed |
| --- | --- | --- | --- | --- | --- |
| [Lifting corner — main demo](http://127.0.0.1:3210/?experiment=72517cad-6c41-4099-9b5c-19142baca9fc&view=compare) | 54/80 | 70/80 | 17 | 1 | 131,072 / 7 |
| [Lifting, opposite corner](http://127.0.0.1:3210/?experiment=d933746a-16f7-4f6b-803c-1157291c363d&view=compare) | 48/80 | 61/80 | 13 | 0 | 32,768 / 31 |
| [Needle offset](http://127.0.0.1:3210/?experiment=d3dea018-bf04-4a57-9af5-6fdd2660302b&view=compare) | 72/80 | 80/80 | 8 | 0 | 32,768 / 31 |

For the shorter lifting run, select configuration 02: **0/5 → 4/5**. Its first
recorded baseline episode times out without grasping; the candidate succeeds
after 7.9 seconds with approximately 2.02 mm horizontal placement error and no
drop or flagged contact. For needle transfer, configurations 09 and 11 have a
failed baseline first episode and a successful candidate first episode.

## Main demo configuration

Choose **Object lifting & placement → Improve**, with these reviewed ranges:

| Parameter | Range |
| --- | --- |
| Object X | −22 to −16 mm |
| Object Y | +16 to +22 mm |
| Object yaw | +8.5° fixed |
| Tray X | 320 mm fixed |
| Tray Y | −45 mm fixed |
| Study seed | 31 |
| Episodes per configuration | 5 |

This creates a 4 × 4 grid over object X and Y. Evaluate the original baseline,
then train **from the original baseline**, using **131,072 transitions** and
**training seed 7**. Keep the default rewards: completion 20, milestones 2,
placement 3, smoothness 0.01, failure 10. Evaluate the candidate in Compare.
The training seed is separate from the study seed that determines evaluation
initialization. Training samples use the existing disjoint training seed range.

The improvement here comes from focused PPO practice on the identified operating
region. Reward weights were kept unchanged; this demonstrates the training loop
without attributing the gain to a reward-weight change.

## Reproduce through the normal platform APIs

With `npm run lab` running:

```sh
.venv/bin/python scripts/run-rl-demo.py examples/rl-demo-lifting-corner.json
```

The runner reviews the specification, creates a separate experiment, waits for
real worker jobs, and saves paired evaluation reports and checkpoint provenance.
It prints the new Compare URL and measured results. It does not substitute
recordings, alter the original policy, or change simulator success criteria.

Use `examples/rl-demo-lifting.json` or `examples/rl-demo-stitch.json` for the
shorter demonstrations. Set `--output .lab/demos/my-demo` to choose an evidence
folder; rerun with that same folder to resume waiting on existing jobs without
creating a second experiment. The default creates a new timestamped folder.

Saved evidence for this session is in `.lab/demos/lifting-corner`,
`.lab/demos/lifting-32768`, and `.lab/demos/stitch-offset`. The platform's D1/R2
storage retains recordings, trajectories, policy checkpoints, and job reports.
The [machine-readable experiment results](artifacts/rl-demo-2026-09-08/results.json)
record all five trials, including the unsuccessful candidates and supplementary
evaluation on additional starting seeds.

## What this establishes

The candidate starts from the original baseline with verified action parity.
PPO changes its actor weights. Evaluation then uses matching configurations and
episode seeds, unchanged environment completion criteria, and the same scoring
weights. The results are measured task successes, not an increase in an edited
reward score. Source and checkpoint hashes are recorded in the manifests.

Five exploratory training trials were run. Two regressed: the opposite-corner
lifting suite at 131,072 transitions with training seed 7 scored **44/80**, below
its **48/80** baseline; the main corner suite at 32,768 transitions with seed 31
scored **50/80**, below its **54/80** baseline. The three better candidates above
were reproduced through the platform and retained for demonstration. Longer
training is not automatically better; Compare is what distinguishes a useful
candidate from a regression.

The selected main candidate was also checked on **10 additional starting seeds
per configuration**, separate from the five episodes displayed in Compare.
Across these 160 extra paired episodes, baseline success was **110/160** and
candidate success was **136/160**, with 29 fixed failures and 3 regressions.
Configurations 01 and 02 were **0/10 → 8/10** and **0/10 → 9/10**, respectively.
This confirms that the demonstrated improvement extends to additional starting
positions in the selected region, while also showing that the candidate can
still fail. These supplementary counts are not pooled into the Compare totals.

These are selected development simulation studies. They demonstrate actual PPO
updates and improved behavior within the tested regions. They do not establish
general improvement across the original task distribution, physical-robot
performance, or clinical validity.
