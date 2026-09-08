# Soren Isaac Studio

A locally hosted React app that displays **real NVIDIA Isaac Sim video over WebRTC**, with a Python simulator launcher, a Franka Panda workcell, camera presets, live joint telemetry, and play/pause/reset controls.

The frontend runs on macOS, Linux, or Windows. **The simulator must run on an Ubuntu host with an Isaac Sim compatible NVIDIA RTX GPU and NVENC support.** This Mac can run the frontend and connect to a separate GPU workstation. A blank/offline viewport is expected until that simulator is running; this project does not substitute prerecorded or fabricated video.

This is the robotics visualization foundation for the proposed surgical simulation. The starter scene is a Franka robot, workbench, and geometric training target. It does not implement cardiectomy, tissue cutting, surgical anatomy, or a validated surgical robot controller.

For the configured NVIDIA Brev L40S instance, see [Brev operation](simulator/BREV.md) for start/stop commands, connection settings, and token access. `scripts/brev-sim.sh` manages the Isaac Sim container on that VM.

## Versions and requirements

- Node.js 22.13+; npm; Chrome or Edge.
- NVIDIA Isaac Sim **6.0.1**, installed on Ubuntu with its bundled `python.sh`. The Python launcher targets this release's APIs.
- NVIDIA Omniverse WebRTC SDK **6.7.0**, pinned in `package-lock.json`. `.npmrc` configures NVIDIA's public package registry.
- A GPU and driver meeting [Isaac Sim requirements](https://docs.isaacsim.omniverse.nvidia.com/6.0.1/installation/requirements.html). Streaming requires NVENC; an A100 is not a suitable streaming GPU.
- Internet access on first launch to fetch NVIDIA's Franka USD asset, or a local copy passed with `--robot-usd`.

## Start the web app

From this repository:

```bash
npm ci
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open **http://localhost:3000** in Chrome or Edge. The simulator allows this exact origin and `http://127.0.0.1:3000` by default. Keep port 3000 free, or add the actual origin with `--allow-origin` below.

For a locally served production build:

```bash
npm run build
npm start -- --hostname 127.0.0.1 --port 3000
```

The app uses the bundled React/Vite/vinext structure. Local use does not require a Sites account, Cloudflare deployment, database, or cloud GPU subscription. NVIDIA's streaming SDK is loaded only when connecting.

## Start Isaac Sim on the same Ubuntu machine

Install Isaac Sim 6.0.1 following [NVIDIA's workstation guide](https://docs.isaacsim.omniverse.nvidia.com/6.0.1/installation/install_workstation.html). Accept its license as part of that installation. Copy this repository to the GPU machine, then run:

```bash
ISAAC_SIM_PATH=/absolute/path/to/isaac-sim \
  bash scripts/start-sim.sh
```

The launcher starts a headless RTX viewport, WebRTC streaming, and the control API. It prints a **control token**, then `Scene ready` after assets and physics initialize. First startup may take several minutes.

In the web app, use `127.0.0.1` for **GPU host**, paste the printed token, and click **Connect to Isaac Sim**. The robot starts paused. Click **Play** to advance physics; enable **Robot motion** for a small repeatable joint-motion demonstration. Camera buttons switch the streamed camera. **Reset** returns the robot to its starting pose, disables demo motion, and pauses.

## Web app on a Mac, Isaac Sim on another GPU machine

Example: the Ubuntu GPU host is `192.168.1.50`, reachable from your Mac on the same trusted LAN or VPN.

On the GPU host:

```bash
ISAAC_SIM_PATH=/absolute/path/to/isaac-sim \
  bash scripts/start-sim.sh \
  --public-ip 192.168.1.50 \
  --control-host 0.0.0.0
```

On the Mac, run the web app as above. Open `http://localhost:3000`, enter `192.168.1.50` and the printed control token, then connect. `--public-ip` means the **GPU host address reachable by the browser**; it does not need to be a public Internet address. Do not use `0.0.0.0` there.

Allow the following traffic from your viewing machine to the GPU host:

| Port  | Protocol | Purpose                                  |
| ----- | -------- | ---------------------------------------- |
| 49100 | TCP      | NVIDIA WebRTC signaling                  |
| 47998 | UDP      | Live video / WebRTC media                |
| 8211  | TCP      | This project's authenticated control API |

Opening TCP alone will not deliver video. An ordinary SSH TCP tunnel does not forward the UDP media stream. Use a reachable LAN/VPN route or a deliberately configured WebRTC relay/network setup. This starter does not deploy TURN or provision cloud networking.

If the browser opens the web app at a different origin, authorize that exact origin on the GPU host, for example:

```bash
# Add to the simulator launch command:
--allow-origin http://192.168.1.25:3000
```

The control token protects this project's API. **It does not authenticate NVIDIA's separate native streaming endpoint.** Keep the direct local setup on a trusted network. A public platform needs authenticated session routing, protected signaling, TLS, and network isolation; do not expose these default endpoints as a public service. The default UI uses direct HTTP/WS connections.

A stable control token can be supplied through the GPU process environment as `ISAAC_CONTROL_TOKEN` (at least 16 characters). Otherwise a random token is generated each launch. The app keeps the token only in memory, not in browser storage or URLs.

For a personal local setup, `NEXT_PUBLIC_ISAAC_GPU_HOST` and `NEXT_PUBLIC_ISAAC_CONTROL_TOKEN` in the ignored `.env.local` file prefill the connection fields on every page load. Restart the web app after changing them. These defaults are sent to the browser; leave the token unset when building a shared deployment.

## Use your own environment

```bash
ISAAC_SIM_PATH=/absolute/path/to/isaac-sim \
  bash scripts/start-sim.sh \
  --scene /absolute/path/to/your-environment.usd
```

Custom stages must use **meters and Z-up**, contain their required assets and lighting, and be loadable by Isaac Sim. The launcher opens the stage, adds three session-layer cameras framed around its bounds, and exposes play/pause/reset. It does not save over the USD file. The Franka motion controller and joint telemetry are intentionally unavailable for arbitrary custom stages; add a controller appropriate to your robot in `simulator/run.py`.

For a locally stored **Franka Panda** asset and the included workcell:

```bash
ISAAC_SIM_PATH=/absolute/path/to/isaac-sim \
  bash scripts/start-sim.sh --robot-usd /assets/FrankaPanda/franka.usd
```

Keep the asset's referenced meshes/materials alongside it. `--robot-usd` expects the same 9-DOF Panda articulation; it is not a generic robot importer. `--show-ui` exposes the Isaac Sim editor UI in the stream for debugging.

## Architecture

```text
Browser: React UI + NVIDIA AppStreamer
    |-- WebRTC ----------------------> Isaac Sim RTX viewport
    |-- authenticated HTTP ----------> Python ControlServer
                                           | validated command queue
                                           v
                                      Main simulation thread
                                      USD / physics / cameras
```

Keyboard/mouse viewport interaction travels through NVIDIA's streaming SDK. Product controls use a separate, small standard-library HTTP bridge so acknowledgment, validation, and errors remain testable without Kit. No USD or physics operations execute in HTTP request threads. State updates arrive once per second; video is independent. The UI reports video and control availability separately.

- `app/studio.tsx`: workspace interface.
- `app/use-isaac.ts`: lazy SDK loading, connection lifecycle, timeouts, state polling, and controls.
- `lib/connection.mjs`: validated host, port, and connection settings.
- `lib/simulation.mjs`: state validation.
- `simulator/run.py`: scene, robot motion, camera presets, streaming configuration, and main loop.
- `simulator/control.py`: authenticated HTTP API, bounded command queue, acknowledgments, and expiry.
- `scripts/start-sim.sh`: Ubuntu/installation checks and launch using Isaac Sim's Python.

The API supports `GET /state`, `GET /health`, and `POST /command`. Every request except CORS preflight needs `Authorization: Bearer <token>`. Commands require `Content-Type: application/json`:

```json
{"action":"play"}
{"action":"pause"}
{"action":"reset"}
{"action":"set_camera","camera":"workbench"}
{"action":"set_demo","enabled":true}
```

Successful commands return `{"ok":true,"state":{...}}` **after** the main thread applies them. Expired queued commands are skipped. A 504 means execution was not acknowledged in time; inspect current state before retrying. Payloads are restricted to 4096 bytes and the queue is bounded to 32 commands.

## Validation

Run on any development machine:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

The Node tests cover connection validation. Python tests run an actual local HTTP server and verify authentication, CORS, loading, malformed commands, acknowledgments, bounded queues, expiry, and error recovery. They do not emulate an Isaac Sim GPU.

On the GPU host, run the actual scene smoke checks:

```bash
ISAAC_SIM_PATH=/absolute/path/to/isaac-sim \
  bash scripts/start-sim.sh --smoke-test
```

This checks scene/robot initialization, simulation advancement, pause, camera switching, and reset, then writes `smoke-report.json` in the repository and exits. It does not verify the browser video stream. For acceptance, start normally and verify live decoded video, visible robot motion, camera switching, pause/reset, and disconnect/reconnect in Chrome. Only one viewer should connect to an Isaac Sim instance at a time.

Implementation was built and transport-tested on an Apple Silicon Mac. GPU execution, actual asset loading, and end-to-end WebRTC rendering could not be exercised on that machine; run the GPU checks before treating the integration as verified on your workstation.

## Troubleshooting

- **Offline viewport on a Mac:** expected without an Ubuntu NVIDIA GPU host. macOS does not run this simulator launcher.
- **No video / connection timeout:** wait for `Scene ready`, verify the GPU address and TCP/UDP ports, ensure the GPU supports NVENC, close other streaming clients, and reconnect. Allow the browser's local-network permission if requested.
- **Video works, controls do not:** paste the launcher token, verify TCP 8211, use `--control-host 0.0.0.0` for a remote viewer, and check the exact allowed origin.
- **Heartbeat is stale:** inspect the GPU process and synchronize host clocks. Rendering continues even while simulation physics is paused.
- **Missing Franka assets:** check Internet access from the GPU machine or provide a local `--robot-usd` asset and its dependencies.
- **Older Isaac Sim release:** use matching NVIDIA client/server versions. This launcher targets 6.0.1 and uses compatibility core APIs still supplied in that release.
- **HTTPS page blocked:** use the documented `http://localhost:3000` development path. Public HTTPS deployment needs secured streaming infrastructure in addition to hosting the frontend.

References: [Isaac Sim streaming](https://docs.isaacsim.omniverse.nvidia.com/6.0.1/installation/manual_livestream_clients.html), [WebRTC SDK](https://docs.omniverse.nvidia.com/ov-web-sdk/latest/web-streaming-library/overview.html), [NVIDIA's standalone livestream sample](https://github.com/isaac-sim/IsaacSim/blob/main/source/standalone_examples/api/isaacsim.simulation_app/livestream.py).
