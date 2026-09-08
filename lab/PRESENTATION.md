# Generated surgical rendering

Generated lifting and suturing suites share the existing showcase renderers,
operating room, patient, materials, lighting, camera controls and Panda mesh.
The gallery captures those same scenes into static images, using one temporary
WebGL context at a time. The selected scenario and comparison players provide
surgical, measured geometry and original-video modes, synchronized playback,
speed, seeking and fullscreen controls.

`runtime.py` exports one initial `motion.json` per scenario and a measured motion
recording for episode zero of each baseline/candidate evaluation. The existing
native videos, trajectories, outcomes and telemetry remain available. Motion
sampling uses a separate MuJoCo data object; it does not change the live physics
state. The frontend never substitutes a showcase recording for a generated run.

`robot_presentation.py` fits the shared Panda to each recording's measured tool
path, using the existing showcase IK method. The small, pinned, mesh-free Panda
kinematic model is bundled in `assets/`; no download is needed by the worker.
The fit is illustrative, as it is in the showcases, and does not validate robot
collision feasibility. If a path cannot be fitted within the error tolerance,
the measured instruments and patient remain visible without an unrelated robot
animation.

An updated worker automatically backfills older scene previews and episode-zero
recordings when idle. `/api/lab/worker/presentation` requires the same worker token
as job execution. It attaches versioned motion artifacts using compare-and-swap;
it cannot replace the saved trajectory, evaluation result or scenario parameters.
Legacy recordings are reconstructed from `trajectory.npz` and `manifest.json`
without invoking a policy or integrating physics. Records still awaiting upgrade
retain the native playback fallback. Restart a long-running worker after updating
the code to enable automatic backfill and future exports.

Verification:

```sh
npm run typecheck
npm run lint
npm run build
.venv/bin/python -m unittest tests.test_lab_presentation tests.test_lab tests.test_lifting_lab -v
# Requires the running local lab with upgraded suites and recordings of both tasks:
node scripts/test-generated-rendering.mjs
# Existing showcase robot regression checks:
node scripts/test-stitch-robot.mjs
node scripts/test-robot-presentation.mjs
```

The presentation tests cover all 16 configurations of each task, identity of
recorded/nonrecorded policy outcomes and state arrays, reconstruction of legacy
archives, fitted robot transforms through the actual GLB/Three.js loader, and
absolute forward/backward/interpolated seeking. They do not constitute visual
browser QA.
