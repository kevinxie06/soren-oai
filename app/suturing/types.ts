import type { RobotMotion } from "../robot-motion";
export type Vec3 = [number, number, number];
export type StitchFrame = {
  time_s: number; center: Vec3; theta: number; tip: Vec3; tail: Vec3;
  jaws: Vec3[]; closure: number[]; anchors: Vec3[]; gap_m: number; tension_n: number;
  phase: string; entered: boolean; exited: boolean; caught: boolean;
  donor_holding: boolean; receiver_holding: boolean; needle_clear: boolean;
  poses: {position_m: Vec3; quaternion_wxyz: [number,number,number,number]}[];
};
export type StitchMotion = {
  presentation_assets?: { robot_fit?: string; recording_specific?: boolean; robot_motion?: RobotMotion | null };
  comparison_provenance?: { kind: string; display_name: string };
  schema_version: string; sample_hz: number; duration_s: number;
  scene: { center: Vec3; radius: number; gap: number; seed: number };
  frames: StitchFrame[];
  geometry: {name:string;shape:string;half_size_m:number[];rgba:number[]}[];
  result: { success: boolean; wound_gap_m: number; checkpoint_sha256: string; termination?: string };
  evaluation: { successes: number; episodes: number } | null;
};
