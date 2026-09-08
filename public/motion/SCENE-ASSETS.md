# Surgical scene asset contract

The Surgical context tab accepts a self-contained `.glb` via **Load scene GLB**.
Files stay in browser memory and are not uploaded. Reloading the page clears them.
The bundled scene includes an attributed photogrammetry face scan, a procedurally
modeled draped adult body, operative-field detail, and detailed Panda robot meshes.
The covered body and organ are illustrative geometry, not a segmented patient scan.
See `/models/ATTRIBUTION.md` for source credits and licenses.

The Panda GLB contains joint animation fitted offline to this specific `heart.json`.
Rebuild it whenever the motion changes:

```powershell
.\.venv\Scripts\python.exe scripts/fetch-surgical-assets.py
.\.venv\Scripts\python.exe scripts/build-robot-presentation.py
```

The build fails if sampled tool-position error exceeds 1 mm or orientation error
exceeds 0.01 radians. `/models/robot/fit-report.json` records the motion hash and
errors. This is a kinematic fit, not a Panda rollout; collision avoidance, dynamics,
hardware constraints beyond position limits, and surgical suitability are untested.

Validate the exported GLB with `node scripts/test-robot-presentation.mjs`. This loads
the real artifact in Three.js, checks the source hash, then verifies hand position,
orientation and robot scale across every frame in both playback directions.
With the dev server at port 3002, `node scripts/test-showcase.mjs` checks browser
playback, camera controls, imported GLB success/failure, original video and mobile
layout. Set `SHOWCASE_URL` to use another server. `node scripts/capture-showcase.mjs`
writes room, patient and operative-field screenshots to `artifacts/showcase`.

Author a generic adult patient, drapes, table, lights and equipment as a single
textured scene. Use meshes with base-color, roughness, normal and (where useful)
occlusion maps. Preserve glTF PBR materials. Embed all textures and buffers in the
GLB; external resources and Draco/KTX2 compression are not configured.

## Coordinates and motion

The viewer uses metres, Z up. The operative field is at (0, 0, 0), the patient head
points toward +Y, and the floor is at Z=-0.95. The table mattress is around Z=-0.13.
Ensure final GLB scene transforms use these coordinates; the loader does not apply
the usual glTF Y-up conversion. Bake any authoring/export coordinate conversion.
Use the downloaded `heart.json` to align the operative opening and tray for its seed.
Do not scale anatomy automatically to the simulated object: the current grasp and
cavity dimensions describe a simplified detached-object task.

Static nodes retain their GLB transforms. For a moving replacement, name a top-level
node `motion__<geometry name>`; for example `motion__object_collision`,
`motion__palm`, `motion__finger_l`, or `motion__finger_r`. Its local transform is an
offset in the recorded pose's coordinate system. Avoid nesting motion nodes or
putting them beneath transformed parents. The viewer drives these nodes using the
same interpolated recorded positions and quaternion rotations as the proxies.

An anatomical heart bound to `motion__object_collision` can carry glTF extras:

```json
{"replaces": ["visual_14", "visual_15", "visual_16"]}
```

These hide the original visible heart lobes after successful import. The bound
geometry is hidden automatically. The bundled presentation already hides the source
cavity/tray boxes, heart lobes, and block gripper. A loaded GLB replaces the entire scene, so
include its table and room context. **Reset scene** restores the bundled preview.

## What this does and does not establish

High-resolution anatomical meshes and calibrated materials can improve appearance.
The current recording does not contain incision, dissection, perfusion, deformation,
or a full cardiac operation. A real procedure needs an appropriate motion source,
anatomy, tissue simulation and validation in addition to these rendering assets.
