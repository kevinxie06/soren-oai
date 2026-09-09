# Soren

Soren is a simulation workspace for finding robot-policy failures, correcting them, and testing whether post-training improves the result. It combines native MuJoCo physics, an interactive Three.js frontend, scenario planning, operator demonstrations, and PPO training.

The workflow is simple: **build an experiment -> evaluate the starting policy -> inspect failures -> adjust rewards or demonstrate a correction -> train -> compare matched runs**.

## The Problem

Training robots for high-stakes tasks, such as surgery, is bottlenecked by data. Real surgical data is scarce, hard to label, and too risky to generate through trial and error: a robot cannot learn proper suturing technique by practicing on real patients. This gap is especially acute for rare complications and edge cases, where reliable performance matters most. Without diverse, representative training scenarios, it is difficult to design useful rewards and evaluate whether a policy can handle failure conditions.

The bottleneck also includes tooling. For every new task, someone must build a simulation environment, model the objects involved, and design a reward function, often through painstaking trial and error. That work is expensive even for simple tasks. In surgery, the scenarios most important to cover can also be the hardest and riskiest to collect real data on.

## Our Solution: An Interface for Instant RL Environments

Our product vision is a pipeline where you describe a robotics task in plain language and Astra coordinates the work needed to turn it into a trainable environment:

1. **Asset generation.** Generate reusable objects required by the task. For a task such as dish cleaning, these could include plates, racks, sponges, and cups.
2. **Environment assembly.** Assemble those assets into many simulated environments, potentially thousands of variations of a kitchen sink scene, with different layouts, object states, and conditions.
3. **Reward assignment.** Translate the task's success condition, such as all dishes being correctly placed in a rack, into a reward specification that can be inspected, tested, and refined.
4. **Trainable output.** Deliver an environment and training workflow from a single task description, shortening the path from an initial policy to a working capability.

The ambition is to make this possible in one or two iterations. That is a product goal, not a measured guarantee of the current implementation.

**What this repository implements today:** a working experiment, evaluation, and post-training loop for two existing MuJoCo task families. Astra proposes bounded scenario configurations and reward weights; the workspace generates variations, records policy execution, supports operator corrections, trains candidates, and compares outcomes. Arbitrary asset generation, new task physics, and automatic synthesis of unrestricted reward functions remain part of the broader vision. The current system uses existing assets, implemented mechanics, and predefined reward terms.

## Why This Generalizes to Medicine

Medicine motivates this direction because collecting representative failure data is particularly difficult. The proposed extension goes beyond generating organs, tissue, or vasculature with anatomical and deformable variation: it would identify edge cases missing from a policy's training coverage and generate scenarios specifically targeting those gaps.

Instead of relying only on random variation, the goal is to build targeted suites around where a robot is likely to fail. Heart transplantation, liver abscess treatment, and appendix removal illustrate the longer-term applications. They are not procedures implemented or validated by this repository.

The opportunity is to give surgical teams a safer way to investigate rare complications, identify useful training cases, and practice in simulation before considering physical deployment. Our target is to turn parts of a multi-year data-collection process into targeted generation tasks measured in hours. Achieving that requires anatomically grounded simulation and validation beyond the simplified tasks demonstrated here.

## Why It Matters

The core idea is to bring three normally separate, expert-driven steps into one interface: asset creation, environment design, and reward engineering. Automating and connecting these steps could remove substantial work between identifying a desired robotic capability and testing a trained policy for it.

Our ambition is to generate hundreds of diverse, labeled synthetic scenarios in an afternoon, with reward specifications and a reproducible training loop included. Knowing which data to generate is as important as generating it at scale: measured failures, paired evaluations, and operator demonstrations should guide the next training iteration.

This repository is a step toward that approach. Its purpose is to make failures observable, corrections reusable, and improvements testable. The longer-term vision is a foundation for training high-stakes robotic systems safely and systematically, without using real patients as a trial-and-error training environment. Simulation evidence alone does not establish clinical readiness.

## What you can do

- Create experiments with configurable environment counts, parameter ranges, episode counts, and training budgets.
- Generate bounded scenario plans with Astra or use the built-in study planner.
- Inspect recorded simulations, robot motion, task metrics, and failure outcomes.
- Manually move the simulated robot and save a successful correction as training data.
- Edit reward weights, post-train a candidate, and resume from a saved checkpoint.
- Compare baseline and candidate policies on the same configurations and episode seeds, including regressions.

## Supported environments

| Task | Simulated behavior | Controls and outcomes |
| --- | --- | --- |
| Object lifting & placement | Grasp a heart-shaped rigid object, lift it out of a cavity, and release it onto a tray | XYZ motion and gripper closure; placement error, clearance, release, drops, and contacts |
| Needle transfer & wound closure | Pass a needle across a wound, transfer it between opposing jaws, and pull the wound edges together under thread tension | XYZ motion, rotation, donor and receiver jaws, and tension; entry, exit, transfer, clearance, and wound gap |

These are simplified research environments. The lifting task represents detached-object transfer, not a complete heart transplant. Suturing uses rigid spring-mounted patches and assisted grasp transfer, without deformable tissue or knot tying. Policies observe simulator state. Presentation meshes add visual context; they do not add corresponding collision or tissue mechanics.

## Run locally

Use **Node.js 22.13 or newer** and **Python 3.14** for the pinned Python dependencies. Run commands from the repository root.

### Windows PowerShell

```powershell
npm.cmd ci
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-lab.txt
npm.cmd run lab
```

### macOS / Linux

```sh
npm ci
python3.14 -m venv .venv
.venv/bin/python -m pip install -r requirements-lab.txt
npm run lab
```

Open **[http://127.0.0.1:3210](http://127.0.0.1:3210)**.

The launcher starts the frontend and Python worker. On first launch it creates an ignored `.dev.vars` file containing a random local worker token. Keep the terminal running. Use `LAB_PORT` to select another port. Native rendering requires a working graphics backend; headless Linux hosts may need EGL or OSMesa configured for MuJoCo.

The built-in planner works without model access. Optional Astra planning calls the authenticated `codex` CLI from the worker; the model defaults to `gpt-6-astra` and can be set with `LAB_ASTRA_MODEL`. The planner returns bounded scenario and reward configurations. It does not implement new physics from a prompt or execute model-generated programs.

To start components separately:

```sh
npm run dev -- --port 3210
# In another terminal, with a matching LAB_WORKER_TOKEN configured:
.venv/bin/python -m lab.worker --url http://127.0.0.1:3210
```

On Windows, use `.\.venv\Scripts\python.exe` for the worker command.

## Experiment workflow

1. **Create and review a study.** Choose a task, describe the question, and configure parameter ranges, environment count, seeds, and budgets. Review the plan before launching it. The reviewed study builder supports configurable counts; the Astra planning path currently requests 16 scenarios.
2. **Evaluate the baseline.** Run the starting policy across the generated environments. Inspect success counts, failures, native recordings, and telemetry.
3. **Inspect a simulation.** Open an environment's simulation view to explore the recorded motion and identify where the policy fails.
4. **Train a candidate.** Edit the bounded reward weights and run PPO, or supply a successful manual correction. Training begins from the task's existing actor or resumes a saved candidate.
5. **Compare.** Evaluate the candidate on the baseline configurations and episode seeds. Look at completed tasks, failure types, and regressions alongside reward totals.
6. **Refine.** Use development results and operator feedback to design the next experiment.

Reward weights change training incentives. They never change the simulator's success criteria. A higher training reward alone does not establish a better policy.

## Manual operator corrections

Manual control is available **only in the environment's Simulation view**. Expand **Manual operator control** to:

- **Advance policy** to reach the part of an attempt you want to correct.
- Nudge **X, Y, and Z**, and open or close the gripper. Suturing also exposes rotation, donor/receiver jaws, and thread tension.
- Select **1-20 simulation steps per click** and adjust movement strength.
- Use **Apply grippers / hold** to execute the selected gripper and tension settings.
- **Reset attempt** or **Restore last attempt** for the selected environment.

This is stepped control: each click replays the accumulated commands through native physics and displays the resulting frame. Attempts and executed observation/action pairs are saved. It is not real-time hardware teleoperation.

After the simulator reports success and at least one operator action has executed, **Update from successful attempt** becomes available. Complete baseline evaluation first, then optionally edit the update's reward weights. Update performs 100 behavior-cloning optimizer steps on the operator's actions followed by 1,024 PPO transitions. It resumes the latest candidate when available and saves a new checkpoint with correction provenance.

Manual attempts remain separate from baseline/candidate evaluation scores. Run a candidate evaluation in Compare to check whether the correction helped beyond that demonstration.

## Recorded showcases

| Route | View |
| --- | --- |
| `/` | Experiment workspace, simulations, manual controls, rewards, training, and comparison |
| `/showcase` | Recorded heart-object transfer with an articulated robot and patient presentation |
| `/suturing` | Recorded needle transfer and wound-closure presentation |

The standalone showcases offer **Current version**, **Old version**, playback controls, and motion export. Their Old version recordings are intentionally degraded demonstrations, not historical policy checkpoints. See [Policy comparison](POLICY-COMPARISON.md) for how the faults and outcomes are produced.

## Reproducible training demos

[RL-DEMO.md](RL-DEMO.md) documents saved experiments, reproduction commands, and paired outcome evidence. The recorded lifting-corner development study improved from **54/80 to 70/80 successes**, with **17 fixed failures and 1 regression**. These results describe that selected simulation study, not a held-out generalization benchmark.

Saved experiment links require the corresponding local database. Use the reproduction instructions to create the experiments on a fresh checkout.

## Architecture

| Location | Purpose |
| --- | --- |
| `app/` | React/vinext workspace, experiment composer, research views, and Three.js playback |
| `app/manual-control.tsx` | Operator controls, saved-attempt restoration, and Update flow |
| `app/api/lab/[...path]/route.ts` | Experiment/job API, validation, worker leases, and artifact access |
| `lib/experiment-spec.ts` | Reviewed study specifications and scenario generation |
| `lab/worker.py` | Simulation, evaluation, training, and manual-control job execution |
| `lab/manual.py` | Native replay and operator demonstration capture |
| `lab/rl.py`, `lab/rewards.py` | PPO, behavior-cloning updates, and task-specific reward composition |
| `lab/runtime.py`, `lab/presentation.py` | Recorded trajectories, telemetry, rendering, and presentation exports |
| `bootstrap/`, `stitch/` | Active lifting and suturing physics, starting policies, and teachers |
| `suturing/` | Earlier channel-only suturing experiment |
| `db/`, `drizzle/` | Database schema and migrations |
| `public/`, `artifacts/` | Presentation assets, checkpoints, recordings, and evaluation evidence |
| `tests/`, `scripts/` | Verification and reproducible workflow tools |

D1 stores experiments, jobs, and run metadata; R2 stores recordings, trajectories, reports, and checkpoints. Local services persist under `.wrangler/`. Worker scratch files live under `.lab/`. Keep `.wrangler/` to retain local experiments between sessions.

## Verification

```sh
npm run typecheck
npm run lint
npm run build
```

Python tests:

```powershell
# Windows
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

```sh
# macOS / Linux
npm run test:python
```

With the lab running:

```sh
npm run test:browser
node scripts/test-manual-control.mjs
```

The Playwright suite uses installed Chrome and existing experiment data; some checks require completed baseline and candidate evaluations. The manual-control check requires a generated 16-scenario experiment and submits a small native operator attempt. Python tests cover physics, action validation, replay, reward behavior, checkpoint migration, and actual optimizer updates.

## Configuration and deployment

| Setting | Purpose |
| --- | --- |
| `LAB_PORT` | Local launcher port; defaults to `3210` |
| `LAB_WORKER_TOKEN` | Shared credential for worker API requests; generated locally in `.dev.vars` |
| `LAB_URL` | Worker default URL and browser-test target |
| `LAB_ASTRA_MODEL` | Model selected by the optional Astra planner |
| `LAB_ACCESS_TOKEN` | Hosted browser access credential, checked through the `lab_access` cookie |

Keep credentials out of version control. The repository ignores `.env*` files and `.dev.vars`.

Hosted operation requires the frontend's `DB` and `ARTIFACTS` bindings, matching worker credentials, and a separate Python compute worker pointed at the deployed application. Starting the local lab does not provision cloud compute or deploy the site.

## Further documentation

- [Lifting policy bootstrapping](BOOTSTRAP.md)
- [Recovery training](RECOVERY.md)
- [Needle transfer and closure](stitch/README.md)
- [Measured RL demo](RL-DEMO.md)
- [Degraded-policy comparisons](POLICY-COMPARISON.md)
- [Simulation presentation](lab/PRESENTATION.md)
- [Model credits and licenses](public/models/ATTRIBUTION.md)
- [Unreal motion import](unreal/README.md)
