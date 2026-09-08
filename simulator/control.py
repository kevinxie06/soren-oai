"""Local control transport. All USD/physics calls stay on the simulator thread.

This module uses only the Python standard library so it can also be tested
without installing Isaac Sim. The HTTP thread only validates and queues work.
"""
from __future__ import annotations

import copy
import hmac
import json
import queue
import threading
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable


class CommandError(ValueError):
    pass


def validate_command(value: object) -> dict:
    if not isinstance(value, dict):
        raise CommandError("Expected a JSON object.")
    action = value.get("action")
    if not isinstance(action, str):
        raise CommandError("action must be a string.")
    fields = {"play": {"action"}, "pause": {"action"}, "reset": {"action"},
              "set_camera": {"action", "camera"}, "set_demo": {"action", "enabled"}}
    if action not in fields:
        raise CommandError("Unknown action.")
    if set(value) != fields[action]:
        raise CommandError("Unexpected or missing command fields.")
    if action == "set_camera" and value["camera"] not in ("overview", "workbench", "top"):
        raise CommandError("Unknown camera preset.")
    if action == "set_demo" and type(value["enabled"]) is not bool:
        raise CommandError("enabled must be a boolean.")
    return value


@dataclass
class Ticket:
    command: dict
    deadline: float
    done: threading.Event = field(default_factory=threading.Event)
    result: dict | None = None
    error: str | None = None
    status: int = 200


class ControlBridge:
    def __init__(self, capacity: int = 32):
        self.commands: queue.Queue[Ticket] = queue.Queue(maxsize=capacity)
        self._lock = threading.Lock()
        self._state = {"ready": False, "updated_at": time.time()}

    def publish(self, state: dict) -> None:
        with self._lock:
            self._state = {**copy.deepcopy(state), "updated_at": time.time()}

    def snapshot(self) -> dict:
        with self._lock:
            return copy.deepcopy(self._state)

    def enqueue(self, command: object, timeout: float = 5.0) -> Ticket:
        ticket = Ticket(validate_command(command), time.monotonic() + timeout)
        self.commands.put_nowait(ticket)
        return ticket

    def drain(self, execute: Callable[[dict], dict], limit: int = 8) -> None:
        """Call exclusively on Isaac Sim's main thread, including while paused."""
        for _ in range(limit):
            try:
                ticket = self.commands.get_nowait()
            except queue.Empty:
                return
            try:
                if time.monotonic() >= ticket.deadline:
                    ticket.error = "Command expired before execution. Reconnect and retry."
                    ticket.status = 504
                else:
                    ticket.result = execute(ticket.command)
            except CommandError as exc:
                ticket.error, ticket.status = str(exc), 409
            except Exception as exc:
                ticket.error, ticket.status = f"Simulator command failed: {exc}", 500
            finally:
                ticket.done.set()
                self.commands.task_done()


class ControlServer:
    def __init__(self, bridge: ControlBridge, host: str, port: int, token: str,
                 origins: list[str], command_timeout: float = 5.0):
        if len(token) < 16:
            raise ValueError("Control token must contain at least 16 characters.")
        self.bridge = bridge
        self.token = token
        self.origins = frozenset(origins)
        self.command_timeout = command_timeout
        owner = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "SorenControl/1"

            def setup(self):
                super().setup()
                self.connection.settimeout(10)

            def log_message(self, *_args):
                # Do not log tokens or payloads.
                pass

            def respond(self, status: int, body: dict):
                data = json.dumps(body, allow_nan=False).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("Vary", "Origin")
                origin = self.headers.get("Origin")
                if origin in owner.origins:
                    self.send_header("Access-Control-Allow-Origin", origin)
                    self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                    self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
                    self.send_header("Access-Control-Allow-Private-Network", "true")
                self.end_headers()
                try:
                    self.wfile.write(data)
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def origin_allowed(self):
                origin = self.headers.get("Origin")
                if origin is not None and origin not in owner.origins:
                    self.respond(403, {"error": "Origin is not allowed. Add --allow-origin to the launcher."})
                    return False
                return True

            def authorized(self):
                if not self.origin_allowed():
                    return False
                supplied = self.headers.get("Authorization", "").encode("utf-8")
                expected = f"Bearer {owner.token}".encode("utf-8")
                if not hmac.compare_digest(supplied, expected):
                    self.respond(401, {"error": "Invalid control token."})
                    return False
                return True

            def do_OPTIONS(self):
                if self.origin_allowed():
                    self.respond(200, {})

            def do_GET(self):
                if not self.authorized():
                    return
                if self.path not in ("/state", "/health"):
                    self.respond(404, {"error": "Not found."})
                    return
                state = owner.bridge.snapshot()
                self.respond(200 if state.get("ready") else 503, state)

            def do_POST(self):
                if not self.authorized():
                    return
                if self.path != "/command":
                    self.respond(404, {"error": "Not found."})
                    return
                if self.headers.get_content_type() != "application/json":
                    self.respond(415, {"error": "Use application/json."})
                    return
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if length <= 0 or length > 4096:
                        self.respond(413, {"error": "Command must be between 1 and 4096 bytes."})
                        return
                    command = validate_command(json.loads(self.rfile.read(length)))
                    if not owner.bridge.snapshot().get("ready"):
                        self.respond(503, {"error": "Scene is still loading."})
                        return
                    ticket = owner.bridge.enqueue(command, owner.command_timeout)
                except (ValueError, UnicodeDecodeError) as exc:
                    self.respond(400, {"error": str(exc)})
                    return
                except queue.Full:
                    self.respond(429, {"error": "Command queue is full. Retry shortly."})
                    return
                if not ticket.done.wait(owner.command_timeout):
                    self.respond(504, {"error": "Simulator did not acknowledge in time. Check state before retrying."})
                    return
                if ticket.error:
                    self.respond(ticket.status, {"error": ticket.error})
                else:
                    self.respond(200, {"ok": True, "state": ticket.result})

        self.http = ThreadingHTTPServer((host, port), Handler)
        self.http.daemon_threads = True
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)

    def start(self):
        self.thread.start()

    def close(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join(timeout=2)
