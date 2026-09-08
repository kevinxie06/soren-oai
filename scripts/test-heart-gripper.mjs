import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { recordedHeartGripper, recordedRobot } from '../app/robot-motion.ts';

globalThis.ProgressEvent ??= class {};
for (const version of ['', '-old']) {
  const motion = JSON.parse(await readFile(`public/motion/heart${version}.json`));
  const bytes = await readFile(`public/models/robot/panda${version}.glb`);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  // Reproduce animations cached before the exporter fix: both fingers move together.
  const clip = gltf.animations[0];
  const leftTrack = clip.tracks.find(track => track.name === 'left_finger.position');
  const rightTrack = clip.tracks.find(track => track.name === 'right_finger.position');
  rightTrack.values.set(leftTrack.values);
  const mixer = new T.AnimationMixer(gltf.scene);
  const action = mixer.clipAction(clip);
  action.setLoop(T.LoopOnce, 1); action.clampWhenFinished = true; action.play();
  const applyClip = time => {
    action.paused = false; action.enabled = true; mixer.setTime(time);
  };
  const fingers = ['left_finger', 'right_finger'].map(name => gltf.scene.getObjectByName(name));
  const hand = gltf.scene.getObjectByName('hand');
  const fit = {
    frames: motion.frames.map(frame => {
      applyClip(frame.time_s);
      return { nodes: fingers.map(node => ({
        name: node.name, position: node.position.toArray(), quaternion_xyzw: node.quaternion.toArray(),
      })) };
    }),
  };
  const applyGripper = recordedHeartGripper(gltf.scene, motion);
  assert.ok(applyGripper);
  const ids = ['finger_l', 'finger_r'].map(name => motion.geometry.findIndex(shape => shape.name === name));
  const times = motion.frames.flatMap(frame => [frame.time_s, Math.min(frame.time_s + .025, motion.duration_s)]);
  for (const [name, applyRobot] of [['cached clip', applyClip], ['saved fit', recordedRobot(gltf.scene, fit, motion.sample_hz)]]) {
    for (const time of [...times, ...times.toReversed(), 0]) {
      applyRobot(time);
      gltf.scene.updateMatrixWorld(true);
      const handBefore = hand.matrixWorld.clone();
      applyGripper(time);
      gltf.scene.updateMatrixWorld(true);
      const index = T.MathUtils.clamp(time * motion.sample_hz, 0, motion.frames.length - 1);
      const a = Math.floor(index), b = Math.min(a + 1, motion.frames.length - 1);
      const measured = ids.map(i => new T.Vector3().fromArray(motion.frames[a].poses[i].position_m)
        .lerp(new T.Vector3().fromArray(motion.frames[b].poses[i].position_m), index - a));
      const expected = 2 * T.MathUtils.clamp(measured[0].distanceTo(measured[1]) / 2 - .004, 0, .04);
      const actual = fingers[0].getWorldPosition(new T.Vector3()).distanceTo(fingers[1].getWorldPosition(new T.Vector3()));
      assert.ok(Math.abs(actual - expected) < 1e-7, `${version || 'current'} ${name}: surgical opening must match measured spacing at ${time}s`);
      assert.ok(fingers[0].position.y > 0 && fingers[1].position.y < 0, 'Fingers must straddle the hand');
      assert.deepEqual(hand.matrixWorld.elements, handBefore.elements, 'Claw correction must preserve the arm pose');
    }
  }
  console.log(`${version || 'current'}: surgical claw follows geometry with cached clips and saved fits, including interpolation, reverse seek and restart`);
}
