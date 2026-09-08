/** Validate worker data before it can enable controls or reach the renderer. */
export function parseState(value) {
  const finite = (number) =>
    typeof number === "number" && Number.isFinite(number);
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.ready !== "boolean" ||
    typeof value.running !== "boolean" ||
    typeof value.demo !== "boolean" ||
    typeof value.scene !== "string" ||
    typeof value.camera !== "string" ||
    !finite(value.sim_time) ||
    !finite(value.updated_at) ||
    !Array.isArray(value.joints) ||
    !value.joints.every(finite) ||
    !Array.isArray(value.joint_names) ||
    !value.joint_names.every((s) => typeof s === "string") ||
    value.joints.length !== value.joint_names.length ||
    !Array.isArray(value.capabilities) ||
    !value.capabilities.every((s) => typeof s === "string")
  ) {
    throw new Error("Worker returned an invalid simulation state.");
  }
  if (
    value.cameras !== undefined &&
    (!Array.isArray(value.cameras) ||
      !value.cameras.every((s) => typeof s === "string"))
  )
    throw new Error("Invalid camera catalog.");
  if (
    value.catalog !== undefined &&
    (!Array.isArray(value.catalog) ||
      !value.catalog.every(
        (item) =>
          item && typeof item.id === "string" && typeof item.label === "string",
      ))
  )
    throw new Error("Invalid environment catalog.");
  if (
    value.metrics !== undefined &&
    (!value.metrics ||
      typeof value.metrics !== "object" ||
      Array.isArray(value.metrics) ||
      !Object.values(value.metrics).every(finite))
  )
    throw new Error("Invalid evaluation metrics.");
  if (value.outcome !== undefined && typeof value.outcome !== "string")
    throw new Error("Invalid episode outcome.");
  return value;
}
