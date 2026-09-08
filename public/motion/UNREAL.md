# Unreal playback handoff

The working browser showcase is `/showcase`. It replays measured MuJoCo geometry transforms with Three.js and can show the native MuJoCo video. **It is not Unreal rendering.** Unreal Engine is not installed on the verified Windows workstation, so editor import/render remains unverified.

## Run locally

```powershell
.\.venv\Scripts\python.exe -m bootstrap.export_motion --video
npm ci
npm run dev -- --port 3000
```

Open `/showcase` on the port printed by the server (the verification session uses http://127.0.0.1:3002/showcase because 3000/3001 were occupied). The export is seed 30000 from `artifacts/policy_recovery.npz`; no Isaac Sim or cloud GPU is used. Nine Python tests verify policy/environment behavior and measured export/conversion. `node scripts/test-showcase.mjs` checks browser playback on port 3002; set `SHOWCASE_URL` to override.

## Import into Unreal 5.7

1. On an Unreal workstation, open `unreal/SorenPlayback.uproject`. Python Editor Script, Editor Scripting Utilities, Sequencer Scripting and Movie Render Queue plugins are enabled in the project. Use a new project/empty editor session and save other work first: the importer creates a new map and switches to it.
2. Copy `public/motion/heart.json` and `unreal/import_soren.py` to that machine. Use the complete JSON file, not policy weights.
3. In Unreal's Output Log, select Python and execute (adjust absolute paths):

```python
import sys
sys.path.insert(0, r'C:/path/to/soren-oai/unreal')
import import_soren
sequence = import_soren.import_recording(r'C:/path/to/soren-oai/public/motion/heart.json')
```

4. The script creates a uniquely named `/Game/Soren/HeartPlayback*` sequence/map, lights, a camera cut, measured proxy meshes and optional decorative patient/drapes. Press Play in Sequencer. Inspect approach, grasp, lift, transfer and release against the native MP4. It uses world transforms and disables collision/physics on playback actors so Unreal does not resimulate the recording.
5. Keep animated actor origins, dimensions and tracks when replacing meshes. A finished surgical scene needs properly licensed patient/OR assets and art direction. Parent detailed visual assets under the animated proxies or preserve matching pivots; do not retarget this Cartesian gripper motion to an unrelated articulated robot and assume correctness.
6. Render the sequence with Movie Render Queue. Export an image sequence/video using your Unreal installation's supported codecs. No Unreal-rendered MP4 is bundled. The frontend currently offers the verified native video and interactive 3D replay, not an unverified Unreal clip.

The importer targets documented UE 5.7 editor APIs and has been syntax-checked only, not executed in Unreal. Check plugin/API compatibility before production use. The decorative patient is assembled from primitives and is not photorealistic anatomy.

## Data contract

`public/motion/heart.json` uses `soren.motion.v1`. It includes source scene geometry, 112 time samples (initial state + 111 control steps), five named prismatic joint positions in meters, object/gripper positions, actual grasp state, all geometry world transforms, checkpoint SHA256, source seed and measured outcome. Export uses a separate MuJoCo data object to derive transforms from recorded qpos/qvel, so rendering does not alter the policy rollout. Each frame is sampled at 20 Hz; playback interpolates positions linearly and quaternions with slerp in the browser. Unreal uses linear transform keys and unwrapped Euler rotations; the supplied task has only modest object rotations. For arbitrary large rotations, validate the interpolation or resample before using this importer.

Source: right-handed XYZ, Z-up, meters, quaternion **wxyz**.
Unreal: left-handed XYZ, Z-up, centimeters. Chosen axis mapping is **(x,y,z) -> (100x,-100y,100z)**. Orientation is basis-converted using reflection S=diag(1,-1,1): **R_UE=S R_source S**. Stored Unreal quaternion is **xyzw=(-x,y,-z,w)**. A numerical test verifies this matrix identity; merely negating position Y without converting rotation would be wrong. Three.js camera/world uses Z-up with the original source coordinates and no reflection.

MuJoCo MP4 records post-action frames, while JSON also includes the initial frame. The UI accounts for the one-sample (50 ms) offset when switching to video. Video duration is 111/20=5.55 seconds; the last measured pose is at 5.55 seconds. Unreal sequence includes one display frame for the initial sample and ends at frame 112, so its nominal render is 5.60 seconds. This is an explicit endpoint convention, not dropped data.

`presentation_context` is clearly separated decorative geometry; it never enters the simulator. The original collision geometry is unchanged. This remains an already-detached rigid-object extraction with assisted grasping, not cutting, deformable tissue or a real clinical procedure. The merged live Isaac workspace remains accessible at `/` and is independent of this recorded playback.

## Documentation consulted

- https://dev.epicgames.com/documentation/en-us/unreal-engine/python-scripting-in-sequencer-in-unreal-engine
- https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/MovieSceneScriptingDoubleChannel?application_version=5.7
- https://dev.epicgames.com/documentation/unreal-engine/coordinate-system-and-spaces-in-unreal-engine
- https://dev.epicgames.com/documentation/unreal-engine/units-of-measurement-in-unreal-engine
- https://threejs.org/docs/
