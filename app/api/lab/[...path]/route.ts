import {
  reviewStudy,
  SpecificationError,
  matchesReviewedPlan,
} from "@/lib/experiment-spec";
import {
  database,
  enqueue,
  env,
  experiment,
  json,
  parseJob,
  validLease,
  workerAuthorized,
  browserAuthorized,
} from "@/lib/server";
import { isTask } from "@/lib/tasks";
import type {
  Experiment,
  JobKind,
  RewardSpec,
  Run,
  TaskKind,
} from "@/lib/types";

const idPattern = /^[a-zA-Z0-9_-]{1,80}$/;
const limits: Record<keyof RewardSpec, [number, number]> = {
  completion: [1, 100],
  milestones: [0, 10],
  closure: [0, 10],
  placement: [0, 10],
  smoothness: [0, 1],
  failure: [0, 100],
};
function rewardValid(value: unknown, task: TaskKind = "stitch") {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  const expected = [
    "completion",
    "milestones",
    task === "lifting" ? "placement" : "closure",
    "smoothness",
    "failure",
  ];
  if (
    Object.keys(r).length !== expected.length ||
    Object.keys(r).some((key) => !expected.includes(key))
  )
    return false;
  return Object.entries(limits)
    .filter(([key]) => expected.includes(key))
    .every(
      ([key, [lo, hi]]) =>
        typeof r[key] === "number" &&
        Number.isFinite(r[key]) &&
        Number(r[key]) >= lo &&
        Number(r[key]) <= hi,
    );
}
async function handle(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname.split("/api/lab/")[1]?.split("/") ?? [];
  const method = request.method;
  const isWorker = path[0] === "worker";
  if (
    isWorker
      ? !workerAuthorized(request)
      : !(
          browserAuthorized(request) ||
          (path[0] === "artifacts" &&
            method === "GET" &&
            workerAuthorized(request))
        )
  )
    return json({ error: "Authentication required" }, 401);
  if (!isWorker && method !== "GET") {
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin)
      return json({ error: "Cross-origin mutation rejected" }, 403);
    if (!request.headers.get("Content-Type")?.includes("application/json"))
      return json({ error: "JSON body required" }, 415);
  }
  const db = await database();
  if (path[0] === "health" && method === "GET") {
    const rows = await db
      .prepare("SELECT * FROM workers WHERE updated_at>?")
      .bind(Date.now() - 30000)
      .all();
    return json({
      workers: rows.results.map((row) => ({
        ...JSON.parse(String(row.data)),
        last_seen: row.updated_at,
      })),
      storage: "D1 + R2",
      simulator: "MuJoCo",
    });
  }
  if (path[0] === "plans" && path.length === 1 && method === "POST") {
    const body = (await request.json()) as { specification?: unknown };
    return json(await reviewStudy(body.specification));
  }
  if (path[0] === "experiments" && path.length === 1) {
    if (method === "GET") {
      const rows = await db
        .prepare(
          "SELECT data FROM experiments ORDER BY created_at DESC LIMIT 100",
        )
        .all<{ data: string }>();
      return json(rows.results.map((row) => JSON.parse(row.data)));
    }
    if (method === "POST") {
      const b = (await request.json()) as {
        task?: TaskKind;
        prompt: string;
        source?: string;
        parent_id?: string;
        feedback?: string;
        specification?: unknown;
        review_fingerprint?: string;
      };
      const reviewed =
        b.specification !== undefined
          ? await reviewStudy(b.specification)
          : undefined;
      if (reviewed) {
        if (b.parent_id)
          return json(
            { error: "Reviewed studies must be launched as a new experiment." },
            400,
          );
        if (b.review_fingerprint !== reviewed.fingerprint)
          return json(
            {
              error: "The plan has changed. Review it again before launching.",
            },
            409,
          );
        if (b.task !== undefined && b.task !== reviewed.specification.task)
          return json(
            { error: "Task does not match the reviewed specification." },
            400,
          );
        b.task = reviewed.specification.task;
        b.prompt = reviewed.specification.question;
        b.source = "template";
      }
      if (
        typeof b.prompt !== "string" ||
        b.prompt.trim().length < 10 ||
        b.prompt.length > 4000
      )
        return json(
          { error: "Describe the task in 10–4,000 characters." },
          400,
        );
      if (b.source && !["astra", "template"].includes(b.source))
        return json({ error: "Unknown planner" }, 400);
      if (
        b.feedback !== undefined &&
        (typeof b.feedback !== "string" || b.feedback.length > 4000)
      )
        return json(
          { error: "Feedback must be at most 4,000 characters." },
          400,
        );
      if (b.task !== undefined && !isTask(b.task))
        return json({ error: "Unsupported task" }, 400);
      let task: TaskKind = b.task ?? "stitch";
      let feedback = "";
      if (b.parent_id) {
        const parent = await experiment(b.parent_id);
        if (!parent?.plan)
          return json({ error: "Parent experiment not found" }, 400);
        const parentTask = parent.task ?? "stitch";
        if (b.task && b.task !== parentTask)
          return json({ error: "Refinement must retain the parent task" }, 400);
        if (parent.specification)
          return json(
            {
              error:
                "Create a new reviewed study to change this experiment’s operating envelope.",
            },
            409,
          );
        task = parentTask;
        const rows = await db
          .prepare(
            `SELECT r.data FROM runs r JOIN jobs j ON j.id=r.job_id
            WHERE r.experiment_id=? AND j.status='completed'
              AND j.kind IN ('baseline','candidate')
              AND j.id=(SELECT latest.id FROM jobs latest
                WHERE latest.experiment_id=j.experiment_id
                  AND latest.kind=j.kind AND latest.status='completed'
                ORDER BY latest.created_at DESC LIMIT 1)`,
          )
          .bind(b.parent_id)
          .all<{ data: string }>();
        const runs = rows.results.map((r) => JSON.parse(r.data) as Run);
        const grouped = parent.plan.scenarios.map((s) => ({
          scenario_id: s.id,
          results: ["baseline", "candidate"].map((controller) => {
            const values = runs.filter(
              (r) => r.scenario_id === s.id && r.controller === controller,
            );
            return {
              controller,
              evaluation_job_id: values[0]?.job_id ?? null,
              episodes: values.length,
              successes: values.filter((r) => r.info.success).length,
              [task === "lifting" ? "mean_placement_error_mm" : "mean_gap_mm"]:
                values.length
                  ? values.reduce(
                      (sum, r) =>
                        sum +
                        Number(
                          task === "lifting"
                            ? r.info.placement_error
                            : r.info.wound_gap_m,
                        ) *
                          1000,
                      0,
                    ) / values.length
                  : null,
              ...(task === "lifting"
                ? {
                    clearances: values.filter((r) => r.info.cleared).length,
                    drops: values.reduce(
                      (sum, r) => sum + (r.info.drops ?? 0),
                      0,
                    ),
                    unwanted_contacts: values.reduce(
                      (sum, r) => sum + r.info.unwanted_collisions,
                      0,
                    ),
                  }
                : {}),
              failures: values
                .filter((r) => !r.info.success)
                .map((r) => ({ seed: r.seed, reason: r.info.termination })),
            };
          }),
        }));
        feedback = JSON.stringify({
          user_feedback: b.feedback ?? "",
          measured_development_results: grouped,
          previous_plan: parent.plan,
        });
      }
      const e: Experiment = {
        id: crypto.randomUUID(),
        task,
        title: reviewed?.plan.title ?? b.prompt.slice(0, 75),
        prompt: b.prompt.trim(),
        source: b.source === "template" ? "template" : "astra",
        plan: null,
        created_at: Date.now(),
        ...(b.parent_id ? { parent_id: b.parent_id } : {}),
        ...(reviewed
          ? {
              specification: reviewed.specification,
              reviewed_plan: reviewed.plan,
              review_fingerprint: reviewed.fingerprint,
            }
          : {}),
      };
      await db
        .prepare("INSERT INTO experiments VALUES(?,?,?)")
        .bind(e.id, JSON.stringify(e), e.created_at)
        .run();
      const job = await enqueue(e.id, b.parent_id ? "refine" : "generate", {
        source: e.source,
        feedback,
      });
      return json({ experiment: e, job_id: job }, 201);
    }
  }
  if (path[0] === "experiments" && idPattern.test(path[1] ?? "")) {
    const e = await experiment(path[1]);
    if (!e) return json({ error: "Experiment not found" }, 404);
    if (path.length === 2 && method === "GET") {
      const [jobs, runs] = await Promise.all([
        db
          .prepare(
            "SELECT * FROM jobs WHERE experiment_id=? ORDER BY created_at DESC",
          )
          .bind(e.id)
          .all(),
        db
          .prepare("SELECT data FROM runs WHERE experiment_id=?")
          .bind(e.id)
          .all<{ data: string }>(),
      ]);
      return json({
        experiment: e,
        jobs: jobs.results.map(parseJob).map((j) => ({
          id: j.id,
          experiment_id: j.experiment_id,
          kind: j.kind,
          status: j.status,
          progress: j.progress,
          message: j.message,
          data: j.data,
          result: j.result,
          error: j.error,
          created_at: j.created_at,
        })),
        runs: runs.results.map((r) => JSON.parse(r.data)),
      });
    }
    if (path[2] === "jobs" && method === "POST") {
      const b = (await request.json()) as {
        kind: JobKind;
        episodes?: number;
        steps?: number;
        seed?: number;
        reward?: RewardSpec;
        resume?: boolean;
      };
      if (!e.plan)
        return json({ error: "Generate valid scenarios first." }, 409);
      if (!["baseline", "train", "candidate"].includes(b.kind))
        return json({ error: "Unsupported job kind" }, 400);
      let episodes = b.episodes ?? e.specification?.episodes ?? 3;
      const steps = b.steps ?? e.specification?.steps ?? 8192,
        seed = b.seed ?? e.specification?.seed ?? 7;
      if (
        !Number.isInteger(episodes) ||
        episodes < 1 ||
        episodes > 20 ||
        !Number.isInteger(steps) ||
        steps < 1024 ||
        steps > 131072 ||
        !Number.isInteger(seed) ||
        seed < 0 ||
        seed > 2147483647
      )
        return json({ error: "Invalid episode, step, or seed budget." }, 400);
      const reward = b.reward ?? e.plan.reward;
      if (!rewardValid(reward, e.task ?? "stitch"))
        return json({ error: "Invalid reward weights." }, 400);
      let checkpoint: string | undefined;
      let baselineJobId: string | undefined;
      if (b.kind === "train" || b.kind === "candidate") {
        const base = await db
          .prepare(
            "SELECT id,data FROM jobs WHERE experiment_id=? AND kind='baseline' AND status='completed' ORDER BY created_at DESC LIMIT 1",
          )
          .bind(e.id)
          .first<{ id: string; data: string }>();
        if (!base)
          return json({ error: "Complete baseline evaluation first." }, 409);
        if (b.kind === "candidate") {
          episodes = JSON.parse(base.data).episodes;
          baselineJobId = base.id;
        }
      }
      if (b.kind === "candidate" || (b.kind === "train" && b.resume)) {
        const trained = await db
          .prepare(
            "SELECT result FROM jobs WHERE experiment_id=? AND kind='train' AND status='completed' ORDER BY created_at DESC LIMIT 1",
          )
          .bind(e.id)
          .first<{ result: string }>();
        checkpoint = trained
          ? JSON.parse(trained.result).checkpoint
          : undefined;
        if (!checkpoint)
          return json({ error: "Complete RL training first." }, 409);
      }
      return json(
        {
          job_id: await enqueue(e.id, b.kind, {
            episodes,
            steps,
            seed,
            reward,
            checkpoint,
            baseline_job_id: baselineJobId,
          }),
        },
        201,
      );
    }
  }
  if (path[0] === "jobs" && path[2] === "cancel" && method === "POST") {
    const r = await db
      .prepare(
        "UPDATE jobs SET cancel=1,status='cancelled',message='Cancelled by user',updated_at=? WHERE id=? AND status IN ('running','queued')",
      )
      .bind(Date.now(), path[1])
      .run();
    return json({ cancelled: r.meta.changes > 0 });
  }
  if (path[0] === "artifacts" && method === "GET") {
    const key = path.slice(1).join("/");
    if (!key || key.includes(".."))
      return json({ error: "Invalid artifact key" }, 400);
    const object = await env.ARTIFACTS.get(key, { range: request.headers });
    if (!object) return json({ error: "Artifact not found" }, 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("ETag", object.httpEtag);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "private, max-age=3600");
    const range = object.range as
      { offset?: number; length?: number } | undefined;
    if (
      request.headers.has("Range") &&
      range &&
      range.offset !== undefined &&
      range.length !== undefined
    ) {
      headers.set(
        "Content-Range",
        `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`,
      );
      headers.set("Content-Length", String(range.length));
      return new Response(object.body, { status: 206, headers });
    }
    headers.set("Content-Length", String(object.size));
    return new Response(object.body, { headers });
  }
  if (isWorker && method === "POST" && path[1] === "claim") {
    const b = (await request.json()) as { id: string; capabilities: unknown };
    await db
      .prepare(
        "INSERT INTO workers VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,data=excluded.data",
      )
      .bind(b.id, Date.now(), JSON.stringify(b.capabilities))
      .run();
    await db
      .prepare(
        "UPDATE jobs SET status='failed',error='Worker lease expired after three attempts',updated_at=? WHERE status='running' AND lease_until<? AND attempts>=3",
      )
      .bind(Date.now(), Date.now())
      .run();
    const token = crypto.randomUUID();
    const now = Date.now();
    const row = await db
      .prepare(
        `UPDATE jobs SET status='running',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=?,progress=0,message='Worker started' WHERE id=(SELECT id FROM jobs WHERE cancel=0 AND (status='queued' OR (status='running' AND lease_until<? AND attempts<3)) ORDER BY created_at LIMIT 1) RETURNING *`,
      )
      .bind(token, now + 60000, now, now)
      .first<Record<string, unknown>>();
    if (!row) return json({ job: null });
    await db.prepare("DELETE FROM runs WHERE job_id=?").bind(row.id).run();
    return json({
      job: parseJob(row),
      token,
      experiment: await experiment(String(row.experiment_id)),
    });
  }
  if (isWorker && path[1] === "jobs" && path[2]) {
    const id = path[2];
    const token = request.headers.get("X-Lease-Token") ?? "";
    const row = await validLease(id, token);
    if (!row) return json({ error: "Lease expired or job cancelled" }, 409);
    if (path[3] === "artifacts" && method === "PUT") {
      const name = path.slice(4).join("/");
      if (!/^[a-zA-Z0-9_./-]+$/.test(name) || name.includes(".."))
        return json({ error: "Invalid artifact name" }, 400);
      const size = Number(request.headers.get("Content-Length") ?? 0);
      if (!size || size > 100 * 1024 * 1024)
        return json({ error: "Artifact must be 1 byte–100 MB" }, 413);
      const key = `${row.experiment_id}/${id}/${token}/${name}`;
      await env.ARTIFACTS.put(key, request.body, {
        httpMetadata: {
          contentType:
            request.headers.get("Content-Type") ?? "application/octet-stream",
        },
      });
      return json({ key });
    }
    if (method !== "POST") return json({ error: "Method not allowed" }, 405);
    const b = (await request.json()) as Record<string, unknown>;
    const guard =
      "id=? AND lease_token=? AND lease_until>? AND status='running' AND cancel=0";
    if (path[3] === "heartbeat") {
      const progress = Math.min(1, Math.max(0, Number(b.progress) || 0));
      const r = await db
        .prepare(
          `UPDATE jobs SET lease_until=?,updated_at=?,progress=?,message=? WHERE ${guard}`,
        )
        .bind(
          Date.now() + 60000,
          Date.now(),
          progress,
          String(b.message ?? "Running").slice(0, 500),
          id,
          token,
          Date.now(),
        )
        .run();
      if (b.worker_id)
        await db
          .prepare("UPDATE workers SET updated_at=? WHERE id=?")
          .bind(Date.now(), b.worker_id)
          .run();
      return json({ active: r.meta.changes > 0 });
    }
    if (path[3] === "runs") {
      const run = { ...b, experiment_id: row.experiment_id, job_id: id };
      await db
        .prepare(
          `INSERT OR REPLACE INTO runs SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM jobs WHERE ${guard})`,
        )
        .bind(
          String(b.id),
          row.experiment_id,
          id,
          JSON.stringify(run),
          id,
          token,
          Date.now(),
        )
        .run();
      return json({ ok: true });
    }
    if (path[3] === "complete") {
      const statements = [];
      if (b.plan) {
        const e = await experiment(String(row.experiment_id));
        if (e?.reviewed_plan && !matchesReviewedPlan(b.plan, e.reviewed_plan))
          return json(
            {
              error:
                "Worker output differs from the reviewed plan. Update the worker and retry.",
            },
            409,
          );
        const plan = b.plan as { title: string };
        statements.push(
          db
            .prepare(
              `UPDATE experiments SET data=? WHERE id=? AND EXISTS(SELECT 1 FROM jobs WHERE ${guard})`,
            )
            .bind(
              JSON.stringify({ ...e, plan, title: plan.title }),
              row.experiment_id,
              id,
              token,
              Date.now(),
            ),
        );
      }
      statements.push(
        db
          .prepare(
            `UPDATE jobs SET status='completed',progress=1,result=?,message='Complete',updated_at=? WHERE ${guard}`,
          )
          .bind(
            JSON.stringify(b.result ?? {}),
            Date.now(),
            id,
            token,
            Date.now(),
          ),
      );
      const results = await db.batch(statements);
      return json({ ok: results.at(-1)!.meta.changes > 0 });
    }
    if (path[3] === "fail") {
      await db
        .prepare(
          `UPDATE jobs SET status='failed',error=?,message='Failed',updated_at=? WHERE ${guard}`,
        )
        .bind(String(b.error).slice(0, 2000), Date.now(), id, token, Date.now())
        .run();
      return json({ ok: true });
    }
  }
  return json({ error: "Endpoint not found" }, 404);
}
async function route(request: Request) {
  try {
    return await handle(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (message.includes("UNIQUE constraint"))
      return json({ error: "An experiment job is already running." }, 409);
    if (error instanceof SpecificationError)
      return json({ error: message }, 400);
    if (error instanceof SyntaxError)
      return json({ error: "Invalid JSON" }, 400);
    console.error("Lab API failure", message);
    return json({ error: "The experiment service encountered an error." }, 500);
  }
}
export const GET = route;
export const POST = route;
export const PUT = route;
