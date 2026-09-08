import * as T from "three";
import type { Motion } from "./showcase/types";

/** Drive the surgical Panda claw from measured geometry, including legacy saved fits. */
export function recordedHeartGripper(root: T.Object3D, motion: Motion) {
  const left = root.getObjectByName("left_finger");
  const right = root.getObjectByName("right_finger");
  const leftIndex = motion.geometry.findIndex((shape) => shape.name === "finger_l");
  const rightIndex = motion.geometry.findIndex((shape) => shape.name === "finger_r");
  if (!left || !right || leftIndex < 0 || rightIndex < 0) return null;

  const leftPosition = new T.Vector3(), rightPosition = new T.Vector3();
  const nextPosition = new T.Vector3();
  return (time: number) => {
    const index = T.MathUtils.clamp(time * motion.sample_hz, 0, motion.frames.length - 1);
    const a = Math.floor(index), b = Math.min(a + 1, motion.frames.length - 1);
    const alpha = index - a;
    leftPosition.fromArray(motion.frames[a].poses[leftIndex].position_m)
      .lerp(nextPosition.fromArray(motion.frames[b].poses[leftIndex].position_m), alpha);
    rightPosition.fromArray(motion.frames[a].poses[rightIndex].position_m)
      .lerp(nextPosition.fromArray(motion.frames[b].poses[rightIndex].position_m), alpha);
    // Match the presentation export's 4 mm pad offset and 40 mm joint travel.
    const opening = T.MathUtils.clamp(leftPosition.distanceTo(rightPosition) / 2 - .004, 0, .04);
    // These translations are in the hand's frame; the right mount faces the opposite way.
    left.position.y = opening;
    right.position.y = -opening;
  };
}

export type RobotMotion = {
  seed: number;
  checkpoint_sha256: string;
  max_position_error_m: number;
  frames: {
    nodes: {
      name: string;
      position: [number, number, number];
      quaternion_xyzw: [number, number, number, number];
    }[];
    hand_position: [number, number, number];
  }[];
};

/** Apply the recording's fitted joints; never start the GLB's bundled animation. */
export function recordedRobot(
  root: T.Object3D,
  motion: RobotMotion,
  sampleHz: number,
) {
  const nodes = new Map<string, T.Object3D>();
  root.traverse((node) => nodes.set(node.name, node));
  const nextPosition = new T.Vector3(),
    nextRotation = new T.Quaternion();
  return (time: number) => {
    const index = Math.max(
      0,
      Math.min(motion.frames.length - 1, time * sampleHz),
    );
    const a = Math.floor(index),
      b = Math.min(a + 1, motion.frames.length - 1),
      alpha = index - a;
    motion.frames[a].nodes.forEach((pose, i) => {
      const node = nodes.get(pose.name),
        next = motion.frames[b].nodes[i];
      if (!node || !next) return;
      node.position
        .fromArray(pose.position)
        .lerp(nextPosition.fromArray(next.position), alpha);
      node.quaternion
        .fromArray(pose.quaternion_xyzw)
        .slerp(nextRotation.fromArray(next.quaternion_xyzw), alpha);
    });
  };
}
