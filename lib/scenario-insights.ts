import type { Scenario } from "./types";

const definitions = {
  gap_mm: [
    "Wound gap",
    "Gap",
    "mm",
    "Needle span and closure travel",
    "Check needle clearance, final gap, and completion.",
  ],
  stiffness: [
    "Spring stiffness",
    "Spring",
    "N/m",
    "Closure under spring resistance",
    "Compare closure stability and thread tension; stiffness is not visible in the initial geometry.",
  ],
  radius_mm: [
    "Needle radius",
    "Radius",
    "mm",
    "Needle arc and receiving alignment",
    "Check valid entry, exit, and receiving catch.",
  ],
  offset_x_mm: [
    "Starting offset X",
    "Start X",
    "mm",
    "Recovery from lateral misalignment",
    "Check whether the needle reaches the entry and receiving targets.",
  ],
  offset_y_mm: [
    "Starting offset Y",
    "Start Y",
    "mm",
    "Recovery from depth misalignment",
    "Check entry alignment, receiving catch, and flagged contacts.",
  ],
  offset_z_mm: [
    "Starting offset Z",
    "Start Z",
    "mm",
    "Approach from a different starting height",
    "Check approach, needle entry, and time to completion.",
  ],
  object_x_mm: [
    "Object position X",
    "Object X",
    "mm",
    "Grasp and rim clearance at an X offset",
    "Check grasp acquisition and flagged rim contacts.",
  ],
  object_y_mm: [
    "Object position Y",
    "Object Y",
    "mm",
    "Grasp and rim clearance at a Y offset",
    "Check grasp acquisition and clearance before transport.",
  ],
  object_yaw_deg: [
    "Object orientation",
    "Yaw",
    "°",
    "Grasp alignment under rotation",
    "Check grasp acquisition, drops, and flagged contacts.",
  ],
  tray_x_mm: [
    "Tray position X",
    "Tray X",
    "mm",
    "Transport to a different X target",
    "Check rim clearance before transport, placement error, and release.",
  ],
  tray_y_mm: [
    "Tray position Y",
    "Tray Y",
    "mm",
    "Lateral transport and placement",
    "Check placement error, drops, and settled completion.",
  ],
} as const;
export type ParameterKey = keyof typeof definitions;
export const formatParameter = (value: number) =>
  Number(value.toFixed(6)).toString();
function sensitivity(key: ParameterKey, delta: number) {
  if (Math.abs(delta) < 1e-9) return "At the range midpoint";
  switch (key) {
    case "gap_mm":
      return delta > 0
        ? "Wider gap requires more closure travel"
        : "Narrower gap requires less closure travel";
    case "stiffness":
      return delta > 0
        ? "Stronger spring resistance during closure"
        : "Weaker spring resistance during closure";
    case "radius_mm":
      return delta > 0
        ? "Larger needle arc changes entry and receiving alignment"
        : "Smaller needle arc changes entry and receiving alignment";
    case "offset_z_mm":
      return delta > 0
        ? "Higher starting needle approach"
        : "Lower starting needle approach";
    case "offset_x_mm":
      return `Needle starts toward ${delta > 0 ? "+X" : "−X"} relative to midpoint`;
    case "offset_y_mm":
      return `Needle starts toward ${delta > 0 ? "+Y" : "−Y"} relative to midpoint`;
    case "object_x_mm":
      return `Grasp target shifts toward ${delta > 0 ? "+X" : "−X"}`;
    case "object_y_mm":
      return `Grasp target shifts toward ${delta > 0 ? "+Y" : "−Y"}`;
    case "object_yaw_deg":
      return `Object rotates ${delta > 0 ? "positively" : "negatively"} from midpoint orientation`;
    case "tray_x_mm":
      return `Placement target shifts toward ${delta > 0 ? "+X" : "−X"}`;
    case "tray_y_mm":
      return `Placement target shifts toward ${delta > 0 ? "+Y" : "−Y"}`;
  }
}
export function scenarioInsights(
  scenario: Scenario,
  suite: Scenario[] = [scenario],
) {
  const values = scenario as unknown as Record<string, unknown>;
  const parameters = (Object.keys(definitions) as ParameterKey[])
    .filter((key) => typeof values[key] === "number")
    .map((key) => {
      const [label, short, unit, focus, observe] = definitions[key];
      const value = values[key] as number;
      const samples = suite
        .filter((s) => (s.task ?? "stitch") === (scenario.task ?? "stitch"))
        .map((s) => (s as unknown as Record<string, number>)[key])
        .filter(Number.isFinite);
      const [lo, hi] = scenario.training_bounds?.[key] ?? [
        Math.min(value, ...samples),
        Math.max(value, ...samples),
      ];
      const midpoint = (lo + hi) / 2;
      const varying = hi - lo > 1e-9;
      const position = varying ? (value - lo) / (hi - lo) : 0.5;
      const location = !varying
        ? "Fixed"
        : position < 1e-6
          ? "Lower bound"
          : position > 1 - 1e-6
            ? "Upper bound"
            : "Interior";
      return {
        key,
        label,
        short,
        unit,
        focus,
        observe,
        value,
        lo,
        hi,
        midpoint,
        varying,
        position,
        location,
        delta: value - midpoint,
        sensitivity: sensitivity(key, value - midpoint),
      };
    });
  const varying = parameters.filter((p) => p.varying);
  const ranked = [...varying].sort(
    (a, b) => Math.abs(b.position - 0.5) - Math.abs(a.position - 0.5),
  );
  const primary = ranked.length ? ranked.slice(0, 2) : parameters.slice(0, 2);
  const title = primary
    .map((p) => `${p.short} ${formatParameter(p.value)} ${p.unit}`)
    .join(" · ");
  const boundary = varying.filter((p) => p.location !== "Interior");
  const role =
    boundary.length > 1
      ? "Combined boundary case"
      : boundary.length === 1
        ? "Boundary case"
        : varying.length
          ? "Interior coverage"
          : "Fixed configuration";
  const conditions = primary
    .map(
      (p) =>
        `${p.label.toLowerCase()} ${formatParameter(p.value)} ${p.unit}${p.varying ? ` (${p.location.toLowerCase()})` : ""}`,
    )
    .join(" and ");
  const purpose = `${primary.map((p) => (p.varying ? p.sensitivity : p.focus)).join("; ")}.`;
  const rationale = `${role}: ${conditions}. Tests ${primary.map((p) => p.focus.toLowerCase()).join(" and ")}. ${varying.length ? `Relative to the range midpoint: ${primary.map((p) => p.sensitivity.toLowerCase()).join("; ")}. ` : ""}${varying.length > 1 ? "Compare nearby cases to assess sensitivity; multiple parameters vary, so this case alone does not isolate a cause." : varying.length ? "Compare across this sweep to assess sensitivity to the varied parameter." : "No parameter variation is available in this comparison."}`;
  return {
    title,
    role,
    purpose,
    rationale,
    parameters,
    primary,
    varying,
    observations: [...new Set(primary.map((p) => p.observe))],
  };
}
