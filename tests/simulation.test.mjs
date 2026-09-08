import assert from "node:assert/strict";
import test from "node:test";
import { parseState } from "../lib/simulation.mjs";
const valid = {
  ready: true,
  running: false,
  demo: false,
  scene: "Test workcell",
  camera: "overview",
  sim_time: 0,
  updated_at: 1,
  joints: [0.1],
  joint_names: ["panda_joint1"],
  capabilities: ["play"],
};

test("accepts the simulator state contract", () => {
  assert.deepEqual(parseState(valid), valid);
});
test("rejects corrupted telemetry before it can reach the UI", () => {
  for (const change of [
    { joints: [NaN] },
    { joints: ["1"] },
    { joints: [0, 1] },
    { sim_time: Infinity },
    { ready: "true" },
    { capabilities: null },
    { updated_at: "yesterday" },
  ]) {
    assert.throws(() => parseState({ ...valid, ...change }));
  }
});
