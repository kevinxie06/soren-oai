# Brev operation

This deployment uses the `soren-isaac` Brev VM (ID `h3d2g8ktw`), one L40S,
Ubuntu 22.04, and the Isaac Sim 6.0.1 container. The NVIDIA host driver was
updated to 595.91.07. The React interface runs on the Mac at
http://localhost:3000.

The Mac's ignored `.env.local` contains the current GPU host and control token
as connection defaults. Refreshing the page restores those values automatically;
click **Connect to Isaac Sim** to start the stream. Update that local file and
restart the web app if the GPU IP or token changes.

The Mac web app is managed by the current login session's LaunchAgent
`com.soren.isaac.local`, so it survives terminal/chat disconnects. Its temporary
configuration is `/private/tmp/com.soren.isaac.local.plist`, and logs are in
`.wrangler/local-app.log` and `.wrangler/local-app-error.log`. This configuration
does not automatically launch the app after logging out or restarting the Mac.

To stop only the local web app:

```bash
launchctl bootout "gui/$(id -u)/com.soren.isaac.local"
```

To start it again during this login session:

```bash
launchctl bootstrap "gui/$(id -u)" /private/tmp/com.soren.isaac.local.plist
```

If the temporary configuration has been removed, use `npm run dev` from this
repository in an open terminal instead. Stopping the local app does not stop
the Brev GPU or its compute charges.

The initial GPU address is `204.52.26.139`. Check the current address after
stopping and starting the VM. Its TCP/UDP firewall rules restrict ports 49100,
47998, and 8211 to the client public IP used during provisioning. Update those
rules if your client network changes. The control token does not authenticate
the separate NVIDIA streaming service.

## Connect to the VM

```bash
brev refresh
brev shell soren-isaac --host
```

On the VM, the project is at `~/workspace/soren-oai`. Runtime caches and the
private token file are at `~/workspace/soren-isaac-runtime`, a symlink to
`/data/soren-isaac-runtime` on the 256 GiB data disk. Docker images are stored
on the separate 128 GiB system disk.

## Simulator commands (run on the VM)

```bash
cd ~/workspace/soren-oai
export GPU_IP=204.52.26.139  # Replace if the instance address changes.

# Initial setup only: prepares caches/token and pulls the pinned image.
bash scripts/brev-sim.sh setup

# Run separately, with the normal simulator stopped.
bash scripts/brev-sim.sh check
bash scripts/brev-sim.sh smoke

# Start in the background; survives SSH disconnects.
bash scripts/brev-sim.sh start
bash scripts/brev-sim.sh status
bash scripts/brev-sim.sh logs
bash scripts/brev-sim.sh stop
```

`smoke` writes `smoke-report.json` in the project root. It tests GPU scene and
control behavior, not browser video. `start` returns before the scene is ready;
wait for `Scene ready` in the logs. An existing container name prevents starting
a second instance on the same ports. Container health checks use the authenticated
Soren API and its simulation heartbeat. The simulator is intentionally not set to
restart automatically after the VM stops or reboots.

The launcher uses `ACCEPT_EULA=Y`, accepting the NVIDIA container license. It
does not opt into optional telemetry consent. The generated token is stable
across simulator launches and kept in a file with mode 600. Do not commit it.

## Copy the token to the Mac clipboard

Run on the Mac after `brev refresh`:

```bash
ssh -T soren-isaac-host \
  "sed -n 's/^ISAAC_CONTROL_TOKEN=//p' ~/workspace/soren-isaac-runtime/control.env" \
  | pbcopy
```

In the local web interface, enter the GPU address, paste the token, and use
the default ports: signaling TCP 49100, video UDP 47998, controls TCP 8211.

## Stop compute billing

Run on the Mac:

```bash
brev stop soren-isaac
```

Stopping the simulator or closing the browser does not stop the VM. Storage
charges continue while a VM is stopped. To resume:

```bash
brev start soren-isaac
brev refresh
brev shell soren-isaac --host
```

Then run the simulator's `start` command with the current GPU IP. Deleting the
Brev instance deletes its data; copy any work you need before deletion.
