"""Docker health check for the Soren control API; never print the token."""
import json
import os
import sys
import time
from urllib.request import Request, urlopen


try:
    request = Request(
        "http://127.0.0.1:8211/health",
        headers={"Authorization": "Bearer " + os.environ["ISAAC_CONTROL_TOKEN"]},
    )
    with urlopen(request, timeout=5) as response:
        state = json.load(response)
    healthy = state.get("ready") is True and time.time() - state["updated_at"] < 10
except Exception:
    healthy = False
sys.exit(0 if healthy else 1)
