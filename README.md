# Soren policy lab

A working experiment workspace for natural-language scenario generation, native MuJoCo evaluation, reward composition, PPO training, and baseline/candidate comparison.

## Run the complete application

Requires Node.js 22.13+, Python 3.14, and Chrome for browser acceptance tests. The current dependency lock targets Python 3.14. On macOS, native offscreen rendering uses OpenGL; Linux workers need a working EGL or OSMesa configuration.

```sh
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-lab.txt
npm run lab
```

Open **http://127.0.0.1:3210**. The launcher starts the web application and Python worker, creates a random local worker credential in the ignored `.dev.vars`, and stops both processes on Ctrl+C. Set `LAB_PORT` to choose a different port.

For Astra planning, install the Codex CLI and authenticate using `codex login`. The worker uses `gpt-6-astra` by default (`LAB_ASTRA_MODEL` overrides it). Credentials remain in the CLI's authentication store; they are not copied into the app or exposed to the browser. Astra receives the task and the bounded environment/reward schema, and returns structured configuration. There is no silent replacement with a different model. The explicitly labeled built-in gap/stiffness sweep also works without model access.

To run the components separately:

```sh
npm run dev -- --port 3210
# In another terminal, after configuring .dev.vars:
.venv/bin/python -m lab.worker --url http://127.0.0.1:3210
```

## Workflow

1. **New experiment:** select **Suturing** or **Object lifting**, enter the improvement task, and select Astra or the built-in sweep.
2. **Generate:** produce exactly 16 distinct configurations, validate physical parameters, compile/reset each scene, and render real thumbnails.
3. **Evaluate baseline:** run 1–10 episodes per scenario from the browser (API limit: 20). Each scenario's first episode has a native MP4; every episode has a trajectory, telemetry, and versioned manifest.
4. **Rewards & training:** inspect or edit five bounded reward weights and run PPO for 1,024–131,072 transitions. The actor starts from the selected task's NumPy checkpoint with verified action parity (including the lifting gripper's binary close/open command). A critic and stochastic exploration enable real policy-gradient updates. Continue from a saved candidate to resume weights, optimizer state, and transition count at a new episode boundary.
5. **Compare:** evaluate the trained checkpoint on the same configurations and episode seeds as the completed baseline. Inspect paired recordings, success counts, failures, and regressions. Comparison automatically uses the baseline's episode count.
6. **Refine with Astra:** create a child experiment using the latest completed baseline and candidate development evaluations plus optional user feedback. Repeated evaluations of different checkpoints are not pooled. Previous plans, rewards, checkpoints, and runs remain immutable.

Gallery selection opens playback, measured gap/tension, a time scrubber, configuration, and artifact links. Experiments survive refresh; their URL includes the selected experiment ID. Jobs expose progress, errors, and cancellation.

## Implementation

| Location | Responsibility |
| --- | --- |
| `app/workspace.tsx`, `app/globals.css` | Experiment UI, gallery, telemetry, reward controls, comparison |
| `app/api/lab/[...path]/route.ts` | Experiment/job API, validation, leases, artifact access |
| `db/schema.ts`, `drizzle/0001_lab.sql` | D1 schema and idempotent hosting migration |
| `lab/tasks.py`, `lab/specs.py`, `lab/planner.py` | Task/checkpoint registry, bounded configuration, structured Astra planning |
| `lab/runtime.py` | Reusable native rollout/rendering and provenance |
| `lab/rewards.py` | Reward composition; fixed simulator completion logic |
| `lab/rl.py` | Gymnasium wrapper, actor migration, PPO, checkpoint resume/inference |
| `lab/worker.py` | Job execution, heartbeat, cancellation, uploads |
| `stitch/`, `bootstrap/` | Existing suturing and object-lifting physics, teachers, and policies |

The React/vinext frontend retains Sites compatibility. D1 stores experiments, jobs, and run metadata; R2 stores recordings, trajectories, reports, and policy checkpoints. Locally, Miniflare persists these services under `.wrangler/`. The Python worker only accesses them through authenticated HTTP endpoints. `.lab/` contains worker scratch files and test evidence; it is not the authoritative database.

Workers atomically claim jobs with a 60-second renewable lease, heartbeat every three seconds, and publish using a unique attempt token. Stale or cancelled attempts cannot publish results. Expired attempts may be retried up to three times. Only one active job per experiment is permitted. All runs belonging to a reclaimed attempt are replaced; artifacts from older attempts retain unique immutable keys. Jobs have a one-hour wall-clock limit.

Native physics executes at 500 Hz; control and telemetry run at 20 Hz; recorded video runs at 10 fps. Training skips rendering. Training samples use a disjoint seed range and bounded local parameter variation; evaluation seeds/configurations are retained for paired comparison.

## Verification

```sh
npm run test:python
npm run typecheck
npm run lint
npm run build
# With npm run lab running and one completed baseline/train/candidate experiment:
npm run test:browser
```

The Python tests verify configuration rejection, reproducible execution, independent success criteria, reward shortcuts, Gymnasium compatibility, actual optimizer changes, checkpoint reload, and resumed training. Browser tests exercise real media, byte-range seeking, all 16 scenarios, paired playback, reward controls, persistence, mobile layout, new task creation, job conflicts, and cancellation. They do not substitute fixture results for worker execution.

The acceptance experiment generated by Astra completed **48/48 baseline** and **48/48 candidate** episodes after **8,192 PPO transitions**. After restarting the complete application, training resumed for another **1,024 transitions** (**9,216 total**), and the resumed checkpoint also completed **48/48 episodes**. All checkpoints were evaluated on the same 16 scenarios with three seeds each. This demonstrates the complete workflow and equivalent completion performance on that development suite; it does not demonstrate a generalization improvement. Original baseline results remain documented in [stitch/README.md](stitch/README.md).

## Object lifting

Choose **New experiment → Simulation task → Object lifting**. This uses the existing `bootstrap.ExtractionEnv` and recommended `artifacts/policy_recovery.npz`, with 32 state observations and four controls (XYZ motion plus close/open). Astra receives only the lifting mechanics and parameter schema. The built-in sweep covers four object approaches and four tray locations.

| Scenario parameter | Supported range |
| --- | --- |
| Object X / Y | −22 to +22 mm on each axis |
| Object yaw | −8.5° to +8.5° |
| Tray X | 250–320 mm |
| Tray Y | −45 to +45 mm |

Each scenario retains its object pose and tray location while episode seeds vary the starting gripper XY within ±25 mm. Baseline and candidate use paired episode seeds. The native gallery and inspector show object height, horizontal placement error, rim clearance, release, drops, and flagged contact events. Reports and refinement evidence use lifting metrics; they do not reuse wound-gap measurements.

Lifting uses task completion, one-time grasp/clearance/release milestones, net placement progress after rim clearance, action smoothness, and terminal failure rewards. PPO training, checkpoint download/resume, and candidate evaluation use the lifting actor and preserve its binary gripper command. Cross-task checkpoint loading and refinement are rejected. Existing experiments without a task identifier continue to use suturing.

The first real Astra-generated lifting suite ran **48 baseline episodes across 16 scenarios**: **44 successes**, **3 drops**, and **9 flagged contacts**. Failed episodes remain in the gallery, recordings, and aggregate placement metrics. These are development results, not a claim of improved performance.

Object shape, collision box, mass, friction, cavity, and tray dimensions remain fixed in this simulator. Grasping is assisted by a weld gated on actual finger closure and proximity. This adds test cases for the existing lifting task; it does not model arbitrary objects or a new robot.

## Scope and deployment

The suturing environment is **needle transfer and wound closure under tension**, using rigid spring-mounted patches, assisted grasp transfer, and simplified penetration. It does not model deformable tissue, puncture resistance, tearing, a full robot, or knot retention. The policy receives simulator state, not camera images. Astra cannot add unsupported mechanics by changing a parameter. Physical calibration and clinical validation are not established.

Reward composition changes training incentives without changing the environment's fixed success/failure checker. All gallery evaluations are **development evaluations**, not a sealed final test set. Refinement consumes that development evidence. Medical acceptance criteria and physical validation require separate work.

For hosted execution, deploy the frontend through Sites with the existing `DB` and `ARTIFACTS` bindings, configure matching `LAB_WORKER_TOKEN` secrets, and run the Python worker on a compute host pointed at the deployed URL. Hosted UI requests require the `lab_access` cookie matching `LAB_ACCESS_TOKEN`; keep deployment private and integrate organizational authentication before multi-user use. No cloud compute or hosted deployment is automatically provisioned by the local launcher.

The original command-line workflows remain available: [BOOTSTRAP.md](BOOTSTRAP.md), [RECOVERY.md](RECOVERY.md), and [stitch/README.md](stitch/README.md).
