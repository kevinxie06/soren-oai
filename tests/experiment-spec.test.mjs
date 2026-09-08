import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStudy,
  coverageLabel,
  defaultSpecification,
  matchesReviewedPlan,
  reviewStudy,
  taskPackages,
  validateSpecification,
} from "../lib/experiment-spec.ts";

for (const task of ["stitch", "lifting"]) {
  test(`${task}: coverage is reproducible, distinct and inside the selected envelope`, () => {
    const spec = defaultSpecification(task);
    const { plan } = buildStudy(spec);
    assert.deepEqual(buildStudy(spec).plan, plan);
    assert.equal(plan.scenarios.length, 16);
    const keys = taskPackages[task].parameters.map((p) => p.key);
    assert.equal(
      new Set(plan.scenarios.map((s) => keys.map((k) => s[k]).join())).size,
      16,
    );
    for (const s of plan.scenarios)
      for (const key of keys) {
        assert.ok(
          s[key] >= spec.ranges[key][0] && s[key] <= spec.ranges[key][1],
        );
        assert.deepEqual(s.training_bounds, spec.ranges);
      }
    assert.equal(new Set(plan.scenarios.map((s) => s.seed)).size, 16);
  });
}
test("custom ranges change executable scenarios, while the question only documents intent", () => {
  const spec = defaultSpecification();
  spec.ranges.gap_mm = [7, 8];
  spec.ranges.stiffness = [70, 70];
  const { plan } = buildStudy(spec);
  assert.equal(coverageLabel(spec), "16 stratified parameter combinations");
  assert.equal(Math.min(...plan.scenarios.map((s) => s.gap_mm)), 7);
  assert.equal(Math.max(...plan.scenarios.map((s) => s.gap_mm)), 8);
  assert.ok(plan.scenarios.every((s) => s.stiffness === 70));
  assert.deepEqual(
    buildStudy({ ...spec, question: "Different documented intent" }).plan
      .scenarios,
    plan.scenarios,
  );
});
test("invalid units, ranges, unsupported evidence, policy, and budgets are rejected", () => {
  const spec = defaultSpecification();
  for (const patch of [
    { task: "arbitrary surgery" },
    { package_id: "unversioned" },
    { policy_id: "other/checkpoint" },
    { evidence_id: "clinically validated" },
    { purpose: "deployment" },
    { question: "short" },
    { episodes: 0 },
    { episodes: 21 },
    { episodes: 1.2 },
    { seed: -1 },
    { seed: 100000 },
    { steps: 12 },
    { ranges: { ...spec.ranges, stiffness: [85, 65] } },
    { ranges: { ...spec.ranges, gap_mm: [0.006, 0.01] } },
    { ranges: { ...spec.ranges, gap_mm: [NaN, 9] } },
    { ranges: { ...spec.ranges, friction: [0, 1] } },
    {
      ranges: Object.fromEntries(
        Object.entries(spec.ranges).map(([k, r]) => [k, [r[0], r[0]]]),
      ),
    },
    { force_limit: 1 },
  ])
    assert.throws(() => validateSpecification({ ...spec, ...patch }));
});
test("review fingerprints detect question, budget, seed, policy purpose and envelope changes", async () => {
  const spec = defaultSpecification();
  const original = await reviewStudy(spec);
  assert.equal((await reviewStudy(spec)).fingerprint, original.fingerprint);
  for (const patch of [
    { question: "A different research question" },
    { episodes: 5 },
    { seed: 8 },
    { purpose: "improve" },
    { ranges: { ...spec.ranges, gap_mm: [7, 9] } },
  ]) {
    assert.notEqual(
      (await reviewStudy({ ...spec, ...patch })).fingerprint,
      original.fingerprint,
    );
  }
});
test("execution can add rendering assets but cannot change a reviewed plan", () => {
  const { plan } = buildStudy(defaultSpecification());
  const rendered = structuredClone(plan);
  rendered.scenarios.forEach((s) => {
    s.thumbnail = "native.jpg";
    s.motion = "motion.json";
  });
  assert.equal(matchesReviewedPlan(rendered, plan), true);
  for (const change of [
    (p) => {
      p.scenarios[0].gap_mm += 0.1;
    },
    (p) => {
      delete p.scenarios[0].training_bounds;
    },
    (p) => {
      p.reward.completion = 90;
    },
    (p) => {
      p.hypothesis = "A substituted research question";
    },
    (p) => {
      p.scenarios.pop();
    },
  ]) {
    const changed = structuredClone(rendered);
    change(changed);
    assert.equal(matchesReviewedPlan(changed, plan), false);
  }
});
