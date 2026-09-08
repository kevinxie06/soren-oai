import test from "node:test";
import assert from "node:assert/strict";
import {
  episodeHistory,
  optimizerHistory,
  sameWeights,
  validWeights,
} from "../lib/research.ts";

const weights = {
  completion: 20,
  milestones: 2,
  closure: 3,
  smoothness: 0.01,
  failure: 10,
};

test("training validation rejects incomplete, non-finite, out-of-bounds, and cross-task objectives", () => {
  assert.equal(validWeights(weights, "stitch"), true);
  for (const completion of [NaN, Infinity, -1, 0, 101, undefined]) {
    assert.equal(validWeights({ ...weights, completion }, "stitch"), false);
  }
  assert.equal(validWeights({ ...weights, smoothness: 1.01 }, "stitch"), false);
  assert.equal(validWeights(weights, "lifting"), false);
  assert.equal(validWeights({ ...weights, placement: 3 }, "stitch"), false);
  const { closure, ...lifting } = weights;
  assert.equal(
    validWeights({ ...lifting, placement: closure }, "lifting"),
    true,
  );
});

test("reward provenance distinguishes a draft from the saved reward definition", () => {
  assert.equal(sameWeights(weights, { ...weights }), true);
  assert.equal(sameWeights({ ...weights, smoothness: 0.02 }, weights), false);
  assert.equal(sameWeights(weights, undefined), false);
  assert.equal(sameWeights(weights, { ...weights, placement: 3 }), false);
});

test("legacy and absent reports do not invent learning or optimizer evidence", () => {
  assert.deepEqual(episodeHistory(null), []);
  assert.deepEqual(optimizerHistory({ steps: 8192 }), []);
  const episode = { step: 100, return_value: -4, length: 100, success: false };
  assert.deepEqual(episodeHistory({ history: [episode] }), [episode]);
  assert.deepEqual(optimizerHistory({ history: [episode] }), []);
});

test("chart input preserves recorded transitions and rejects malformed episode samples", () => {
  const row = { step: 1280, return_value: 32.1, length: 112, success: true };
  const result = {
    history: [
      null,
      {},
      { ...row, return_value: NaN },
      { ...row, step: Infinity },
      { ...row, success: "true" },
      row,
    ],
  };
  assert.deepEqual(episodeHistory(result), [row]);
  const update = { step: 1536, approx_kl: 0, value_loss: 2.3 };
  assert.deepEqual(
    optimizerHistory({ updates: [null, {}, { step: NaN }, update] }),
    [update],
  );
});
