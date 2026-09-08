"""Run with python -m lab.worker --url http://127.0.0.1:3210.

Each job owns a renewable D1 lease. Only this worker's attempt may publish outputs.
"""

import argparse
import importlib.util
import json
import math
import mimetypes
import os
from pathlib import Path
import shutil
import threading
import time
import traceback
import urllib.error
import urllib.request
import uuid
from .runtime import BaselinePolicy, dump, rollout, thumbnail
from .specs import template_plan, validate_plan
from .tasks import get_task

ROOT = Path(__file__).resolve().parents[1]


class Cancelled(RuntimeError):
    pass


class Client:
    def __init__(self, url, token):
        self.url = url.rstrip("/") + "/api/lab"
        self.token = token

    def request(self, path, data=None, method=None, lease=None, content_type=None):
        headers = {"Authorization": f"Bearer {self.token}"}
        if lease:
            headers["X-Lease-Token"] = lease
        if data is not None:
            if not isinstance(data, bytes):
                data = json.dumps(data, allow_nan=False).encode()
                content_type = "application/json"
            headers["Content-Type"] = content_type or "application/octet-stream"
        req = urllib.request.Request(
            self.url + path,
            data=data,
            headers=headers,
            method=method or ("POST" if data is not None else "GET"),
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                body = response.read()
                return (
                    json.loads(body)
                    if "application/json" in response.headers.get("Content-Type", "")
                    else body
                )
        except urllib.error.HTTPError as error:
            detail = error.read().decode()[:1000]
            if error.code == 409 and lease:
                raise Cancelled(detail) from error
            raise RuntimeError(f"HTTP {error.code}: {detail}") from error


class Execution:
    def __init__(self, client, claimed, worker_id):
        self.client = client
        self.job = claimed["job"]
        self.experiment = claimed["experiment"]
        self.token = claimed["token"]
        self.worker_id = worker_id
        self.base = f"/worker/jobs/{self.job['id']}"
        self.stop = threading.Event()
        self.cancelled = threading.Event()
        self.progress = 0.0
        self.message = "Starting"
        self.folder = ROOT / ".lab" / self.job["id"] / self.token
        self.folder.mkdir(parents=True, exist_ok=True)
        self.started = time.monotonic()
        self.last_heartbeat = self.started

    def post(self, action, data):
        return self.client.request(f"{self.base}/{action}", data, lease=self.token)

    def update(self, progress, message):
        self.progress = min(0.99, progress)
        self.message = message

    def heartbeat(self):
        while not self.stop.is_set():
            try:
                result = self.post(
                    "heartbeat",
                    dict(
                        progress=self.progress,
                        message=self.message,
                        worker_id=self.worker_id,
                    ),
                )
                if not result["active"]:
                    self.cancelled.set()
                    return
                self.last_heartbeat = time.monotonic()
            except Cancelled:
                self.cancelled.set()
                return
            except Exception as error:
                print("Heartbeat retry:", error, flush=True)
                if time.monotonic() - self.last_heartbeat > 45:
                    self.cancelled.set()
                    return
            self.stop.wait(3)

    def check(self):
        if self.cancelled.is_set():
            raise Cancelled("Execution cancelled or lease lost")
        if time.monotonic() - self.started > 3600:
            raise TimeoutError("Job exceeded one-hour execution budget")

    def upload(self, path, name=None):
        self.check()
        path = Path(path)
        return self.client.request(
            f"{self.base}/artifacts/{name or path.name}",
            path.read_bytes(),
            method="PUT",
            lease=self.token,
            content_type=mimetypes.guess_type(path.name)[0]
            or "application/octet-stream",
        )["key"]

    def run(self):
        thread = threading.Thread(target=self.heartbeat, daemon=True)
        thread.start()
        try:
            kind = self.job["kind"]
            data = self.job["data"]
            task = self.experiment.get("task", "stitch")
            get_task(task)
            if kind in ["generate", "refine"]:
                self.update(
                    0.03,
                    "Astra is designing scenarios"
                    if data.get("source") == "astra"
                    else "Building parameter sweep",
                )
                if data.get("source") == "astra":
                    from .planner import generate

                    plan = generate(
                        self.experiment["prompt"],
                        data.get("feedback", ""),
                        self.check,
                        task=task,
                    )
                else:
                    plan = template_plan(self.experiment["prompt"], task)
                plan = validate_plan(plan, task)
                for index, scenario in enumerate(plan["scenarios"]):
                    self.check()
                    self.update(
                        0.1 + 0.85 * index / 16,
                        f"Validating and rendering scenario {index + 1} / 16",
                    )
                    path = self.folder / f"{scenario['id']}.jpg"
                    thumbnail(scenario, path)
                    scenario["thumbnail"] = self.upload(path)
                dump(self.folder / "plan.json", plan)
                result = {
                    "plan_artifact": self.upload(self.folder / "plan.json"),
                    "scenario_count": 16,
                    "task": task,
                    "provider": plan["provider"],
                    "model": plan["model"],
                }
                self.check()
                self.post("complete", dict(plan=plan, result=result))
            elif kind in ["baseline", "candidate"]:
                plan = validate_plan(self.experiment["plan"], task)
                episodes = data.get("episodes", 3)
                if kind == "candidate":
                    from .rl import CandidatePolicy

                    path = self.folder / "candidate.zip"
                    path.write_bytes(
                        self.client.request("/artifacts/" + data["checkpoint"])
                    )
                    policy = CandidatePolicy(path, task=task)
                else:
                    policy = BaselinePolicy(task=task)
                outcomes = []
                total = len(plan["scenarios"]) * episodes
                for index, scenario in enumerate(plan["scenarios"]):
                    for episode in range(episodes):
                        self.check()
                        self.update(
                            len(outcomes) / total,
                            f"{kind.capitalize()}: scene {index + 1}/16 · episode {episode + 1}/{episodes}",
                        )
                        folder = self.folder / scenario["id"] / str(episode)
                        result = rollout(
                            scenario,
                            episode,
                            policy,
                            folder,
                            kind,
                            record=episode == 0,
                            reward_weights=data.get("reward", plan["reward"]),
                            check=self.check,
                        )
                        run = dict(
                            id=f"{self.job['id']}-{scenario['id']}-{episode}",
                            scenario_id=scenario["id"],
                            controller=kind,
                            episode=episode,
                            **result,
                        )
                        prefix = f"{scenario['id']}/{episode}"
                        for field, filename in [
                            ("telemetry", "telemetry.json"),
                            ("manifest", "manifest.json"),
                            ("trajectory", "trajectory.npz"),
                        ]:
                            run[field] = self.upload(
                                folder / filename, f"{prefix}/{filename}"
                            )
                        if episode == 0:
                            run["video"] = self.upload(
                                folder / "rollout.mp4", f"{prefix}/rollout.mp4"
                            )
                            run["thumbnail"] = self.upload(
                                folder / "thumbnail.jpg", f"{prefix}/thumbnail.jpg"
                            )
                        self.post("runs", run)
                        outcomes.append(result["info"])
                successes = sum(o["success"] for o in outcomes)
                n = len(outcomes)
                p = successes / n
                z = 1.96
                center = (p + z * z / (2 * n)) / (1 + z * z / n)
                spread = (
                    z
                    * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
                    / (1 + z * z / n)
                )
                result = dict(
                    episodes=n,
                    successes=successes,
                    success_rate=p,
                    confidence_interval=[
                        max(0, center - spread),
                        min(1, center + spread),
                    ],
                    task=task,
                    collisions=sum(o["unwanted_collisions"] for o in outcomes),
                    failures={
                        key: sum(o["termination"] == key for o in outcomes)
                        for key in sorted(
                            {o["termination"] for o in outcomes if not o["success"]}
                        )
                    },
                    checkpoint_sha256=policy.sha256,
                    split="development; do not claim clinical or final held-out validation",
                    scenarios=plan["scenarios"],
                )
                if task == "lifting":
                    result.update(
                        mean_placement_error_mm=sum(
                            o["placement_error"] for o in outcomes
                        )
                        / n
                        * 1000,
                        clearances=sum(o["cleared"] for o in outcomes),
                        releases=sum(o["released"] for o in outcomes),
                        drops=sum(o["drops"] for o in outcomes),
                    )
                else:
                    result.update(
                        mean_gap_mm=sum(o["wound_gap_m"] for o in outcomes) / n * 1000,
                        catches=sum(o["caught"] for o in outcomes),
                    )
                dump(self.folder / "evaluation.json", result)
                result["report"] = self.upload(self.folder / "evaluation.json")
                self.check()
                self.post("complete", dict(result=result))
            elif kind == "train":
                from .rl import train

                self.update(0.01, "Loading baseline actor and verifying action parity")
                resume = None
                if data.get("checkpoint"):
                    resume = self.folder / "resume.zip"
                    resume.write_bytes(
                        self.client.request("/artifacts/" + data["checkpoint"])
                    )
                result = train(
                    validate_plan(self.experiment["plan"], task)["scenarios"],
                    data["reward"],
                    data["steps"],
                    data["seed"],
                    self.folder,
                    self.update,
                    self.check,
                    resume=resume,
                )
                result["checkpoint"] = self.upload(self.folder / "policy.zip")
                result["report"] = self.upload(self.folder / "training.json")
                self.check()
                self.post("complete", dict(result=result))
            else:
                raise ValueError("Unsupported worker job")
        except Cancelled:
            print("Job cancelled or lease lost", self.job["id"], flush=True)
        except Exception as error:
            traceback.print_exc()
            try:
                self.post("fail", dict(error=str(error)))
            except Exception:
                pass
        finally:
            self.stop.set()
            thread.join(timeout=5)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--url", default=os.environ.get("LAB_URL", "http://127.0.0.1:3210")
    )
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    token = os.environ.get("LAB_WORKER_TOKEN")
    if not token and (ROOT / ".dev.vars").exists():
        for line in (ROOT / ".dev.vars").read_text().splitlines():
            if line.startswith("LAB_WORKER_TOKEN="):
                token = line.split("=", 1)[1].strip().strip('"')
    if not token:
        raise SystemExit("Configure LAB_WORKER_TOKEN in environment or .dev.vars")
    client = Client(args.url, token)
    worker_id = str(uuid.uuid4())
    capabilities = dict(
        id=worker_id,
        astra=bool(shutil.which("codex")),
        rl=importlib.util.find_spec("stable_baselines3") is not None,
        simulator="MuJoCo",
        model=os.environ.get("LAB_ASTRA_MODEL", "gpt-6-astra"),
    )
    print("Soren simulation worker ready:", args.url, flush=True)
    while True:
        try:
            claimed = client.request(
                "/worker/claim", dict(id=worker_id, capabilities=capabilities)
            )
            if claimed["job"]:
                print(
                    "Executing",
                    claimed["job"]["kind"],
                    claimed["job"]["id"],
                    flush=True,
                )
                Execution(client, claimed, worker_id).run()
                if args.once:
                    return
            elif args.once:
                return
            else:
                time.sleep(2)
        except KeyboardInterrupt:
            return
        except Exception as error:
            print("Worker connection retry:", error, flush=True)
            if args.once:
                raise
            time.sleep(5)


if __name__ == "__main__":
    main()
