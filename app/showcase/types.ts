import type { RobotMotion } from "../robot-motion";
export type Pose = { position_m: number[]; quaternion_wxyz: number[] };
export type Shape = { name: string; shape: string; half_size_m: number[]; rgba: number[]; dynamic: boolean };
export type Motion = {
  presentation_assets?: { robot_glb?: string; recording_specific?: boolean; robot_motion?: RobotMotion | null };
  comparison_provenance?: { kind: string; display_name: string };
  schema_version: string; seed: number; duration_s: number; sample_hz: number; checkpoint_sha256: string;
  geometry: Shape[];
  frames: { time_s: number; poses: Pose[]; joint_positions: number[]; object_position_m: number[]; demonstration_phase?: string;
    state: { closed: boolean; attached: boolean; cleared: boolean; released: boolean } }[];
  presentation_context: { name: string; shape: string; position_m: number[]; half_size_m: number[]; color: string }[];
  result: { success: boolean; drops: number; unwanted_collisions: number; placement_error: number; termination?: string };
};
