import * as T from "three";
import type { Scenario } from "@/lib/types";
import type { Motion } from "./showcase/types";
import type { StitchMotion } from "./suturing/types";

export interface ScenarioGuide {
  scenario: Scenario;
  midpoint: Record<string, number>;
}

/** Static, world-space initial-state guides. They never alter recorded geometry. */
export function createScenarioGuides(
  motion: Motion | StitchMotion,
  guide: ScenarioGuide,
) {
  const root = new T.Group();
  root.name = "initial_condition_guides";
  function line(name: string, points: number[][], reference = false) {
    const material = reference
      ? new T.LineDashedMaterial({
          color: "#ffffff",
          dashSize: 0.0015,
          gapSize: 0.001,
          depthTest: false,
          transparent: true,
          opacity: 0.8,
        })
      : new T.LineBasicMaterial({
          color: "#ffc76b",
          depthTest: false,
          transparent: true,
          opacity: 0.95,
        });
    const object = new T.Line(
      new T.BufferGeometry().setFromPoints(
        points.map((p) => new T.Vector3().fromArray(p)),
      ),
      material,
    );
    object.name = name;
    object.renderOrder = 20;
    object.computeLineDistances();
    root.add(object);
    return object;
  }
  const s = guide.scenario,
    mid = guide.midpoint;
  if (s.task !== "lifting" && motion.schema_version === "soren.stitch.v1") {
    const recording = motion as StitchMotion;
    const [x, y, z] = recording.scene.center;
    const gap = recording.frames[0].gap_m;
    function ruler(
      name: string,
      width: number,
      yy: number,
      reference: boolean,
    ) {
      line(
        name,
        [
          [x - width / 2, yy, z + 0.002],
          [x + width / 2, yy, z + 0.002],
        ],
        reference,
      );
      for (const sign of [-1, 1])
        line(
          `${name}_tick_${sign}`,
          [
            [x + (sign * width) / 2, yy - 0.0015, z + 0.002],
            [x + (sign * width) / 2, yy + 0.0015, z + 0.002],
          ],
          reference,
        );
    }
    ruler("recorded_initial_gap", gap, y, false);
    ruler("midpoint_gap", mid.gap_mm / 1000, y + 0.005, true);
    const center = recording.frames[0].center;
    for (const reference of [false, true]) {
      const radius = reference ? mid.radius_mm / 1000 : recording.scene.radius;
      const c = center.map(
        (v, i) =>
          v +
          (reference
            ? (mid[["offset_x_mm", "offset_y_mm", "offset_z_mm"][i]] -
                [s.offset_x_mm, s.offset_y_mm, s.offset_z_mm][i]) /
              1000
            : 0),
      );
      line(
        reference ? "midpoint_needle_circle" : "initial_needle_circle",
        Array.from({ length: 65 }, (_, i) => {
          const a = (i / 64) * Math.PI * 2;
          return [
            c[0] + radius * Math.cos(a),
            c[1],
            c[2] + radius * Math.sin(a),
          ];
        }),
        reference,
      );
    }
  } else if (
    s.task === "lifting" &&
    motion.schema_version !== "soren.stitch.v1"
  ) {
    for (const name of ["object_collision", "tray_floor"]) {
      const index = motion.geometry.findIndex((g) => g.name === name);
      if (index < 0) continue;
      const shape = motion.geometry[index],
        pose = motion.frames[0].poses[index];
      const [sx, sy, sz] = shape.half_size_m;
      for (const reference of [false, true]) {
        const position = new T.Vector3().fromArray(pose.position_m);
        const q = pose.quaternion_wxyz;
        const rotation = new T.Quaternion(q[1], q[2], q[3], q[0]);
        if (reference) {
          position.x +=
            (mid[name === "tray_floor" ? "tray_x_mm" : "object_x_mm"] -
              (name === "tray_floor" ? s.tray_x_mm : s.object_x_mm)) /
            1000;
          position.y +=
            (mid[name === "tray_floor" ? "tray_y_mm" : "object_y_mm"] -
              (name === "tray_floor" ? s.tray_y_mm : s.object_y_mm)) /
            1000;
          if (name === "object_collision")
            rotation.premultiply(
              new T.Quaternion().setFromAxisAngle(
                new T.Vector3(0, 0, 1),
                T.MathUtils.degToRad(mid.object_yaw_deg - s.object_yaw_deg),
              ),
            );
        }
        const points = [
          [-sx, -sy, sz],
          [sx, -sy, sz],
          [sx, sy, sz],
          [-sx, sy, sz],
          [-sx, -sy, sz],
        ].map((p) =>
          new T.Vector3()
            .fromArray(p)
            .applyQuaternion(rotation)
            .add(position)
            .toArray(),
        );
        line(
          `${reference ? "midpoint" : "initial"}_${name}_bounds`,
          points,
          reference,
        );
      }
    }
  }
  return root;
}
