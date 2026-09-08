#!/usr/bin/env bash
# Run on the Brev VM after copying this repository's simulator and scripts.
set -euo pipefail

action="${1:-help}"
if [[ "$action" == help ]]; then
  echo 'Usage: bash scripts/brev-sim.sh {setup|check|smoke|start|status|logs|stop}'
  echo 'Set GPU_IP to the reachable GPU IPv4 address for smoke/start.'
  echo 'Setup and execution accept the NVIDIA container EULA.'
  exit 0
fi
case "$action" in setup|check|smoke|start|status|logs|stop) ;; *) echo 'Unknown action.' >&2; exit 2 ;; esac
[[ "$(uname -s)" == Linux ]] || { echo 'Run this on the Ubuntu GPU VM.' >&2; exit 1; }
project="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime="${SOREN_RUNTIME_DIR:-$HOME/workspace/soren-isaac-runtime}"
image='nvcr.io/nvidia/isaac-sim:6.0.1'
container='soren-isaac-sim'
docker_cmd=(docker)
if ! docker info >/dev/null 2>&1; then docker_cmd=(sudo docker); fi

case "$action" in
  setup)
    nvidia-smi
    mkdir -p "$runtime"/{main,compute,logs,config,data,pkg}
    sudo chown -R 1234:1234 "$runtime"/{main,compute,logs,config,data,pkg}
    # The container gets this group so the smoke test can write its report.
    chmod g+w "$project"
    if [[ ! -f "$runtime/control.env" ]]; then
      (umask 077; python3 -c 'import secrets; print("ISAAC_CONTROL_TOKEN=" + secrets.token_urlsafe(32))' > "$runtime/control.env")
    fi
    chmod 600 "$runtime/control.env"
    "${docker_cmd[@]}" pull "$image"
    exit 0 ;;
  status) "${docker_cmd[@]}" ps -a --filter "name=^/${container}$"; exit 0 ;;
  logs) "${docker_cmd[@]}" logs --tail 100 "$container"; exit 0 ;;
  stop)
    "${docker_cmd[@]}" stop --time 30 "$container"
    # Docker can return from stop before --rm releases the container name.
    for attempt in {1..30}; do
      if ! "${docker_cmd[@]}" container inspect "$container" >/dev/null 2>&1; then exit 0; fi
      sleep 1
    done
    echo 'Container stopped, but removal is still pending. Check status before restarting.' >&2
    exit 1 ;;
esac

[[ -f "$runtime/control.env" ]] || { echo 'Run setup first.' >&2; exit 1; }
common=(--gpus all --network host --user 1234:1234
  --group-add "$(stat -c '%g' "$project")" --workdir /isaac-sim
  --health-cmd '/isaac-sim/python.sh /workspace/soren-oai/simulator/healthcheck.py'
  --health-interval 30s --health-timeout 10s --health-start-period 300s --health-retries 3
  --entrypoint bash -e ACCEPT_EULA=Y -e NVIDIA_DRIVER_CAPABILITIES=all
  -e ISAAC_SIM_PATH=/isaac-sim --env-file "$runtime/control.env"
  -v "$project:/workspace/soren-oai:rw"
  -v "$runtime/main:/isaac-sim/.cache:rw"
  -v "$runtime/compute:/isaac-sim/.nv/ComputeCache:rw"
  -v "$runtime/logs:/isaac-sim/.nvidia-omniverse/logs:rw"
  -v "$runtime/config:/isaac-sim/.nvidia-omniverse/config:rw"
  -v "$runtime/data:/isaac-sim/.local/share/ov/data:rw"
  -v "$runtime/pkg:/isaac-sim/.local/share/ov/pkg:rw")

if [[ "$action" == check ]]; then
  exec "${docker_cmd[@]}" run --rm "${common[@]}" "$image" \
    ./isaac-sim.compatibility_check.sh --/app/quitAfter=10 --no-window
fi
: "${GPU_IP:?Set GPU_IP to the Brev instance reachable IPv4 address}"
python3 -c 'import ipaddress,sys; a=ipaddress.IPv4Address(sys.argv[1]); assert not (a.is_unspecified or a.is_multicast or a.is_loopback), "Use a remotely reachable IPv4 address"' "$GPU_IP"
launch=(/workspace/soren-oai/scripts/start-sim.sh --public-ip "$GPU_IP" --control-host 0.0.0.0)
if [[ "$action" == smoke ]]; then
  exec "${docker_cmd[@]}" run --rm --name "$container" "${common[@]}" "$image" "${launch[@]}" --smoke-test
fi
# Detached execution survives SSH disconnects. An existing container name
# deliberately causes an error rather than replacing an active simulation.
exec "${docker_cmd[@]}" run -d --rm --name "$container" "${common[@]}" "$image" "${launch[@]}"
