# Suturing presentation

Open **http://127.0.0.1:3002/suturing** on the existing development server, or `/suturing` on the port printed by `npm run dev`. The heart showcase header links to it.

The suturing view now reuses the heart showcase's shared operating room, scanned patient head, draped body, operating table, equipment trolley, IV stand, surgical lamps and Panda mesh. It opens in **Room view**. Camera presets are **Room view, Patient, Operative field, Macro, and Overhead**; free orbit, pan and zoom work across the room scale and close-up scale. The three modes are surgical rendering, measured simulation geometry, and the original native video. Playback supports pause, restart, seek, chapter jumps and 0.25× through 2× speed.

```powershell
# Export the shipped learned recording; no teacher or policy rerun
.\.venv\Scripts\python.exe -m stitch.export_motion
# Refit the presentation robot after changing the motion export
$env:OPENBLAS_NUM_THREADS='1'
.\.venv\Scripts\python.exe scripts/build-stitch-robot.py
# Optional: rebuild the attributed photographic skin-detail material
.\.venv\Scripts\python.exe scripts/build-stitch-material.py
npm run dev
# Verification
npm run typecheck
npm run lint
npm run build
.\.venv\Scripts\python.exe -m unittest tests.test_stitch_export -v
node scripts/test-stitch-robot.mjs
# Set SUTURING_URL if the server runs on another port
node scripts/test-suturing-showcase.mjs
```

`stitch/export_motion.py` loads `artifacts/stitch/learned.npz` and its outcome JSON. It reconstructs kinematics from the stored simulator states without integrating physics or calling the teacher. It exports 209 states at 20 Hz (10.4 seconds), source/checkpoint SHA-256 hashes, grasp flags, continuous needle pose and jaw closure, measured jaw mount positions, thread tension, tissue anchors and wound gap. It copies the matching original MP4 and generates captions. A regression test compares exported poses, jaw locations and gap against the original arrays.

The export also includes every MuJoCo geometry's dimensions, color and frame-by-frame world pose for **Simulation geometry** mode. Primitive capsule axes are converted to Three.js's convention before applying measured rotations. Tissue displacement and unit quaternions are regression-checked.

## Robot, patient and scene loading

`scripts/build-stitch-robot.py` fits the Panda joints to a tool-carrier pose offset from the recorded needle center. `public/motion/stitch-robot.json` contains per-frame joint transforms, the source recording hash and fit diagnostics. The maximum hand-position fit error in the shipped artifact is approximately 0.000992 mm. This measures only the IK reconstruction, not robot or surgical accuracy. The old heart GLB's animation is never started in the suturing view. A separate artifact test applies all suturing frames forward and backward through Three.js and checks the hand position. A visible carrier links the illustrative robot to the opposing holders; that linkage is a presentation approximation, not a validated instrument design.

The room uses the same existing patient GLB, face color/normal maps and Panda GLB as the heart example. Their credits are in `public/models/ATTRIBUTION.md`. If absent, restore sources with `python scripts/fetch-surgical-assets.py` and generate the Panda mesh with `python scripts/build-robot-presentation.py` before fitting suturing. Loading failures show a status message while leaving the built-in procedural scene and native video available.

**Load scene GLB** accepts a local self-contained GLB and replaces the built-in room after successful parsing. Named nodes bind to motion: `motion__needle` follows the needle center and rotation; `motion__donor` / `motion__receiver` follow the corresponding jaw mount. `motion__<geom-name>` follows an exported simulator geometry, such as `motion__pad_left`. Author the node's transform as a local visual offset from its recorded anchor. `userData.replaces` may list additional built-in object names to hide. **Reset scene** restores the bundled patient/robot room. An invalid file reports an error without removing the built-in scene. Uploaded assets remain local to the browser; this UI does not publish them.

Three.js linearly interpolates measured positions, unwrapped angle, closure, gap and tension between frames; discrete flags use the preceding sample. Seeking is absolute, so reverse seeking and restart restore the original opening and grasp state. Macro, overhead and operative-field cameras do not affect playback. Original-video time is offset by one 50 ms step because the simulator's first rendered frame follows its first action. Failed motion fetches and WebGL initialization display an error; the original video remains accessible.

Rendering includes a tapered polished needle, detailed forceps handles/hinges/serrations, textured skin, wet incision walls, soft skin-edge contour, thread filaments, folded woven drapes and gauze. MeshPhysicalMaterial supplies physically based highlights, clearcoat, sheen and anisotropy; room-derived environment lighting, surgical key/fill lights, soft shadows, ambient occlusion, ACES tone mapping and FXAA finish the image. See [Three.js material reference](https://threejs.org/docs/pages/MeshPhysicalMaterial.html). The renderer stops submitting GPU work when playback and camera motion are idle. Meshes, textures, controls and render targets are disposed on unmount.

The skin-detail material is derived from a small neck region of the existing licensed Lee Perry-Smith scan, with broad baked illumination removed. Credits and transformation details are in `public/models/stitch/ATTRIBUTION.md`. It does not depict the scanned person undergoing a procedure. No AI image or new paid asset was generated.

## Fidelity boundary

This is a detailed **real-time reconstruction**, not photoreal surgical footage or a tissue simulation. Instrument handles and linkage appearance are procedural proxies. Their jaw mounts follow the measured trajectory; no claim is made that the illustrated handles are mechanically or collision-feasible. Skin is reshaped into a tapered incision around the measured center-line gap; the simulator actually used two rigid spring-mounted patches. Thus the full skin deformation away from the stitch is cosmetic. Needle thickness/tip finish and smooth thread curvature are presentation approximations; the exported center, radius, angle, anchors and tip trajectory are preserved. The filament has no independent thread dynamics in this renderer.

The final recording closes from 7.57 mm to 0.223 mm after a receiving-jaw catch and donor release. The displayed 98/100 score belongs to the original simplified simulation evaluation, not this visual reconstruction. Closure remains under tension, without a knot. True photorealism and clinically meaningful tissue interaction would require additional art assets and simulation work; this presentation does not establish either.

Browser verification covers patient/robot loading, all five cameras, simulation geometry, invalid and valid GLB loading/reset, playback and pause, forward/backward seeking, restoration of the measured gap, MP4 decoding, 2× speed, downloads and mobile overflow without browser errors. Screenshots are written under `artifacts/stitch/showcase/`.

### Closure presentation

The surgical view eases the successful terminal submillimetre hold to the recorded final gap to remove spring/contact jitter. Its wound-gap overlay uses the same interpolated presentation curve as the skin and thread anchors. This is a visual stabilization, not a policy improvement. Failed episodes are unchanged. Simulation geometry, original video, exported JSON, and evaluation measurements retain the raw oscillations. Absolute-time preprocessing keeps seeking, restart, and playback speeds consistent.

Both procedure pages use `app/camera-controls.tsx`: Room, Patient, Operative field, Macro, Overhead, and Orbit/Pan drag modes (including one-finger touch). Scroll or pinch to zoom. Geometry mode offers field/macro/overhead; native video has no 3D camera controls. Both provide 0.25/0.5/0.75/1/2 playback speeds and task-specific phase seeking. Verify with `node scripts/test-shared-camera-controls.mjs`.

Fullscreen is available on both procedure players in surgical, geometry, and native-video modes. It retains playback and camera controls; use Exit fullscreen or Escape to return. Browser verification: node scripts/test-procedure-fullscreen.mjs.
