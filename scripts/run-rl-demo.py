"""Reproduce a demo through the lab's normal review, worker, and artifact APIs.

Requires a running `npm run lab`. Reuse --output to resume waiting on the
same experiment; a new output directory creates a separate experiment.
"""

import argparse
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("recipe", type=Path)
    parser.add_argument("--url", default="http://127.0.0.1:3210")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    recipe = json.loads(args.recipe.read_text())
    output = args.output or Path(".lab/demos") / (
        args.recipe.stem + "-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    )
    output.mkdir(parents=True, exist_ok=True)

    def save(name, value):
        (output / name).write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")

    def api(path, body=None):
        request = urllib.request.Request(
            args.url.rstrip("/") + "/api/lab" + path,
            data=None if body is None else json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"HTTP {error.code}: {error.read().decode()}") from error

    state_path = output / "state.json"
    if state_path.exists():
        state = json.loads(state_path.read_text())
        if state["recipe"] != recipe or state["url"] != args.url:
            raise ValueError("Existing output belongs to a different recipe or server.")
    else:
        review = api("/plans", {"specification": recipe["specification"]})
        save("review.json", review)
        created = api("/experiments", {
            "specification": review["specification"],
            "review_fingerprint": review["fingerprint"],
        })
        state = {
            "recipe": recipe, "url": args.url,
            "experiment_id": created["experiment"]["id"],
            "jobs": {"generate": created["job_id"]},
        }
        save("state.json", state)
    experiment_id = state["experiment_id"]
    endpoint = "/experiments/" + experiment_id
    compare_url = args.url.rstrip("/") + f"/?experiment={experiment_id}&view=compare"
    print("Experiment:", compare_url, flush=True)

    def wait(job_id):
        deadline = time.monotonic() + 7200
        previous = None
        while time.monotonic() < deadline:
            detail = api(endpoint)
            job = next(j for j in detail["jobs"] if j["id"] == job_id)
            progress = (job["status"], int(job.get("progress", 0) * 10))
            if progress != previous:
                print(job["kind"], job["status"], job.get("message", ""), flush=True)
                previous = progress
            if job["status"] == "completed":
                save("detail.json", detail)
                return detail
            if job["status"] in ("failed", "cancelled"):
                save("detail.json", detail)
                raise RuntimeError(f"{job['kind']} {job['status']}: {job.get('error')}")
            time.sleep(3)
        raise TimeoutError("Job still pending; rerun with the same --output to resume.")

    wait(state["jobs"]["generate"])
    for kind in ("baseline", "train", "candidate"):
        if kind not in state["jobs"]:
            body = {"kind": kind}
            if kind == "train":
                body.update(recipe["training"])
            state["jobs"][kind] = api(endpoint + "/jobs", body)["job_id"]
            save("state.json", state)
        detail = wait(state["jobs"][kind])

    jobs = {kind: next(j for j in detail["jobs"] if j["id"] == job_id)
            for kind, job_id in state["jobs"].items()}
    runs = {
        kind: {(r["scenario_id"], r["seed"]): r for r in detail["runs"]
               if r["job_id"] == state["jobs"][kind]}
        for kind in ("baseline", "candidate")
    }
    baseline, candidate = runs["baseline"], runs["candidate"]
    if not baseline or baseline.keys() != candidate.keys():
        raise ValueError("Evaluation episodes are not fully paired.")
    training = jobs["train"]["result"]
    if (training["parent_sha256"] != jobs["baseline"]["result"]["checkpoint_sha256"]
            or training["checkpoint_sha256"] != jobs["candidate"]["result"]["checkpoint_sha256"]):
        raise ValueError("Checkpoint provenance does not match the evaluated policies.")
    summary = {
        "compare_url": compare_url,
        "episodes": len(baseline),
        "baseline_successes": sum(r["info"]["success"] for r in baseline.values()),
        "candidate_successes": sum(r["info"]["success"] for r in candidate.values()),
        "paired_improvements": sum(not baseline[k]["info"]["success"] and candidate[k]["info"]["success"] for k in baseline),
        "paired_regressions": sum(baseline[k]["info"]["success"] and not candidate[k]["info"]["success"] for k in baseline),
        "training_steps": training["steps"],
        "training_seed": training["seed"],
        "actor_parameter_delta_l2": training["actor_parameter_delta_l2"],
        "action_parity_verified": training["action_parity_verified"],
        "baseline_sha256": training["parent_sha256"],
        "candidate_sha256": training["checkpoint_sha256"],
        "evidence_scope": "Selected development simulation study; not held-out validation.",
    }
    for kind in ("baseline", "train", "candidate"):
        save(kind + "-report.json", api("/artifacts/" + jobs[kind]["result"]["report"]))
    save("summary.json", summary)
    print(json.dumps(summary, indent=2), flush=True)
    print("Evidence saved to", output, flush=True)


if __name__ == "__main__":
    main()
