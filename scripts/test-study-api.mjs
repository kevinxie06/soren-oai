import assert from "node:assert/strict";
import {
  defaultSpecification,
  matchesReviewedPlan,
} from "../lib/experiment-spec.ts";
const base = process.env.LAB_URL || "http://127.0.0.1:3210";
async function post(path, body) {
  const response = await fetch(base + "/api/lab" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
const specification = defaultSpecification("stitch");
specification.question =
  "Verify reviewed coverage across 7–8 mm gaps while keeping spring stiffness fixed.";
specification.ranges.gap_mm = [7, 8];
specification.ranges.stiffness = [70, 70];
specification.episodes = 1;
specification.seed = 23;
specification.steps = 1024;
const before = await fetch(base + "/api/lab/experiments").then((r) => r.json());
const review = await post("/plans", { specification });
assert.equal(review.status, 200);
assert.equal(review.data.plan.scenarios.length, 16);
assert.equal(
  (await fetch(base + "/api/lab/experiments").then((r) => r.json())).length,
  before.length,
  "Planning must not create an experiment or start execution",
);
assert.equal(
  (
    await post("/plans", {
      specification: { ...specification, policy_id: "incompatible" },
    })
  ).status,
  400,
);
assert.equal((await post("/experiments", { specification })).status, 409);
assert.equal(
  (
    await post("/experiments", {
      specification: { ...specification, episodes: 5 },
      review_fingerprint: review.data.fingerprint,
    })
  ).status,
  409,
);
const launched = await post("/experiments", {
  specification,
  review_fingerprint: review.data.fingerprint,
});
assert.equal(launched.status, 201);
const id = launched.data.experiment.id;
console.log(`Reviewed study created: ${id}`);
async function waitFor(kind) {
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    const detail = await fetch(base + "/api/lab/experiments/" + id).then((r) =>
      r.json(),
    );
    const job = detail.jobs.find((j) => j.kind === kind);
    assert.notEqual(job?.status, "failed", job?.error);
    if (job?.status === "completed") return detail;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`Timed out waiting for ${kind}`);
}
const generated = await waitFor("generate");
assert.deepEqual(generated.experiment.specification, specification);
assert.equal(
  matchesReviewedPlan(generated.experiment.plan, review.data.plan),
  true,
);
assert.ok(
  generated.experiment.plan.scenarios.every(
    (s) => s.stiffness === 70 && s.gap_mm >= 7 && s.gap_mm <= 8,
  ),
);
console.log(
  "PASS: review creates no jobs, stale plans are rejected, and the worker executes the exact reviewed envelope.",
);
const baseline = await post(`/experiments/${id}/jobs`, { kind: "baseline" });
assert.equal(baseline.status, 201);
const evaluated = await waitFor("baseline");
const job = evaluated.jobs.find((j) => j.kind === "baseline");
assert.equal(job.data.episodes, 1);
assert.equal(job.data.seed, 23);
assert.equal(job.data.steps, 1024);
assert.equal(evaluated.runs.filter((r) => r.job_id === job.id).length, 16);
console.log(
  "PASS: saved protocol defaults drive a real 16-episode baseline evaluation.",
);
