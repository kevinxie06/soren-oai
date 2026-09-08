import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Test the exported artifact with the same loader/mixer as the browser.
globalThis.ProgressEvent ??= class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
const old = process.argv.includes('--old');
const source = await readFile(old ? 'public/motion/heart-old.json' : 'public/motion/heart.json');
const motion = JSON.parse(source);
const report = JSON.parse(await readFile(old ? 'public/models/robot/panda-old.fit.json' : 'public/models/robot/fit-report.json', 'utf8'));
assert.equal(report.source_sha256, createHash('sha256').update(source).digest('hex'), 'Robot animation must match the current recording');
const file = await readFile(old ? 'public/models/robot/panda-old.glb' : 'public/models/robot/panda.glb');
const gltf = await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '');
const mixer = new THREE.AnimationMixer(gltf.scene);
const action = mixer.clipAction(gltf.animations[0]);
action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
const hand = gltf.scene.getObjectByName('hand');
const left = gltf.scene.getObjectByName('left_finger');
const right = gltf.scene.getObjectByName('right_finger');
assert.ok(hand && left && right);
const palmIndex = motion.geometry.findIndex(g => g.name === 'palm');
let maximumError = 0;
for (const frame of [...motion.frames, ...motion.frames.toReversed()]) {
  action.paused = false; action.enabled = true; mixer.setTime(frame.time_s);
  gltf.scene.updateMatrixWorld(true);
  const target = new THREE.Vector3().fromArray(frame.poses[palmIndex].position_m).add(new THREE.Vector3(0, 0, .0384));
  maximumError = Math.max(maximumError, hand.getWorldPosition(new THREE.Vector3()).distanceTo(target));
  const down = new THREE.Vector3(0, 0, 1).applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion()));
  assert.ok(down.distanceTo(new THREE.Vector3(0, 0, -1)) < .001, 'Hand orientation must remain downward');
}
assert.ok(maximumError < .00001, `Exported hand path deviates ${maximumError} metres`);
const bounds = new THREE.Box3().setFromObject(gltf.scene);
assert.ok(bounds.getSize(new THREE.Vector3()).length() < 2, 'Mesh transforms must remain at robot scale');
assert.ok(report.joint_limits_satisfied);
console.log(`Panda artifact passed: ${motion.frames.length} frames forward/backward, endpoint restart, orientation, scale, motion hash; maximum hand error ${(maximumError * 1000).toFixed(4)} mm.`);
