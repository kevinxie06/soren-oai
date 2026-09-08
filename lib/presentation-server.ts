import { database, env, json } from "./server";
import type { Experiment, Run } from "./types";

// This handler is only reached after worker-token authentication. It attaches
// presentation artifacts; the original trajectory, results and plan stay intact.
export async function presentationRequest(request: Request) {
  const db = await database();
  if (request.method === "GET") {
    const experiments = await db
      .prepare(
        `SELECT e.data FROM experiments e
      WHERE NOT EXISTS(SELECT 1 FROM jobs j WHERE j.experiment_id=e.id AND j.status IN ('queued','running'))
      AND EXISTS(SELECT 1 FROM json_each(json_extract(e.data,'$.plan.scenarios')) s WHERE coalesce(json_extract(s.value,'$.presentation_version'),0)<1)
      ORDER BY e.created_at DESC LIMIT 1`,
      )
      .first<{ data: string }>();
    if (experiments) {
      const e = JSON.parse(experiments.data) as Experiment;
      const scenario = e.plan?.scenarios.find((s) => !s.presentation_version);
      if (scenario) return json({ kind: "scenario", id: e.id, scenario });
    }
    const row = await db
      .prepare(
        `SELECT r.data FROM runs r JOIN jobs j ON j.id=r.job_id
      WHERE j.status IN ('completed','cancelled','failed') AND coalesce(json_extract(r.data,'$.presentation_version'),0)<1
      AND json_extract(r.data,'$.episode')=0 AND json_extract(r.data,'$.trajectory') IS NOT NULL
      AND json_extract(r.data,'$.manifest') IS NOT NULL LIMIT 1`,
      )
      .first<{ data: string }>();
    return json(
      row
        ? {
            kind: "run",
            id: JSON.parse(row.data).id,
            run: JSON.parse(row.data),
          }
        : null,
    );
  }
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);
  if (Number(request.headers.get("Content-Length")) > 32 * 1024 * 1024)
    return json({ error: "Motion too large" }, 413);
  const { target, motion } = (await request.json()) as {
    target: { kind: string; id: string; scenario?: { id: string }; run?: Run };
    motion: { schema_version: string; frames: unknown[]; geometry: unknown[] };
  };
  if (
    !target ||
    !["scenario", "run"].includes(target.kind) ||
    !Array.isArray(motion?.frames) ||
    !motion.frames.length ||
    !Array.isArray(motion.geometry) ||
    !motion.geometry.length ||
    !["soren.motion.v1", "soren.stitch.v1"].includes(motion.schema_version)
  )
    return json({ error: "Invalid presentation" }, 400);
  const table = target.kind === "scenario" ? "experiments" : "runs";
  const row = await db
    .prepare(`SELECT data FROM ${table} WHERE id=?`)
    .bind(target.id)
    .first<{ data: string }>();
  if (!row) return json({ error: "Recording no longer exists" }, 409);
  const document = JSON.parse(row.data);
  const item =
    target.kind === "scenario"
      ? (document as Experiment).plan?.scenarios.find(
          (s) => s.id === target.scenario?.id,
        )
      : document;
  if (!item) return json({ error: "Scenario no longer exists" }, 409);
  if (item.motion && item.presentation_version === 1) return json({ ok: true });
  if (
    target.kind === "scenario" &&
    JSON.stringify(item) !== JSON.stringify(target.scenario)
  )
    return json({ error: "Scenario changed during backfill" }, 409);
  if (
    target.kind === "run" &&
    (item.trajectory !== target.run?.trajectory ||
      item.manifest !== target.run?.manifest)
  )
    return json({ error: "Recording changed during backfill" }, 409);
  // Unique keys and a compare-and-swap prevent concurrent backfills from
  // overwriting newer plan/run data, or publishing a partially uploaded artifact.
  const key = `presentation/${crypto.randomUUID()}/motion.json`;
  await env.ARTIFACTS.put(key, JSON.stringify(motion), {
    httpMetadata: { contentType: "application/json" },
  });
  item.motion = key;
  item.presentation_version = 1;
  const result = await db
    .prepare(`UPDATE ${table} SET data=? WHERE id=? AND data=?`)
    .bind(JSON.stringify(document), target.id, row.data)
    .run();
  if (!result.meta.changes) await env.ARTIFACTS.delete(key);
  return json({ ok: !!result.meta.changes });
}
