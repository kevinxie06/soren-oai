import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStudy,
  defaultSpecification,
  matchesReviewedPlan,
} from "../lib/experiment-spec.ts";
import { scenarioInsights } from "../lib/scenario-insights.ts";
import { createScenarioGuides } from "../app/scenario-guides.ts";

test("reviewed suites give all 16 cases concrete titles, coverage intent, and stable provenance", () => {
  for (const task of ["stitch", "lifting"]) {
    const { plan } = buildStudy(defaultSpecification(task));
    assert.equal(new Set(plan.scenarios.map((s) => s.name)).size, 16);
    for (const scene of plan.scenarios) {
      assert.doesNotMatch(scene.name, /Configuration/);
      assert.match(scene.name, /\d/);
      assert.match(scene.rationale, /Tests/);
      assert.match(scene.rationale, /Compare/);
      const info = scenarioInsights(scene, plan.scenarios);
      for (const p of info.primary)
        assert.ok(scene.name.includes(String(p.value)));
    }
    assert.ok(matchesReviewedPlan(structuredClone(plan), plan));
    const changed = structuredClone(plan);
    changed.scenarios[0].rationale = "Different justification";
    assert.equal(matchesReviewedPlan(changed, plan), false);
  }
});

test("boundary and interior explanations compare against reviewed midpoint and retain fixed parameters", () => {
  const { plan } = buildStudy(defaultSpecification());
  const first = scenarioInsights(plan.scenarios[0], plan.scenarios);
  assert.equal(first.role, "Combined boundary case");
  assert.equal(first.parameters.find((p) => p.key === "gap_mm").delta, -2);
  assert.equal(first.parameters.find((p) => p.key === "stiffness").delta, -10);
  assert.equal(
    first.parameters.find((p) => p.key === "radius_mm").location,
    "Fixed",
  );
  assert.equal(
    scenarioInsights(plan.scenarios[5], plan.scenarios).role,
    "Interior coverage",
  );
  assert.match(first.observations.join(" "), /not visible/);
});

test("single varied parameter drives titles and purpose, including subtle offset-only studies", () => {
  const spec = defaultSpecification();
  for (const key of Object.keys(spec.ranges)) {
    const [lo, hi] = spec.ranges[key];
    spec.ranges[key] = [(lo + hi) / 2, (lo + hi) / 2];
  }
  spec.ranges.offset_z_mm = [4.4, 4.6];
  const { plan } = buildStudy(spec);
  assert.equal(new Set(plan.scenarios.map((s) => s.name)).size, 16);
  for (const scene of plan.scenarios) {
    assert.match(scene.name, /Start Z/);
    assert.match(scene.rationale, /starting height/);
    assert.doesNotMatch(scene.rationale, /multiple parameters vary/);
  }
});

test("legacy scenarios derive comparisons without modifying saved model intent", () => {
  const { plan } = buildStudy(defaultSpecification("lifting"));
  plan.scenarios.forEach((s) => {
    delete s.training_bounds;
    s.rationale = "Original planner intent";
  });
  const snapshot = JSON.stringify(plan);
  const info = scenarioInsights(plan.scenarios[0], plan.scenarios);
  assert.equal(info.parameters.find((p) => p.key === "tray_y_mm").midpoint, 0);
  assert.equal(info.varying.length, 5);
  assert.equal(JSON.stringify(plan), snapshot);
});

test("stitch rulers use recorded meters and midpoint guide uses reviewed millimeters", () => {
  const { plan } = buildStudy(defaultSpecification());
  const scenario = plan.scenarios[0];
  const midpoint = Object.fromEntries(
    scenarioInsights(scenario).parameters.map((p) => [p.key, p.midpoint]),
  );
  const motion = {
    schema_version: "soren.stitch.v1",
    scene: { center: [0, 0, 0.1], radius: 0.014 },
    frames: [{ gap_m: 0.006, center: [0, 0, 0.12] }],
  };
  const group = createScenarioGuides(motion, { scenario, midpoint });
  const actual = group.getObjectByName("recorded_initial_gap").geometry
    .attributes.position;
  const reference =
    group.getObjectByName("midpoint_gap").geometry.attributes.position;
  assert.ok(Math.abs(actual.getX(1) - actual.getX(0) - 0.006) < 1e-8);
  assert.ok(Math.abs(reference.getX(1) - reference.getX(0) - 0.008) < 1e-8);
  assert.equal(
    group.getObjectByName("midpoint_gap").material.type,
    "LineDashedMaterial",
  );
  assert.equal(motion.frames[0].gap_m, 0.006);
});

test("lifting reference outlines preserve pose and apply parameter delta in meters", () => {
  const { plan } = buildStudy(defaultSpecification("lifting"));
  const scenario = plan.scenarios[0];
  const midpoint = Object.fromEntries(
    scenarioInsights(scenario).parameters.map((p) => [p.key, p.midpoint]),
  );
  const motion = {
    schema_version: "soren.motion.v1",
    geometry: [{ name: "tray_floor", half_size_m: [0.05, 0.04, 0.003] }],
    frames: [
      {
        poses: [
          {
            position_m: [
              scenario.tray_x_mm / 1000,
              scenario.tray_y_mm / 1000,
              0.01,
            ],
            quaternion_wxyz: [1, 0, 0, 0],
          },
        ],
      },
    ],
  };
  const group = createScenarioGuides(motion, { scenario, midpoint });
  const ref = group.getObjectByName("midpoint_tray_floor_bounds").geometry
    .attributes.position;
  assert.ok(Math.abs(ref.getX(0) - (midpoint.tray_x_mm / 1000 - 0.05)) < 1e-7);
  assert.ok(Math.abs(ref.getY(0) - (midpoint.tray_y_mm / 1000 - 0.04)) < 1e-7);
});
