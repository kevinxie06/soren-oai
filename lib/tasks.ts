import type { TaskKind } from "./types";

export const taskInfo = {
  stitch: {
    name: "Suturing",
    heading: "Needle transfer & wound closure",
    prompt:
      "Improve closure stability across wider wounds and stiffer tissue while maintaining successful needle transfer.",
    checkpoint: "stitch/policy.npz",
    sweep: "Built-in · gap × stiffness sweep",
    description:
      "Needle transfer and tensioned wound closure using rigid spring-mounted patches.",
  },
  lifting: {
    name: "Object lifting",
    heading: "Object lifting & placement",
    prompt:
      "Improve reliable object lifting from the cavity and placement into the tray across object positions, orientations, and tray distances. Avoid drops and wall contacts.",
    checkpoint: "policy_recovery.npz",
    sweep: "Built-in · object pose × tray position",
    description:
      "Lift the existing rigid object out of its cavity and place it in a tray using an assisted gripper. Object shape, mass, and cavity geometry stay fixed.",
  },
} satisfies Record<TaskKind, Record<string, string>>;

export function isTask(value: unknown): value is TaskKind {
  return value === "stitch" || value === "lifting";
}
