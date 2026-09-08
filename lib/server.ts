import { env } from "cloudflare:workers";
import { schema } from "@/db/schema";
import type { Experiment, Job, JobKind } from "@/lib/types";

let initialized: Promise<unknown> | undefined;
export async function database() {
  initialized ??= env.DB.batch(schema.map((sql) => env.DB.prepare(sql))).catch(
    (error) => {
      initialized = undefined;
      throw error;
    },
  );
  await initialized;
  return env.DB;
}
export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export function parseJob(row: Record<string, unknown>): Job {
  return {
    ...row,
    data: JSON.parse(String(row.data)),
    result: row.result ? JSON.parse(String(row.result)) : null,
  } as unknown as Job;
}
export async function experiment(id: string): Promise<Experiment | null> {
  const db = await database();
  const row = await db
    .prepare("SELECT data FROM experiments WHERE id=?")
    .bind(id)
    .first<{ data: string }>();
  return row ? JSON.parse(row.data) : null;
}
export async function enqueue(id: string, kind: JobKind, data: unknown) {
  const db = await database();
  const jobId = crypto.randomUUID();
  const now = Date.now();
  await db
    .prepare(
      "INSERT INTO jobs(id,experiment_id,kind,status,data,created_at,updated_at) VALUES(?,?,?,'queued',?,?,?)",
    )
    .bind(jobId, id, kind, JSON.stringify(data), now, now)
    .run();
  return jobId;
}
export function workerAuthorized(request: Request) {
  return Boolean(
    env.LAB_WORKER_TOKEN &&
    request.headers.get("Authorization") === `Bearer ${env.LAB_WORKER_TOKEN}`,
  );
}
export async function validLease(id: string, token: string) {
  const db = await database();
  return db
    .prepare(
      "SELECT * FROM jobs WHERE id=? AND lease_token=? AND lease_until>? AND status='running' AND cancel=0",
    )
    .bind(id, token, Date.now())
    .first<Record<string, unknown>>();
}
export function browserAuthorized(request: Request) {
  const host = new URL(request.url).hostname;
  if (host === "localhost" || host === "127.0.0.1") return true;
  return Boolean(
    env.LAB_ACCESS_TOKEN &&
    request.headers
      .get("Cookie")
      ?.split(";")
      .some((v) => v.trim() === `lab_access=${env.LAB_ACCESS_TOKEN}`),
  );
}
export { env };
