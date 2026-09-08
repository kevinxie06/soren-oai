# Soren

This repository contains a minimal web workspace and a CPU-based MuJoCo policy bootstrapping project. The web app currently displays a landing page with no simulator connection or controls.

## Web app

Requires Node.js 22.13 or newer.

```sh
npm ci
npm run dev
```

Open the local URL printed by the development server.

```sh
npm run typecheck
npm run lint
npm run build
npm start
```

The app uses React and vinext with the existing Sites hosting configuration.

## Policy bootstrapping

The independent Python component supports scripted demonstrations, behavior cloning, evaluation, and video recording with MuJoCo. See [BOOTSTRAP.md](BOOTSTRAP.md) for setup, commands, and limitations, and [RECOVERY.md](RECOVERY.md) for the recovery policy workflow. Checkpoints, datasets, and evaluation results are in `artifacts/`.

On macOS or Linux, create an environment and run the Python tests with:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-lock.txt
npm test
```

Windows commands are documented in [BOOTSTRAP.md](BOOTSTRAP.md).

## Suturing policy prototype

See [across-wound needle transfer and closure](stitch/README.md) for the learned policy, setup commands, and measured results: 98/100 fresh simulation successes. Opposing jaws receive the needle, and thread tension draws the wound edges together. Penetration and grasping are simplified; closure is held under tension, with no knot. The earlier channel-only experiment is preserved in suturing/.

## Recorded heart-policy showcase (no Isaac Sim required)

For the revised suturing use case, see [across-wound needle transfer and closure](stitch/README.md): opposing entry/exit points, receiving jaws, donor release, and physical closure under thread tension in a simplified CPU MuJoCo model. The earlier channel-only experiment is preserved in `suturing/`; it does not perform wound closure.

Open `/showcase` to play measured motion from the trained heart policy. The page includes an interactive 3D surgical-context prototype, the original simulation geometry, the native MuJoCo MP4, a scrubber and speed controls, recorded outcome metrics, and Unreal export downloads. Compare Current version and Old version in either showcase.

```powershell
.\.venv\Scripts\python.exe -m bootstrap.export_motion --video
npm ci
npm run dev -- --port 3000
```

Use the actual port printed by the server; the verified local session is `http://127.0.0.1:3002/showcase`. See [Unreal handoff and motion schema](unreal/README.md). The checked-in export is a successful 5.55-second rollout of seed 30000 with 0.71 mm placement error. It is measured policy execution, not generated choreography.

`unreal/SorenPlayback.uproject` and `unreal/import_soren.py` provide a UE 5.7 Sequencer import path. Unreal is not installed here, so no Unreal render or editor execution is claimed. The patient/drapes are decorative proxy geometry; photorealism needs licensed models, art direction and an Unreal workstation. There is no tissue simulation or real-person recording.

Verification: `npm run typecheck`, `npm run build`, `node scripts/test-showcase.mjs` (set `SHOWCASE_URL` if needed), and `.\.venv\Scripts\python.exe -m unittest discover -s tests -v`. The browser check saves desktop/mobile screenshots under `artifacts/showcase/`.
