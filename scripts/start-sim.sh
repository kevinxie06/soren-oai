#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Isaac Sim needs an Ubuntu NVIDIA GPU host. This Mac can run npm run dev and connect to that host." >&2
  exit 1
fi
if [[ -z "${ISAAC_SIM_PATH:-}" || ! -x "${ISAAC_SIM_PATH}/python.sh" ]]; then
  echo "Set ISAAC_SIM_PATH to your Isaac Sim 6.0.1 installation (the folder containing python.sh)." >&2
  exit 1
fi
if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "NVIDIA driver not found. Install a supported NVIDIA driver on the GPU host first." >&2
  exit 1
fi
cd "$ISAAC_SIM_PATH"
exec ./python.sh "$project_root/simulator/run.py" "$@"
