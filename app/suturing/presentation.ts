import type { StitchMotion } from './types';

/** Settle only the successful, submillimetre terminal hold for presentation.
 * Raw simulation data stays untouched. Precompute so seeking is deterministic.
 */
export function presentationMotion(motion: StitchMotion): StitchMotion {
  const frames = motion.frames;
  const last = frames.at(-1);
  if (!motion.result.success || !last?.needle_clear || last.gap_m >= .001) return motion;
  let start = frames.length - 1;
  while (start > 0 && frames[start - 1].needle_clear && frames[start - 1].gap_m < .001) start--;
  const first = frames[start];
  const duration = last.time_s - first.time_s;
  if (duration <= 0 || first.gap_m <= last.gap_m) return motion;
  return {...motion, frames: frames.map((frame, i) => {
    if (i < start) return frame;
    const t = (frame.time_s - first.time_s) / duration;
    const eased = t * t * (3 - 2 * t);
    const gap = first.gap_m + (last.gap_m - first.gap_m) * eased;
    // Keep the thread endpoints attached to the presented wound edges.
    const anchors = frame.anchors.map(anchor => {
      const side = Math.sign(anchor[0] - motion.scene.center[0]);
      return [anchor[0] + side * (gap - frame.gap_m) / 2, anchor[1], anchor[2]] as [number, number, number];
    });
    return {...frame, gap_m: gap, anchors};
  })};
}

export function gapAtTime(motion: StitchMotion, time: number): number {
  const index = Math.max(0, Math.min(motion.frames.length - 1, time * motion.sample_hz));
  const a = Math.floor(index), b = Math.min(a + 1, motion.frames.length - 1);
  return motion.frames[a].gap_m + (motion.frames[b].gap_m - motion.frames[a].gap_m) * (index - a);
}
