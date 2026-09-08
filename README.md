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
