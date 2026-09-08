import type { Plan, RewardSpec, Scenario, TaskKind } from "./types";
import { scenarioInsights } from "./scenario-insights.ts";

export type StudyPurpose = "evaluate" | "improve";
export type ParameterRange = [number, number];
export interface ExperimentSpecification {
  version: "soren-study-v1";
  task: TaskKind;
  package_id: string;
  policy_id: string;
  purpose: StudyPurpose;
  question: string;
  ranges: Record<string, ParameterRange>;
  environments: number;
  episodes: number;
  steps: number;
  seed: number;
  evidence_id: "exploratory-simulator-v1";
}
interface Parameter {
  key: string;
  label: string;
  unit: string;
  bounds: ParameterRange;
  initial: ParameterRange;
  step: number;
}
export interface TaskPackage {
  id: string;
  name: string;
  description: string;
  policy: string;
  robot: string;
  observations: number;
  actions: number;
  question: string;
  parameters: Parameter[];
  success: string;
  failures: string;
  metrics: string[];
  limitations: string[];
  reward: RewardSpec;
}
export const taskPackages: Record<TaskKind, TaskPackage> = {
  stitch: {
    id: "stitch-surrogate-v1",
    name: "Needle transfer & closure",
    description:
      "Rigid spring-mounted wound patches · assisted needle transfer",
    policy: "artifacts/stitch/policy.npz",
    robot: "Opposing simulated jaws",
    observations: 38,
    actions: 7,
    question:
      "How reliably does the starting policy transfer the needle and close the gap across wound widths and spring stiffnesses?",
    parameters: [
      {
        key: "gap_mm",
        label: "Wound gap",
        unit: "mm",
        bounds: [6, 10],
        initial: [6, 10],
        step: 0.1,
      },
      {
        key: "stiffness",
        label: "Spring stiffness",
        unit: "N/m",
        bounds: [65, 85],
        initial: [65, 85],
        step: 1,
      },
      {
        key: "radius_mm",
        label: "Needle radius",
        unit: "mm",
        bounds: [12, 16],
        initial: [14, 14],
        step: 0.1,
      },
      {
        key: "offset_x_mm",
        label: "Starting offset X",
        unit: "mm",
        bounds: [-3, 3],
        initial: [0, 0],
        step: 0.1,
      },
      {
        key: "offset_y_mm",
        label: "Starting offset Y",
        unit: "mm",
        bounds: [-3, 3],
        initial: [0, 0],
        step: 0.1,
      },
      {
        key: "offset_z_mm",
        label: "Starting offset Z",
        unit: "mm",
        bounds: [3, 6],
        initial: [4.5, 4.5],
        step: 0.1,
      },
    ],
    success:
      "Valid needle pass, receiving catch, donor release, full clearance, and gap below 0.7 mm for 0.75 seconds with low needle velocity.",
    failures:
      "Invalid transfer, lost needle, or timeout end the episode. Flagged contacts are reported separately.",
    metrics: [
      "Task completion",
      "Needle catches",
      "Final wound gap",
      "Thread tension",
      "Flagged contacts",
    ],
    limitations: [
      "No deformable tissue, puncture resistance, tearing, or knot retention.",
      "Spring stiffness is a surrogate parameter, not a calibrated tissue material model.",
      "Numerical state inputs; no vision policy or real-robot execution.",
    ],
    reward: {
      completion: 20,
      milestones: 2,
      closure: 3,
      smoothness: 0.01,
      failure: 10,
    },
  },
  lifting: {
    id: "lifting-surrogate-v1",
    name: "Object lifting & placement",
    description: "Rigid object and cavity · assisted grasp · fixed geometry",
    policy: "artifacts/policy_recovery.npz",
    robot: "Fixed-orientation XYZ gantry and gripper",
    observations: 32,
    actions: 4,
    question:
      "How reliably does the starting policy clear the cavity and place the object across object positions and tray distances?",
    parameters: [
      {
        key: "object_x_mm",
        label: "Object position X",
        unit: "mm",
        bounds: [-22, 22],
        initial: [-22, 22],
        step: 1,
      },
      {
        key: "object_y_mm",
        label: "Object position Y",
        unit: "mm",
        bounds: [-22, 22],
        initial: [-22, 22],
        step: 1,
      },
      {
        key: "object_yaw_deg",
        label: "Object orientation",
        unit: "°",
        bounds: [-8.5, 8.5],
        initial: [-8.5, 8.5],
        step: 0.1,
      },
      {
        key: "tray_x_mm",
        label: "Tray position X",
        unit: "mm",
        bounds: [250, 320],
        initial: [250, 320],
        step: 1,
      },
      {
        key: "tray_y_mm",
        label: "Tray position Y",
        unit: "mm",
        bounds: [-45, 45],
        initial: [-45, 45],
        step: 1,
      },
    ],
    success:
      "Clear the rim, release with an open gripper in the tray within 50 mm on each horizontal axis and 12 mm vertically, and settle below 0.04 m/s for 0.75 seconds.",
    failures:
      "Out-of-bounds failures and timeout end the episode. Drops and unwanted contacts are reported separately.",
    metrics: [
      "Task completion",
      "Rim clearance",
      "Placement error",
      "Drops",
      "Flagged contacts",
    ],
    limitations: [
      "Object shape, mass, friction, cavity, and tray dimensions are fixed.",
      "No deformable objects, articulated robot arms, or unassisted grasp physics.",
      "Numerical state inputs; no vision policy or real-robot execution.",
    ],
    reward: {
      completion: 20,
      milestones: 2,
      placement: 3,
      smoothness: 0.01,
      failure: 10,
    },
  },
};
export function defaultSpecification(
  task: TaskKind = "stitch",
): ExperimentSpecification {
  const pkg = taskPackages[task];
  return {
    version: "soren-study-v1",
    task,
    package_id: pkg.id,
    policy_id: pkg.policy,
    purpose: "evaluate",
    question: pkg.question,
    ranges: Object.fromEntries(
      pkg.parameters.map((p) => [p.key, [...p.initial] as ParameterRange]),
    ),
    environments: 16,
    episodes: 3,
    steps: 8192,
    seed: 7,
    evidence_id: "exploratory-simulator-v1",
  };
}
export class SpecificationError extends Error {}
export function validateSpecification(value: unknown): ExperimentSpecification {
  const fail = (message: string): never => {
    throw new SpecificationError(message);
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail("An experiment specification is required.");
  // Stored studies created before count configuration retain the original default.
  const s = { environments: 16, ...value } as ExperimentSpecification;
  if (s.task !== "stitch" && s.task !== "lifting")
    return fail("Choose a supported task package.");
  const pkg = taskPackages[s.task];
  if (
    Object.keys(s).sort().join() !==
    Object.keys(defaultSpecification(s.task)).sort().join()
  )
    return fail("The specification contains missing or unsupported fields.");
  if (s.version !== "soren-study-v1" || s.package_id !== pkg.id)
    return fail("Task package version is incompatible. Generate a new plan.");
  if (s.policy_id !== pkg.policy)
    return fail("The policy is incompatible with this task package.");
  if (s.evidence_id !== "exploratory-simulator-v1")
    return fail(
      "Only the exploratory simulator evidence package is available.",
    );
  if (s.purpose !== "evaluate" && s.purpose !== "improve")
    return fail("Choose evaluation or policy improvement.");
  if (
    typeof s.question !== "string" ||
    s.question.trim().length < 10 ||
    s.question.length > 4000
  )
    return fail("Use 10–4,000 characters for the research question.");
  if (!Number.isSafeInteger(s.environments) || s.environments < 1)
    return fail("Choose a positive whole number of environments.");
  if (!Number.isInteger(s.episodes) || s.episodes < 1 || s.episodes > 20)
    return fail("Choose 1–20 episodes per environment.");
  if (![1024, 8192, 32768, 131072].includes(s.steps))
    return fail("Choose a supported training budget.");
  if (!Number.isInteger(s.seed) || s.seed < 0 || s.seed > 99999)
    return fail("Study seed must be an integer from 0 to 99,999.");
  if (
    !s.ranges ||
    typeof s.ranges !== "object" ||
    Object.keys(s.ranges).sort().join() !==
      pkg.parameters
        .map((p) => p.key)
        .sort()
        .join()
  )
    return fail("Specify only the supported environment parameters.");
  const ranges: Record<string, ParameterRange> = {};
  for (const p of pkg.parameters) {
    const r = s.ranges[p.key];
    if (
      !Array.isArray(r) ||
      r.length !== 2 ||
      r.some((v) => typeof v !== "number" || !Number.isFinite(v)) ||
      r[0] < p.bounds[0] ||
      r[1] > p.bounds[1] ||
      r[0] > r[1]
    )
      return fail(
        `${p.label} must stay within ${p.bounds[0]}–${p.bounds[1]} ${p.unit}, with minimum ≤ maximum.`,
      );
    ranges[p.key] = [...r];
  }
  if (
    s.environments > 1 &&
    !Object.values(ranges).some(([lo, hi]) => hi - lo >= 0.001)
  )
    return fail("Vary at least one parameter to build distinct environments.");
  return {
    version: s.version,
    task: s.task,
    package_id: s.package_id,
    policy_id: s.policy_id,
    purpose: s.purpose,
    question: s.question.trim(),
    ranges,
    environments: s.environments,
    episodes: s.episodes,
    steps: s.steps,
    seed: s.seed,
    evidence_id: s.evidence_id,
  };
}
export function coverageLabel(spec: ExperimentSpecification) {
  const count = spec.environments ?? 16;
  if (!Number.isSafeInteger(count) || count < 1)
    return "Choose an environment count";
  if (count === 1) return "1 parameter configuration";
  const side = Math.sqrt(count);
  return Object.values(spec.ranges).filter(([lo, hi]) => lo !== hi).length ===
    2 && Number.isInteger(side)
    ? `${side} × ${side} parameter grid`
    : `${count} stratified parameter combinations`;
}
function coprimeStride(stride: number, count: number): number {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  while (gcd(stride, count) !== 1) stride++;
  return stride;
}
export function buildStudy(value: unknown): {
  specification: ExperimentSpecification;
  plan: Plan;
} {
  const specification = validateSpecification(value);
  const s = specification,
    pkg = taskPackages[s.task];
  const varying = pkg.parameters.filter(
    (p) => s.ranges[p.key][0] !== s.ranges[p.key][1],
  );
  const count = s.environments;
  const side = Math.sqrt(count);
  const grid = varying.length === 2 && Number.isInteger(side) && count > 1;
  const strides = [1, 5, 7, 11, 13, 3].map((stride) =>
    coprimeStride(stride, count),
  );
  const scenarios = Array.from({ length: count }, (_, i) => {
    const parameters = Object.fromEntries(
      pkg.parameters.map((p, j) => {
        const [lo, hi] = s.ranges[p.key];
        const position = varying.indexOf(p);
        const t =
          count === 1
            ? 0.5
            : grid
              ? (position === 0 ? Math.floor(i / side) : i % side) / (side - 1)
              : ((i * strides[j] + s.seed * (j + 1)) % count) / (count - 1);
        const value = lo + (hi - lo) * t;
        return [p.key, count === 16 ? Number(value.toFixed(6)) : value];
      }),
    );
    return {
      ...parameters,
      id: `scene-${String(i + 1).padStart(2, "0")}`,
      task: s.task,
      name: `Configuration ${String(i + 1).padStart(2, "0")}`,
      rationale: varying
        .map((p) => `${p.label}: ${parameters[p.key]} ${p.unit}`)
        .join(" · "),
      seed: 100000 + s.seed * 1600 + i * 100,
      training_bounds: s.ranges,
    } as unknown as Scenario;
  });
  for (const scene of scenarios) {
    const insights = scenarioInsights(scene, scenarios);
    scene.name = insights.title;
    scene.rationale = insights.rationale;
  }
  const plan: Plan = {
    task: s.task,
    title: `${pkg.name} · ${s.purpose === "evaluate" ? "reliability study" : "policy improvement"}`,
    hypothesis: s.question,
    scenarios,
    reward: { ...pkg.reward },
    assumptions: [
      pkg.description,
      ...pkg.limitations,
      "Exploratory simulation: physical calibration and clinical validation are not established.",
      "The research question documents intent; the reviewed parameter ranges define execution. Unsupported mechanics are not added or substituted.",
      `${coverageLabel(s)}. ${s.episodes} episodes per environment. Development evaluation; no held-out validation set.`,
      "Training perturbations are clipped to the reviewed ranges. Other task-native seeded variation remains unchanged.",
    ],
    provider: "Reviewed parameter study",
    model: "deterministic",
    version: `${s.task}-experiment-v1`,
  };
  return { specification, plan };
}
export async function reviewStudy(value: unknown) {
  const study = buildStudy(value);
  const bytes = new TextEncoder().encode(JSON.stringify(study));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const fingerprint = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return { ...study, fingerprint };
}
export type ReviewedStudy = Awaited<ReturnType<typeof reviewStudy>>;

/** Workers may add rendered assets, but cannot change the reviewed experiment. */
export function matchesReviewedPlan(actual: unknown, expected: Plan): boolean {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object")
      return `{${Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
        .join(",")}}`;
    return JSON.stringify(value) ?? "undefined";
  };
  if (!actual || typeof actual !== "object") return false;
  const plan = actual as Plan;
  if (
    !Array.isArray(plan.scenarios) ||
    plan.scenarios.length !== expected.scenarios.length
  )
    return false;
  return Object.keys(expected).every((key) =>
    key === "scenarios"
      ? expected.scenarios.every((scene, i) =>
          Object.entries(scene).every(
            ([field, value]) =>
              canonical(
                (plan.scenarios[i] as unknown as Record<string, unknown>)?.[
                  field
                ],
              ) === canonical(value),
          ),
        )
      : canonical(plan[key as keyof Plan]) ===
        canonical(expected[key as keyof Plan]),
  );
}
