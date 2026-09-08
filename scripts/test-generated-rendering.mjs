import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { recordedRobot } from '../app/robot-motion.ts';

globalThis.ProgressEvent ??= class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
const base = process.env.LAB_URL || 'http://127.0.0.1:3210';
async function get(path) {
  const response = await fetch(base + '/api/lab' + path);
  assert.ok(response.ok, `${path}: ${response.status}`);
  return response.json();
}
const experiments = await get('/experiments');
const file = await readFile('public/models/robot/panda.glb');
let recordings = 0;
for (const task of ['stitch', 'lifting']) {
  const experiment = experiments.find(e => (e.task || 'stitch') === task && e.plan?.scenarios.every(s => s.motion));
  assert.ok(experiment, `An upgraded ${task} suite must exist`);
  for (const scenario of experiment.plan.scenarios) {
    const motion = await get('/artifacts/' + scenario.motion);
    assert.equal(motion.frames.length, 1);
    assert.equal(motion.duration_s, 0);
    assert.ok(motion.presentation_assets.robot_motion, 'Every generated initial scene has a fitted robot');
    if (task === 'stitch') assert.ok(Math.abs(motion.frames[0].gap_m * 1000 - scenario.gap_mm) < 1e-5);
  }
  let run;
  for (const experiment of experiments.filter(e => (e.task || 'stitch') === task)) {
    const detail = await get('/experiments/' + experiment.id);
    run = detail.runs.find(r => r.motion && r.episode === 0);
    if (run) break;
  }
  assert.ok(run, `An upgraded ${task} recording must exist`);
  const motion = await get('/artifacts/' + run.motion);
  const telemetry = await get('/artifacts/' + run.telemetry);
  const fit = motion.presentation_assets.robot_motion;
  assert.ok(fit, `${task} recording must have fitted robot joints`);
  assert.equal(fit.frames.length, motion.frames.length);
  assert.equal(motion.frames.length, telemetry.frames.length);
  assert.equal(motion.result.success, run.info.success);
  const gltf = await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '');
  const apply = recordedRobot(gltf.scene, fit, motion.sample_hz);
  const hand = gltf.scene.getObjectByName('hand');
  assert.ok(hand);
  const palm = motion.geometry.findIndex(g => g.name === 'palm');
  let maximum = 0;
  for (const frame of [...motion.frames, ...motion.frames.toReversed()]) {
    apply(frame.time_s);
    gltf.scene.updateMatrixWorld(true);
    const target = task === 'stitch'
      ? new T.Vector3().fromArray(frame.center).add(new T.Vector3(0, -.1, .16))
      : new T.Vector3().fromArray(frame.poses[palm].position_m).add(new T.Vector3(0, 0, .0384));
    maximum = Math.max(maximum, hand.getWorldPosition(new T.Vector3()).distanceTo(target));
  }
  assert.ok(maximum < .001, `Robot must follow this recording, max error: ${maximum}`);
  apply(motion.duration_s / 2 + .0125);
  gltf.scene.updateMatrixWorld(true);
  const interpolated = hand.getWorldPosition(new T.Vector3()).clone();
  apply(0); apply(motion.duration_s); apply(motion.duration_s / 2 + .0125);
  gltf.scene.updateMatrixWorld(true);
  assert.ok(hand.getWorldPosition(new T.Vector3()).distanceTo(interpolated) < 1e-12, 'Seeking is absolute and repeatable');
  recordings++;
  console.log(`${task}: 16 previews, ${motion.frames.length} recorded frames, forward/reverse seek; max robot error ${(maximum * 1000).toFixed(6)} mm`);
}
assert.equal(recordings, 2);
