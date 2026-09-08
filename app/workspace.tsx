"use client";
import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Box,
  Check,
  ChevronRight,
  CircleHelp,
  FlaskConical,
  Layers,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { taskInfo } from "@/lib/tasks";
import type {
  TaskKind,
  Experiment,
  ExperimentDetail,
  Job,
  JobKind,
  RewardSpec,
  Run,
  Scenario,
  Telemetry,
} from "@/lib/types";

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch("/api/lab" + path, {
    ...(body !== undefined
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error((data as { error?: string }).error ?? "Request failed");
  return data as T;
}
const asset = (key?: string) => (key ? "/api/lab/artifacts/" + key : undefined);
const defaultPrompt = taskInfo.stitch.prompt;
const labels: Record<
  keyof RewardSpec,
  { name: string; description: string; min: number; max: number; step: number }
> = {
  completion: {
    name: "Task completion",
    description: "Reward independently verified success.",
    min: 1,
    max: 100,
    step: 1,
  },
  milestones: {
    name: "Needle-transfer milestones",
    description: "Reward entry, exit, catch, and clearance once each.",
    min: 0,
    max: 10,
    step: 0.1,
  },
  closure: {
    name: "Closure progress",
    description: "Reward net gap reduction after a valid transfer.",
    min: 0,
    max: 10,
    step: 0.1,
  },
  placement: {
    name: "Placement progress",
    description:
      "Reward net approach to the tray after clearing the cavity rim.",
    min: 0,
    max: 10,
    step: 0.1,
  },
  smoothness: {
    name: "Action smoothness",
    description: "Penalize changes between consecutive actions.",
    min: 0,
    max: 1,
    step: 0.01,
  },
  failure: {
    name: "Failure penalty",
    description: "Penalize lost needles, invalid passes, and timeouts.",
    min: 0,
    max: 100,
    step: 1,
  },
};
function currentJob(jobs: Job[], kind: JobKind) {
  const trained = jobs.find(
    (j) => j.kind === "train" && j.status === "completed",
  );
  const baseline = jobs.find(
    (j) => j.kind === "baseline" && j.status === "completed",
  );
  return jobs.find(
    (j) =>
      j.kind === kind &&
      (j.status === "completed" || j.status === "running") &&
      (kind !== "candidate" ||
        (j.data.checkpoint === trained?.result?.checkpoint &&
          j.data.episodes === baseline?.data.episodes &&
          (!j.data.baseline_job_id ||
            j.data.baseline_job_id === baseline?.id))),
  );
}
function runsFor(detail: ExperimentDetail, kind: "baseline" | "candidate") {
  return detail.runs.filter(
    (r) => r.job_id === currentJob(detail.jobs, kind)?.id,
  );
}
const score = (runs: Run[]) =>
  runs.length
    ? `${runs.filter((r) => r.info.success).length}/${runs.length}`
    : "—";

function Curve({
  telemetry,
  time,
  lifting = false,
}: {
  telemetry: Telemetry | null;
  time: number;
  lifting?: boolean;
}) {
  const frames = telemetry?.frames;
  if (!frames?.length)
    return (
      <div className="empty-trace">
        {lifting
          ? "Measured height and placement error appear after a rollout."
          : "Measured gap and tension appear after a rollout."}
      </div>
    );
  const primary = lifting ? "object_height_mm" : "gap_mm";
  const secondary = lifting ? "placement_error_mm" : "tension_n";
  const maxSecondary = lifting
    ? Math.max(...frames.map((f) => f.placement_error_mm ?? 0), 1)
    : 0.6;
  const maxGap = Math.max(...frames.map((f) => f[primary] ?? 0), 1),
    maxTime = frames.at(-1)!.t || 1;
  const line = (
    key: "gap_mm" | "tension_n" | "object_height_mm" | "placement_error_mm",
    max: number,
  ) =>
    frames
      .map(
        (f, i) =>
          `${i ? "L" : "M"}${30 + (f.t / maxTime) * 570},${110 - ((f[key] ?? 0) / max) * 85}`,
      )
      .join(" ");
  return (
    <svg
      className="trace"
      viewBox="0 0 630 150"
      role="img"
      aria-label={
        lifting
          ? "Measured object height and placement error over time"
          : "Measured wound gap and tension over time"
      }
    >
      <line x1="30" y1="110" x2="600" y2="110" stroke="var(--line)" />
      <path
        d={line(primary, maxGap)}
        fill="none"
        stroke="var(--green)"
        strokeWidth="2"
      />
      <path
        d={line(secondary, maxSecondary)}
        fill="none"
        stroke="var(--blue)"
        strokeWidth="2"
      />
      <line
        x1={30 + (Math.min(time, maxTime) / maxTime) * 570}
        y1="20"
        x2={30 + (Math.min(time, maxTime) / maxTime) * 570}
        y2="114"
        stroke="var(--muted)"
        strokeDasharray="3 3"
      />
      <text x="30" y="140">
        0 s
      </text>
      <text x="600" y="140" textAnchor="end">
        {maxTime.toFixed(1)} s
      </text>
      <text x="30" y="20">
        {lifting ? "Height" : "Gap"} · 0–{maxGap.toFixed(1)} mm
      </text>
      <text x="600" y="20" textAnchor="end">
        {lifting
          ? `Error · 0–${maxSecondary.toFixed(0)} mm`
          : "Tension · 0–0.6 N"}
      </text>
    </svg>
  );
}
function Inspector({
  scenario,
  baseline,
  candidate,
  compare = false,
}: {
  scenario: Scenario;
  baseline?: Run;
  candidate?: Run;
  compare?: boolean;
}) {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null),
    [time, setTime] = useState(0),
    [error, setError] = useState("");
  const lifting = scenario.task === "lifting";
  const first = useRef<HTMLVideoElement>(null),
    second = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let active = true;
    if (baseline?.telemetry)
      fetch(asset(baseline.telemetry)!)
        .then((r) => {
          if (!r.ok) throw new Error("Telemetry unavailable");
          return r.json();
        })
        .then((d) => {
          if (active) setTelemetry(d as Telemetry);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [baseline?.telemetry]);
  const frame =
    telemetry?.frames[
      Math.min(Math.round(time / 0.05), (telemetry?.frames.length ?? 1) - 1)
    ];
  const sync = (value: number) => {
    setTime(value);
    for (const v of [first.current, second.current])
      if (v && Math.abs(v.currentTime - value) > 0.15)
        v.currentTime = Math.min(
          value,
          Number.isFinite(v.duration) ? v.duration : value,
        );
  };
  function player(
    run: Run | undefined,
    label: string,
    ref: React.RefObject<HTMLVideoElement | null>,
  ) {
    return (
      <div className="video-panel">
        <div className="video-label">
          <span>{label}</span>
          <span>
            {run
              ? `${run.info.success ? "Success" : run.info.termination} · seed ${run.seed}`
              : "Not evaluated"}
          </span>
        </div>
        {run?.video ? (
          <video
            muted
            ref={ref}
            src={asset(run.video)}
            poster={asset(run.thumbnail)}
            controls={!compare}
            preload="metadata"
            playsInline
            aria-label={`${label} simulation playback`}
            onError={() =>
              setError("Video unavailable. Inspect the recording artifact.")
            }
            onTimeUpdate={(e) => {
              if (ref === first) setTime(e.currentTarget.currentTime);
            }}
          />
        ) : (
          <div className="video-placeholder">
            <Image
              unoptimized
              width={640}
              height={480}
              src={asset(scenario.thumbnail)!}
              alt="Initial MuJoCo scene"
            />
            <span>Initial state · awaiting {label.toLowerCase()}</span>
          </div>
        )}
      </div>
    );
  }
  return (
    <section className={"inspection " + (compare ? "comparison-player" : "")}>
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            SCENARIO {scenario.id.replace("scene-", "")}
          </span>
          <h3>{scenario.name}</h3>
        </div>
        <span className="pill">MuJoCo</span>
      </div>
      <p className="rationale">{scenario.rationale}</p>
      <div className="players">
        {player(baseline, "Baseline", first)}
        {compare && player(candidate, "Candidate", second)}
      </div>
      {compare && (
        <div className="paired-controls">
          <button
            onClick={() => {
              for (const v of [first.current, second.current]) v?.pause();
              sync(0);
            }}
          >
            <RefreshCw size={13} /> Reset
          </button>
          <button
            onClick={() => {
              for (const v of [first.current, second.current])
                v?.play().catch(() => {});
            }}
          >
            <Play size={13} /> Play both
          </button>
          <button
            onClick={() => {
              for (const v of [first.current, second.current]) v?.pause();
            }}
          >
            <Square size={13} /> Pause
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="telemetry-heading">
        <span>{frame?.phase ?? "Initial state"}</span>
        <span>{time.toFixed(2)} s</span>
      </div>
      {telemetry && (
        <input
          className="scrubber"
          aria-label="Simulation time"
          type="range"
          min={0}
          max={telemetry.frames.at(-1)?.t ?? 0}
          step={0.05}
          value={time}
          onChange={(e) => sync(Number(e.target.value))}
        />
      )}
      <Curve telemetry={telemetry} time={time} lifting={lifting} />
      <div className="measurements">
        <div>
          <span>{lifting ? "Object height" : "Wound gap"}</span>
          <strong>
            {scenario.task === "lifting"
              ? (frame?.object_height_mm?.toFixed(2) ?? "—")
              : (frame?.gap_mm ?? scenario.gap_mm).toFixed(2)}{" "}
            <small>mm</small>
          </strong>
        </div>
        <div>
          <span>{lifting ? "Placement error" : "Thread tension"}</span>
          <strong>
            {scenario.task === "lifting"
              ? frame?.placement_error_mm !== undefined
                ? frame.placement_error_mm.toFixed(2)
                : "—"
              : (frame?.tension_n ?? 0).toFixed(3)}{" "}
            <small>{lifting ? "mm" : "N"}</small>
          </strong>
        </div>
      </div>
      {scenario.task === "lifting" ? (
        <dl className="parameters">
          <div>
            <dt>Object position (XY)</dt>
            <dd>
              {scenario.object_x_mm}, {scenario.object_y_mm} mm
            </dd>
          </div>
          <div>
            <dt>Object orientation</dt>
            <dd>{scenario.object_yaw_deg}°</dd>
          </div>
          <div>
            <dt>Tray position (XY)</dt>
            <dd>
              {scenario.tray_x_mm}, {scenario.tray_y_mm} mm
            </dd>
          </div>
          <div>
            <dt>Initial gripper position</dt>
            <dd>Seeded · ±25 mm</dd>
          </div>
          {baseline && (
            <>
              <div>
                <dt>Rim cleared</dt>
                <dd>{baseline.info.cleared ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt>Drops / flagged contacts</dt>
                <dd>
                  {baseline.info.drops} / {baseline.info.unwanted_collisions}
                </dd>
              </div>
            </>
          )}
        </dl>
      ) : (
        <dl className="parameters">
          <div>
            <dt>Initial gap</dt>
            <dd>{scenario.gap_mm.toFixed(1)} mm</dd>
          </div>
          <div>
            <dt>Spring stiffness</dt>
            <dd>{scenario.stiffness} N/m</dd>
          </div>
          <div>
            <dt>Needle radius</dt>
            <dd>{scenario.radius_mm} mm</dd>
          </div>
          <div>
            <dt>Starting offset</dt>
            <dd>
              {scenario.offset_x_mm}, {scenario.offset_y_mm},{" "}
              {scenario.offset_z_mm} mm
            </dd>
          </div>
        </dl>
      )}
      {baseline && (
        <div className="artifact-links">
          <a href={asset(baseline.manifest)} target="_blank" rel="noreferrer">
            <ArrowDownToLine size={12} /> Manifest
          </a>
          <a href={asset(baseline.telemetry)} target="_blank" rel="noreferrer">
            Telemetry
          </a>
          <a href={asset(baseline.video)} target="_blank" rel="noreferrer">
            Recording
          </a>
        </div>
      )}
      <p className="scope-note">
        <CircleHelp size={12} />{" "}
        {lifting
          ? "Rigid object · assisted grasp · fixed-orientation gantry"
          : "Rigid tissue surrogate · assisted grasp · no knot"}
      </p>
    </section>
  );
}

export default function Workspace() {
  const [ready, setReady] = useState(false);
  const [experiments, setExperiments] = useState<Experiment[]>([]),
    [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<ExperimentDetail | null>(null);
  const [sceneId, setSceneId] = useState("scene-01"),
    [tab, setTab] = useState("environments"),
    [creating, setCreating] = useState(false);
  const [task, setTask] = useState<TaskKind>("stitch");
  const [prompt, setPrompt] = useState(defaultPrompt),
    [source, setSource] = useState("astra"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [workers, setWorkers] = useState<
      { astra: boolean; rl: boolean; model: string }[]
    >([]),
    [episodes, setEpisodes] = useState(3),
    [steps, setSteps] = useState(8192);
  const [reward, setReward] = useState<RewardSpec | null>(null),
    [feedback, setFeedback] = useState("");
  const selection = useRef("");
  const refresh = useCallback(async () => {
    try {
      const [list, health] = await Promise.all([
        api<Experiment[]>("/experiments"),
        api<{ workers: { astra: boolean; rl: boolean; model: string }[] }>(
          "/health",
        ),
      ]);
      setExperiments(list);
      setWorkers(health.workers);
      setReady(true);
      const requested = new URLSearchParams(window.location.search).get(
        "experiment",
      );
      const id =
        selection.current ||
        (list.some((e) => e.id === requested) ? requested : list[0]?.id);
      if (id) {
        const d = await api<ExperimentDetail>("/experiments/" + id);
        if (!selection.current || selection.current === id) {
          selection.current = id;
          setSelected(id);
          setDetail(d);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
    }
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 2500);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);
  async function choose(id: string) {
    selection.current = id;
    window.history.replaceState(
      null,
      "",
      `/?experiment=${encodeURIComponent(id)}`,
    );
    setSelected(id);
    setSceneId("scene-01");
    setReward(null);
    setCreating(false);
    setTab("environments");
    setDetail(null);
    await refresh();
  }
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }
  function create(parent = false) {
    void action(async () => {
      const result = await api<{ experiment: Experiment }>("/experiments", {
        task: parent ? (detail!.experiment.task ?? "stitch") : task,
        prompt: parent ? detail!.experiment.prompt : prompt,
        source: parent ? "astra" : source,
        parent_id: parent ? selected : undefined,
        feedback,
      });
      await choose(result.experiment.id);
    });
  }
  const jobs = detail?.jobs ?? [],
    active = jobs.find((j) => j.status === "queued" || j.status === "running"),
    plan = detail?.experiment.plan;
  const kind = detail?.experiment.task ?? "stitch";
  const lifting = kind === "lifting";
  const rewardLabels = lifting
    ? {
        ...labels,
        milestones: {
          ...labels.milestones,
          name: "Grasp and clearance milestones",
          description:
            "Reward grasp, rim clearance, and release in the tray once each.",
        },
        failure: {
          ...labels.failure,
          description: "Penalize out-of-bounds failures and timeouts.",
        },
      }
    : labels;
  const baseline = detail ? runsFor(detail, "baseline") : [],
    candidate = detail ? runsFor(detail, "candidate") : [],
    baseJob = currentJob(jobs, "baseline"),
    candidateJob = currentJob(jobs, "candidate"),
    trained = jobs.find((j) => j.kind === "train" && j.status === "completed");
  const scenario =
      plan?.scenarios.find((s) => s.id === sceneId) ?? plan?.scenarios[0],
    base = baseline.find(
      (r) => r.scenario_id === scenario?.id && r.episode === 0,
    ),
    cand = candidate.find(
      (r) => r.scenario_id === scenario?.id && r.episode === 0,
    );
  const blocked = busy || Boolean(active) || !workers.length,
    weights = reward ?? plan?.reward;
  const launch = (kind: JobKind, resume = false) =>
    void action(async () => {
      await api("/experiments/" + selected + "/jobs", {
        kind,
        episodes,
        steps,
        seed: 7,
        reward: weights,
        resume,
      });
    });
  return (
    <div className="lab-shell">
      <aside className="sidebar">
        <Link className="wordmark" href="/">
          soren<span>●</span>
        </Link>
        <div className="workspace-label">
          <FlaskConical size={16} />
          Policy lab<span className="tiny-label">BETA</span>
        </div>
        <button
          className="new-button"
          disabled={!ready}
          onClick={() => setCreating(true)}
        >
          <Plus size={16} /> New experiment
        </button>
        <div className="sidebar-caption">
          EXPERIMENTS <span>{experiments.length}</span>
        </div>
        <nav aria-label="Experiments">
          {experiments.map((e) => (
            <button
              key={e.id}
              className={
                "experiment-link " +
                (selected === e.id && !creating ? "selected" : "")
              }
              onClick={() => void choose(e.id)}
            >
              <Box size={15} />
              <span>{e.title}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection">
            <span className={workers.length ? "dot online" : "dot"} />
            {workers.length ? "Simulation worker online" : "Waiting for worker"}
          </div>
          <span>MuJoCo · CPU execution</span>
          <a href="/api/lab/health" target="_blank" rel="noreferrer">
            Connection details <ArrowRight size={12} />
          </a>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div>
            <Layers size={16} />
            <span>Experiments</span>
            <ChevronRight size={14} />
            <span>
              {creating ? "New experiment" : (plan?.title ?? "Workspace")}
            </span>
          </div>
          <span className="runtime-label">
            <span className="dot online" /> Local research workspace
          </span>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {creating || (ready && !experiments.length && !detail) ? (
          <section className="create-view">
            <div className="create-icon">
              <FlaskConical size={28} />
            </div>
            <span className="eyebrow">FROM INTENT TO EXPERIMENT</span>
            <h1>
              What should your policy
              <br />
              get better at?
            </h1>
            <p>
              Turn a task into 16 physical variations. Evaluate the baseline,
              <br className="desktop-break" /> learn from its failures, and
              train a candidate.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                create();
              }}
            >
              <label htmlFor="task-kind">Simulation task</label>
              <select
                id="task-kind"
                value={task}
                onChange={(e) => {
                  const next = e.target.value as TaskKind;
                  if (prompt === taskInfo[task].prompt)
                    setPrompt(taskInfo[next].prompt);
                  setTask(next);
                }}
              >
                <option value="stitch">
                  Suturing · needle transfer & closure
                </option>
                <option value="lifting">
                  Object lifting · grasp, lift & place
                </option>
              </select>
              <label htmlFor="task">Improvement task</label>
              <textarea
                id="task"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                minLength={10}
                maxLength={4000}
                rows={4}
                required
              />
              <div className="create-options">
                <label>
                  Planner
                  <select
                    aria-label="Planner"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  >
                    <option value="astra">
                      Astra · natural-language planning
                    </option>
                    <option value="template">{taskInfo[task].sweep}</option>
                  </select>
                </label>
                <span className="policy-tag">
                  <Box size={14} /> {taskInfo[task].checkpoint}
                </span>
              </div>
              <button
                className="primary generate-button"
                disabled={busy || !workers.length}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Sparkles size={16} />
                )}
                Generate 16 scenarios
                <ArrowRight size={16} />
              </button>
            </form>
            <p className="supported">
              {taskInfo[task].description}
              <br />
              Simulation assumptions and reward terms stay visible in every
              experiment.
            </p>
          </section>
        ) : (
          detail && (
            <>
              <section className="experiment-header">
                <div>
                  <div className="eyebrow">
                    {taskInfo[kind].heading.toUpperCase()}
                  </div>
                  <h1>{plan?.title ?? "Designing your experiment"}</h1>
                  <p>{plan?.hypothesis ?? detail.experiment.prompt}</p>
                </div>
                <span className="pill">
                  <Sparkles size={12} />
                  {plan?.provider ??
                    (detail.experiment.source === "astra"
                      ? "Astra"
                      : "Parameter sweep")}
                </span>
              </section>
              <div className="workflow-strip">
                {[
                  "Generate",
                  "Evaluate baseline",
                  "Train candidate",
                  "Compare",
                ].map((label, i) => {
                  const done =
                    i === 0
                      ? Boolean(plan)
                      : i === 1
                        ? baseJob?.status === "completed"
                        : i === 2
                          ? Boolean(trained)
                          : candidateJob?.status === "completed";
                  return (
                    <div key={label} className={done ? "done" : ""}>
                      <span>{done ? <Check size={12} /> : i + 1}</span>
                      {label}
                      {i < 3 && <ChevronRight size={13} />}
                    </div>
                  );
                })}
              </div>
              {active && (
                <div className="job-progress" role="status">
                  <div>
                    <LoaderCircle size={15} className="spin" />
                    <span>{active.message || "Queued for execution"}</span>
                    <strong>{Math.round(active.progress * 100)}%</strong>
                    <button
                      onClick={() =>
                        void action(async () => {
                          await api("/jobs/" + active.id + "/cancel", {});
                        })
                      }
                    >
                      <Square size={12} /> Cancel
                    </button>
                  </div>
                  <progress value={active.progress} max={1} />
                </div>
              )}
              {jobs[0]?.status === "failed" && (
                <div className="error-banner" role="alert">
                  {jobs[0].error}
                  <button onClick={() => setCreating(true)}>
                    New experiment
                  </button>
                </div>
              )}
              <div
                className="tabs"
                role="tablist"
                aria-label="Experiment views"
              >
                {[
                  ["environments", "Environments"],
                  ["training", "Rewards & training"],
                  ["compare", "Compare"],
                  ["activity", "Activity"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={tab === key}
                    onClick={() => setTab(key)}
                  >
                    {label}
                    {key === "environments" && (
                      <span>{plan?.scenarios.length ?? 0}</span>
                    )}
                  </button>
                ))}
              </div>
              {!plan ? (
                <div className="generation-empty">
                  <LoaderCircle size={26} className={active ? "spin" : ""} />
                  <h2>
                    {active
                      ? "Building executable scenarios"
                      : "Scenario generation stopped"}
                  </h2>
                  <p>
                    {active
                      ? "Each configuration is validated and rendered in MuJoCo before it appears here."
                      : "Inspect the activity log for details."}
                  </p>
                </div>
              ) : (
                <>
                  {tab === "environments" && (
                    <div className="environment-layout">
                      <section className="gallery-section">
                        <div className="gallery-heading">
                          <div>
                            <h2>Environment suite</h2>
                            <span>
                              16 scenarios · {baseline.length} measured episodes
                            </span>
                          </div>
                          <div className="run-controls">
                            <label className="sr-only" htmlFor="episodes">
                              Episodes per scenario
                            </label>
                            <select
                              id="episodes"
                              value={episodes}
                              onChange={(e) =>
                                setEpisodes(Number(e.target.value))
                              }
                              disabled={blocked}
                            >
                              {[1, 3, 5, 10].map((n) => (
                                <option key={n} value={n}>
                                  {n} episode{n > 1 ? "s" : ""} / scene
                                </option>
                              ))}
                            </select>
                            <button
                              className="primary"
                              onClick={() => launch("baseline")}
                              disabled={blocked}
                            >
                              <Play size={13} />
                              {baseline.length
                                ? "Rerun baseline"
                                : "Evaluate baseline"}
                            </button>
                          </div>
                        </div>
                        {baseline.length > 0 && (
                          <div className="suite-summary">
                            <span>
                              <span className="dot online" />
                              <strong>{score(baseline)}</strong> successful
                            </span>
                            <span>
                              {
                                baseline.filter((r) =>
                                  lifting ? r.info.cleared : r.info.caught,
                                ).length
                              }{" "}
                              {lifting ? "rim clearances" : "needle catches"}
                            </span>
                            {lifting && (
                              <span>
                                {baseline.reduce(
                                  (sum, r) => sum + (r.info.drops ?? 0),
                                  0,
                                )}{" "}
                                drops
                              </span>
                            )}
                            <span>
                              {baseline.reduce(
                                (a, r) => a + r.info.unwanted_collisions,
                                0,
                              )}{" "}
                              flagged contacts
                            </span>
                          </div>
                        )}
                        <div className="scenario-grid">
                          {plan.scenarios.map((s, i) => {
                            const runs = baseline.filter(
                                (r) => r.scenario_id === s.id,
                              ),
                              first = runs.find((r) => r.episode === 0),
                              failed = runs.some((r) => !r.info.success);
                            return (
                              <button
                                key={s.id}
                                className={
                                  "scenario-card " +
                                  (scenario?.id === s.id ? "is-selected" : "")
                                }
                                onClick={() => setSceneId(s.id)}
                                aria-pressed={scenario?.id === s.id}
                                aria-label={`Scenario ${i + 1}: ${s.name}`}
                              >
                                <div className="scenario-image">
                                  <Image
                                    unoptimized
                                    width={640}
                                    height={480}
                                    src={asset(
                                      first?.thumbnail ?? s.thumbnail,
                                    )!}
                                    alt={`MuJoCo rendering: ${s.name}`}
                                    loading="lazy"
                                  />
                                  <span className="scene-number">
                                    {String(i + 1).padStart(2, "0")}
                                  </span>
                                  <span
                                    className={
                                      "scene-status " +
                                      (runs.length
                                        ? failed
                                          ? "failure"
                                          : "success"
                                        : "")
                                    }
                                  >
                                    {runs.length ? (
                                      <>
                                        <span className="dot" />
                                        {score(runs)}
                                      </>
                                    ) : (
                                      "Ready"
                                    )}
                                  </span>
                                </div>
                                <div className="scenario-caption">
                                  <strong>{s.name}</strong>
                                  <span>
                                    {s.task === "lifting"
                                      ? `Object ${s.object_x_mm}, ${s.object_y_mm} mm · tray ${s.tray_x_mm} mm`
                                      : `${s.gap_mm.toFixed(1)} mm gap · ${s.stiffness} N/m`}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                        <details className="assumptions">
                          <summary>Model scope & assumptions</summary>
                          <ul>
                            {plan.assumptions.map((a, i) => (
                              <li key={i}>{a}</li>
                            ))}
                          </ul>
                          <p>
                            Development evaluations. Physical calibration and
                            clinical validation are not established.
                          </p>
                        </details>
                      </section>
                      {scenario && (
                        <Inspector
                          key={`${scenario.id}-${base?.id ?? "initial"}`}
                          scenario={scenario}
                          baseline={base}
                        />
                      )}
                    </div>
                  )}
                  {tab === "training" && (
                    <div className="training-layout">
                      <section className="panel reward-panel">
                        <span className="eyebrow">ASTRA REWARD PROPOSAL</span>
                        <h2>Shape the learning signal</h2>
                        <p>
                          Weights apply to a new training run. Task success and
                          failure criteria remain fixed.
                        </p>
                        {weights &&
                          Object.entries(rewardLabels)
                            .filter(([key]) => key in weights)
                            .map(([key, label]) => (
                              <label className="reward-row" key={key}>
                                <span>
                                  <strong>{label.name}</strong>
                                  <span>{label.description}</span>
                                </span>
                                <input
                                  aria-label={label.name}
                                  type="number"
                                  min={label.min}
                                  max={label.max}
                                  step={label.step}
                                  value={weights[key as keyof RewardSpec]}
                                  disabled={blocked}
                                  onChange={(e) =>
                                    setReward({
                                      ...weights,
                                      [key]: Number(e.target.value),
                                    })
                                  }
                                />
                              </label>
                            ))}
                        <div className="fixed-criteria">
                          <Check size={15} />
                          <div>
                            <strong>Independent success criteria</strong>
                            <p>
                              {lifting
                                ? "Clear the cavity rim, release with an open gripper in the tray, and remain settled for 0.75 seconds. Drops and wall contacts are reported separately."
                                : "Valid pass, receiving catch, donor release, full clearance, and gap below 0.7 mm for 0.75 seconds with low needle velocity."}
                            </p>
                          </div>
                        </div>
                      </section>
                      <section className="panel train-panel">
                        <span className="eyebrow">POLICY OPTIMIZATION</span>
                        <h2>Train a candidate</h2>
                        <dl className="parameters">
                          <div>
                            <dt>Algorithm</dt>
                            <dd>PPO</dd>
                          </div>
                          <div>
                            <dt>Starting policy</dt>
                            <dd>{taskInfo[kind].checkpoint}</dd>
                          </div>
                          <div>
                            <dt>Network</dt>
                            <dd>
                              {lifting
                                ? "32 → 64 → 64 → 4"
                                : "38 → 64 → 64 → 7"}
                            </dd>
                          </div>
                          <div>
                            <dt>Distribution</dt>
                            <dd>16 families + bounded variation</dd>
                          </div>
                          <div>
                            <dt>Training seed</dt>
                            <dd>7</dd>
                          </div>
                        </dl>
                        <label className="field-label">
                          Transition budget
                          <select
                            value={steps}
                            onChange={(e) => setSteps(Number(e.target.value))}
                            disabled={blocked}
                          >
                            <option value={1024}>1,024 · smoke run</option>
                            <option value={8192}>
                              8,192 · short experiment
                            </option>
                            <option value={32768}>
                              32,768 · extended experiment
                            </option>
                            <option value={131072}>
                              131,072 · longer training
                            </option>
                          </select>
                        </label>
                        <button
                          className="primary full-width"
                          disabled={blocked || baseJob?.status !== "completed"}
                          onClick={() => launch("train")}
                        >
                          <Play size={14} /> Start RL training
                        </button>
                        {trained && (
                          <button
                            className="full-width resume-button"
                            disabled={blocked}
                            onClick={() => launch("train", true)}
                          >
                            <RefreshCw size={14} /> Continue from saved
                            candidate
                          </button>
                        )}
                        {baseJob?.status !== "completed" && (
                          <p className="muted">
                            Complete baseline evaluation to enable training.
                          </p>
                        )}
                        {trained && (
                          <div className="training-result">
                            <Check size={17} />
                            <div>
                              <strong>Candidate checkpoint saved</strong>
                              <p>
                                {String(trained.result?.steps)} transitions ·
                                baseline import verified
                              </p>
                              <a
                                href={asset(String(trained.result?.report))}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Training report <ArrowDownToLine size={12} />
                              </a>
                              {typeof trained.result?.checkpoint ===
                                "string" && (
                                <p>
                                  <a
                                    href={asset(
                                      String(trained.result.checkpoint),
                                    )}
                                    download="candidate.zip"
                                  >
                                    Download checkpoint{" "}
                                    <ArrowDownToLine size={12} />
                                  </a>
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                        <p className="scope-note">
                          Optimization may improve or regress performance.
                          Evaluate the candidate before drawing conclusions.
                        </p>
                      </section>
                    </div>
                  )}
                  {tab === "compare" && (
                    <section className="compare-section">
                      <div className="gallery-heading">
                        <div>
                          <h2>Baseline vs. candidate</h2>
                          <span>Same configurations and episode seeds</span>
                        </div>
                        <button
                          className="primary"
                          disabled={blocked || !trained}
                          onClick={() => launch("candidate")}
                        >
                          <Play size={14} /> Evaluate candidate
                        </button>
                      </div>
                      <div className="comparison-summary">
                        <div>
                          <span>Baseline successes</span>
                          <strong>{score(baseline)}</strong>
                        </div>
                        <div>
                          <span>Candidate successes</span>
                          <strong>{score(candidate)}</strong>
                        </div>
                        <div>
                          <span>Paired regressions</span>
                          <strong>
                            {candidate.length
                              ? candidate.filter(
                                  (c) =>
                                    !c.info.success &&
                                    baseline.some(
                                      (b) =>
                                        b.scenario_id === c.scenario_id &&
                                        b.seed === c.seed &&
                                        b.info.success,
                                    ),
                                ).length
                              : "—"}
                          </strong>
                        </div>
                      </div>
                      <div className="compare-layout">
                        <div>
                          <table className="scenario-table">
                            <thead>
                              <tr>
                                <th>Scenario</th>
                                <th>Baseline</th>
                                <th>Candidate</th>
                              </tr>
                            </thead>
                            <tbody>
                              {plan.scenarios.map((s, i) => (
                                <tr
                                  key={s.id}
                                  className={
                                    scenario?.id === s.id ? "selected" : ""
                                  }
                                >
                                  <td>
                                    <button onClick={() => setSceneId(s.id)}>
                                      {String(i + 1).padStart(2, "0")}{" "}
                                      <span>{s.name}</span>
                                    </button>
                                  </td>
                                  <td>
                                    {score(
                                      baseline.filter(
                                        (r) => r.scenario_id === s.id,
                                      ),
                                    )}
                                  </td>
                                  <td>
                                    {score(
                                      candidate.filter(
                                        (r) => r.scenario_id === s.id,
                                      ),
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {scenario && (
                          <Inspector
                            key={`compare-${scenario.id}-${base?.id}-${cand?.id}`}
                            scenario={scenario}
                            baseline={base}
                            candidate={cand}
                            compare
                          />
                        )}
                      </div>
                      <div className="refine-panel">
                        <Sparkles size={20} />
                        <div>
                          <h3>Turn failures into the next experiment</h3>
                          <p>
                            Astra receives measured development outcomes and
                            proposes a new scenario and reward plan.
                          </p>
                          <label className="sr-only" htmlFor="feedback">
                            Refinement guidance
                          </label>
                          <input
                            id="feedback"
                            placeholder={
                              lifting
                                ? "Optional guidance, e.g. focus on clearance near cavity walls"
                                : "Optional guidance, e.g. focus on closure oscillation"
                            }
                            value={feedback}
                            onChange={(e) => setFeedback(e.target.value)}
                          />
                        </div>
                        <button
                          disabled={blocked || !baseline.length}
                          onClick={() => create(true)}
                        >
                          Refine with Astra <ArrowRight size={14} />
                        </button>
                      </div>
                    </section>
                  )}
                  {tab === "activity" && (
                    <section className="activity-section">
                      <h2>Experiment history</h2>
                      <p>
                        Every attempt keeps its configuration, outcome, and
                        artifacts.
                      </p>
                      {jobs.map((j) => (
                        <div className="activity-row" key={j.id}>
                          <span className={"activity-dot " + j.status}>
                            {j.status === "completed" ? (
                              <Check size={14} />
                            ) : j.status === "running" ? (
                              <LoaderCircle size={14} className="spin" />
                            ) : (
                              <Box size={14} />
                            )}
                          </span>
                          <div>
                            <strong>
                              {
                                {
                                  generate: "Generate scenarios",
                                  refine: "Refine experiment",
                                  baseline: "Baseline evaluation",
                                  train: "PPO training",
                                  candidate: "Candidate evaluation",
                                }[j.kind]
                              }
                            </strong>
                            <p>{j.error ?? j.message}</p>
                            <span className="job-id">{j.id}</span>
                          </div>
                          <div className="activity-meta">
                            <span>{j.status}</span>
                            <time>
                              {new Date(j.created_at).toLocaleString()}
                            </time>
                            {Boolean(j.result?.report) && (
                              <a
                                href={asset(String(j.result!.report))}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open report <ArrowRight size={12} />
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </section>
                  )}
                </>
              )}
            </>
          )
        )}
        {!detail && (!ready || experiments.length > 0) && !creating && (
          <div className="generation-empty">
            <LoaderCircle size={24} className="spin" />
            <p>Loading experiment…</p>
          </div>
        )}
        <footer className="workspace-footer">
          <span>Evidence from simulation</span>
          <span>
            Measured trajectories · versioned rewards · reproducible seeds
          </span>
        </footer>
      </main>
    </div>
  );
}
