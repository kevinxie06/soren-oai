import type { RewardSpec, TaskKind } from "./types";

export const rewardTerms = (task: TaskKind) =>
  [
    {
      key: "completion",
      name: "Task completion",
      symbol: "Sₜ",
      min: 1,
      max: 100,
      step: 1,
      description: "One payment when the fixed success checker passes.",
    },
    {
      key: "milestones",
      name:
        task === "lifting"
          ? "Grasp and clearance milestones"
          : "Needle-transfer milestones",
      symbol: "Mₜ",
      min: 0,
      max: 10,
      step: 0.1,
      description:
        task === "lifting"
          ? "Count newly achieved grasp, rim clearance, and release in the tray. Each pays once."
          : "Count newly achieved entry, exit, receiving catch, and clearance. Each pays once.",
    },
    {
      key: task === "lifting" ? "placement" : "closure",
      name: task === "lifting" ? "Placement progress" : "Closure progress",
      symbol: "ΔΦₜ",
      min: 0,
      max: 10,
      step: 0.1,
      description:
        task === "lifting"
          ? "Net normalized approach to the tray, gated on rim clearance. Moving away subtracts reward."
          : "Net normalized gap reduction, gated on catch, clearance, and donor release. Reopening subtracts reward.",
    },
    {
      key: "smoothness",
      name: "Action smoothness",
      symbol: "Dₜ",
      min: 0,
      max: 1,
      step: 0.01,
      description:
        "Subtract the mean squared change in consecutive action commands.",
    },
    {
      key: "failure",
      name: "Failure penalty",
      symbol: "Fₜ",
      min: 0,
      max: 100,
      step: 1,
      description:
        "One penalty for an episode ending without success, including timeout.",
    },
  ] as const;

export function validWeights(weights: RewardSpec, task: TaskKind) {
  const terms = rewardTerms(task);
  if (Object.keys(weights).length !== terms.length) return false;
  return terms.every(({ key, min, max }) => {
    const value = weights[key];
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= min &&
      value <= max
    );
  });
}
export function sameWeights(a: RewardSpec, b?: RewardSpec) {
  return (
    !!b &&
    Object.keys(a).every(
      (key) => a[key as keyof RewardSpec] === b[key as keyof RewardSpec],
    ) &&
    Object.keys(a).length === Object.keys(b).length
  );
}

export interface EpisodeSample {
  step: number;
  return_value: number;
  length: number;
  success: boolean;
  reward_terms?: Record<string, number>;
}
export interface OptimizerSample {
  step: number;
  approx_kl?: number;
  clip_fraction?: number;
  value_loss?: number;
  explained_variance?: number;
}
export function episodeHistory(
  result?: Record<string, unknown> | null,
): EpisodeSample[] {
  if (!Array.isArray(result?.history)) return [];
  return result.history.filter(
    (row): row is EpisodeSample =>
      row &&
      Number.isFinite(row.step) &&
      Number.isFinite(row.return_value) &&
      Number.isFinite(row.length) &&
      typeof row.success === "boolean",
  );
}
export function optimizerHistory(
  result?: Record<string, unknown> | null,
): OptimizerSample[] {
  if (!Array.isArray(result?.updates)) return [];
  return result.updates.filter(
    (row): row is OptimizerSample => row && Number.isFinite(row.step),
  );
}
export function numberLabel(value: unknown, digits = 3) {
  if (typeof value !== "number" || !Number.isFinite(value))
    return "Not recorded";
  return value !== 0 && Math.abs(value) < 0.001
    ? value.toExponential(2)
    : value.toLocaleString(undefined, { maximumFractionDigits: digits });
}
