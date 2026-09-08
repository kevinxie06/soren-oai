import type { ExperimentSpecification } from "./experiment-spec";
export type JobKind =
  "generate" | "baseline" | "train" | "candidate" | "refine";
export type JobStatus =
  "queued" | "running" | "completed" | "failed" | "cancelled";
export type TaskKind = "stitch" | "lifting";
interface ScenarioBase {
  training_bounds?: Record<string, [number, number]>;
  motion?: string;
  presentation_version?: number;
  thumbnail?: string;
  id: string;
  name: string;
  rationale: string;
  seed: number;
  task?: TaskKind;
}
export interface StitchScenario extends ScenarioBase {
  task?: "stitch";
  gap_mm: number;
  stiffness: number;
  radius_mm: number;
  offset_x_mm: number;
  offset_y_mm: number;
  offset_z_mm: number;
}
export interface LiftingScenario extends ScenarioBase {
  task: "lifting";
  object_x_mm: number;
  object_y_mm: number;
  object_yaw_deg: number;
  tray_x_mm: number;
  tray_y_mm: number;
}
export type Scenario = StitchScenario | LiftingScenario;
export interface RewardSpec {
  completion: number;
  milestones: number;
  closure?: number;
  placement?: number;
  smoothness: number;
  failure: number;
}
export interface Plan {
  task?: TaskKind;
  title: string;
  hypothesis: string;
  assumptions: string[];
  scenarios: Scenario[];
  reward: RewardSpec;
  provider: string;
  model: string;
  version: string;
}
export interface Experiment {
  specification?: ExperimentSpecification;
  reviewed_plan?: Plan;
  review_fingerprint?: string;
  task?: TaskKind;
  id: string;
  title: string;
  prompt: string;
  created_at: number;
  plan: Plan | null;
  parent_id?: string;
  source: "astra" | "template";
}
export interface Job {
  id: string;
  experiment_id: string;
  kind: JobKind;
  status: JobStatus;
  progress: number;
  message: string;
  error: string | null;
  created_at: number;
  data: {
    episodes?: number;
    steps?: number;
    seed?: number;
    reward?: RewardSpec;
    checkpoint?: string;
    baseline_job_id?: string;
    source?: string;
    feedback?: string;
  };
  result: Record<string, unknown> | null;
}
export interface Outcome {
  success: boolean;
  termination: string;
  steps: number;
  wound_gap_m?: number;
  initial_gap_m?: number;
  tension_n?: number;
  caught?: boolean;
  unwanted_collisions: number;
  entered?: boolean;
  exited?: boolean;
  needle_clear?: boolean;
  placement_error?: number;
  drops?: number;
  cleared?: boolean;
  released?: boolean;
}
export interface Run {
  trajectory?: string;
  motion?: string;
  presentation_version?: number;
  id: string;
  experiment_id: string;
  job_id: string;
  scenario_id: string;
  controller: "baseline" | "candidate";
  episode: number;
  seed: number;
  info: Outcome;
  video?: string;
  thumbnail?: string;
  telemetry?: string;
  manifest?: string;
  reward_total: number;
}
export interface ExperimentDetail {
  experiment: Experiment;
  jobs: Job[];
  runs: Run[];
}
export interface Telemetry {
  frames: {
    t: number;
    gap_mm?: number;
    object_height_mm?: number;
    placement_error_mm?: number;
    tension_n?: number;
    phase: string;
    reward: Record<string, number>;
  }[];
}
