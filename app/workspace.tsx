"use client";
import ExperimentComposer, { StudyRecord } from "./experiment-composer";
import type { ExperimentSpecification } from "@/lib/experiment-spec";
import { SceneThumbnail, SimulationPlayer } from "./scenario-rendering";
import {
  ScenarioExplanation,
  ScenarioFingerprint,
} from "./scenario-explanation";
import { scenarioInsights } from "@/lib/scenario-insights";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpRight,
  Command,
  Menu,
  SlidersHorizontal,
  ArrowRight,
  Box,
  Check,
  ChevronRight,
  CircleHelp,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import "./workspace.css";
import {
  PolicyContract,
  ResearchTraining,
  RewardBreakdown,
  RewardEquation,
} from "./research-workspace";
import { rewardTerms, sameWeights, validWeights } from "@/lib/research";
import { taskInfo } from "@/lib/tasks";
import type {
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

function meanReward(runs: Run[]) {
  return runs.length
    ? (
        runs.reduce((sum, run) => sum + run.reward_total, 0) / runs.length
      ).toFixed(2)
    : "—";
}
function ScenarioParameters({ scenario }: { scenario: Scenario }) {
  const entries =
    scenario.task === "lifting"
      ? [
          [
            "Object position (XY)",
            `${scenario.object_x_mm}, ${scenario.object_y_mm} mm`,
          ],
          ["Object orientation", `${scenario.object_yaw_deg}°`],
          [
            "Tray position (XY)",
            `${scenario.tray_x_mm}, ${scenario.tray_y_mm} mm`,
          ],
          ["Initial gripper variation", "±25 mm"],
        ]
      : [
          ["Initial wound gap", `${scenario.gap_mm.toFixed(1)} mm`],
          ["Spring stiffness", `${scenario.stiffness} N/m`],
          ["Needle radius", `${scenario.radius_mm} mm`],
          [
            "Starting offset (XYZ)",
            `${scenario.offset_x_mm}, ${scenario.offset_y_mm}, ${scenario.offset_z_mm} mm`,
          ],
        ];
  return (
    <dl className="parameters">
      {entries.map(([name, value]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

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
  plan,
}: {
  plan: import("@/lib/types").Plan;
  scenario: Scenario;
  baseline?: Run;
  candidate?: Run;
  compare?: boolean;
}) {
  const [telemetryRecord, setTelemetryRecord] = useState<{
      key: string;
      data: Telemetry;
    } | null>(null),
    [time, setTime] = useState(0),
    [error, setError] = useState("");
  const lifting = scenario.task === "lifting";
  const [telemetrySource, setTelemetrySource] = useState<
    "baseline" | "candidate"
  >("baseline");
  const inspectedRun =
    telemetrySource === "candidate" && compare ? candidate : baseline;
  const telemetryKey = inspectedRun?.telemetry;
  const telemetry =
    telemetryRecord?.key === telemetryKey
      ? (telemetryRecord?.data ?? null)
      : null;
  const first = useRef<HTMLVideoElement>(null),
    second = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let active = true;
    if (telemetryKey)
      fetch(asset(telemetryKey)!)
        .then((r) => {
          if (!r.ok) throw new Error("Telemetry unavailable");
          return r.json();
        })
        .then((d) => {
          if (active)
            setTelemetryRecord({ key: telemetryKey, data: d as Telemetry });
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [telemetryKey]);
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
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const onDuration = useCallback((duration: number) => {
    if (Number.isFinite(duration))
      setRecordingDuration((previous) => Math.max(previous, duration));
  }, []);
  const duration = Math.max(
    recordingDuration,
    telemetry?.frames.at(-1)?.t ?? 0,
  );
  const baselinePlayable = !!(baseline?.motion || baseline?.video);
  const candidatePlayable = !!(candidate?.motion || candidate?.video);
  const playbackReady =
    baselinePlayable && (!compare || candidatePlayable) && duration > 0;
  const clock = useRef(time);
  useEffect(() => {
    clock.current = time;
  }, [time]);
  useEffect(() => {
    if (!playing) return;
    let id = 0,
      previous = performance.now();
    const tick = (now: number) => {
      const next = Math.min(
        duration,
        clock.current + ((now - previous) / 1000) * speed,
      );
      previous = now;
      clock.current = next;
      setTime(next);
      if (next >= duration) setPlaying(false);
      else id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, speed, duration]);
  return (
    <section className={"inspection " + (compare ? "comparison-player" : "")}>
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            SCENARIO {scenario.id.replace("scene-", "")}
          </span>
          <h3>{scenarioInsights(scenario, plan.scenarios).title}</h3>
        </div>
        <span className="pill">MuJoCo</span>
      </div>
      <ScenarioExplanation scenario={scenario} plan={plan} />
      <div className="players">
        <SimulationPlayer
          scenario={scenario}
          suite={plan.scenarios}
          run={baseline}
          label="Baseline"
          time={time}
          playing={playing}
          speed={speed}
          videoRef={first}
          onTime={setTime}
          onDuration={onDuration}
          onPlayingChange={setPlaying}
        />
        {compare && (
          <SimulationPlayer
            scenario={scenario}
            suite={plan.scenarios}
            run={candidate}
            label="Candidate"
            time={time}
            playing={playing}
            speed={speed}
            videoRef={second}
            onTime={setTime}
            onDuration={onDuration}
            onPlayingChange={setPlaying}
          />
        )}
      </div>
      {(baseline || candidate) && (
        <div className="paired-controls">
          <button
            onClick={() => {
              for (const v of [first.current, second.current]) v?.pause();
              setPlaying(false);
              sync(0);
            }}
          >
            <RefreshCw size={13} /> Reset
          </button>
          <button
            disabled={!playbackReady}
            onClick={() => {
              if (!playbackReady) return;
              if (time >= duration) sync(0);
              setPlaying(true);
            }}
          >
            <Play size={13} /> {compare ? "Play both" : "Play"}
          </button>
          <button
            onClick={() => {
              setPlaying(false);
              for (const v of [first.current, second.current]) v?.pause();
            }}
          >
            <Square size={13} /> Pause
          </button>
          <select
            aria-label="Playback speed"
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
          >
            {[0.25, 0.5, 0.75, 1, 2].map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
        </div>
      )}
      {compare && (!baselinePlayable || !candidatePlayable) && (
        <p className="rendering-note" role="status">
          Paired playback needs a recording from both policies for this
          scenario.{" "}
          {!baselinePlayable
            ? "Complete baseline evaluation first."
            : "Use Evaluate candidate to record the trained policy. If evaluation is running, this pair will be ready when its candidate recording finishes."}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {compare && (
        <div
          className="telemetry-source"
          role="group"
          aria-label="Telemetry source"
        >
          <span>Chart, measurements & reward</span>
          <button
            aria-pressed={telemetrySource === "baseline"}
            onClick={() => setTelemetrySource("baseline")}
          >
            Baseline telemetry
          </button>
          <button
            aria-pressed={telemetrySource === "candidate"}
            disabled={!candidate?.telemetry}
            onClick={() => setTelemetrySource("candidate")}
          >
            Candidate telemetry
          </button>
        </div>
      )}
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
          max={duration}
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
      <details className="workspace-details">
        <summary>Parameters, reward breakdown & downloads</summary>
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
            {inspectedRun && (
              <>
                <div>
                  <dt>Rim cleared</dt>
                  <dd>{inspectedRun.info.cleared ? "Yes" : "No"}</dd>
                </div>
                <div>
                  <dt>Drops / flagged contacts</dt>
                  <dd>
                    {inspectedRun.info.drops} /{" "}
                    {inspectedRun.info.unwanted_collisions}
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
        <RewardBreakdown
          terms={frame?.reward}
          task={scenario.task ?? "stitch"}
          label={
            telemetrySource === "candidate" && compare
              ? "Candidate"
              : "Baseline"
          }
        />
        {inspectedRun && (
          <div className="artifact-links">
            <a
              href={asset(inspectedRun.manifest)}
              target="_blank"
              rel="noreferrer"
            >
              <ArrowDownToLine size={12} /> Manifest
            </a>
            <a
              href={asset(inspectedRun.telemetry)}
              target="_blank"
              rel="noreferrer"
            >
              Telemetry
            </a>
            <a
              href={asset(inspectedRun.video)}
              target="_blank"
              rel="noreferrer"
            >
              Recording
            </a>
          </div>
        )}
      </details>
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [experiments, setExperiments] = useState<Experiment[]>([]),
    [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<ExperimentDetail | null>(null);
  const [sceneId, setSceneId] = useState("scene-01"),
    [tab, setTab] = useState("environments"),
    [creating, setCreating] = useState(true);
  const [draftSpec, setDraftSpec] = useState<
    ExperimentSpecification | undefined
  >();
  const [composerKey, setComposerKey] = useState(0);
  const loadedSpecification = useRef("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [workers, setWorkers] = useState<
      { astra: boolean; rl: boolean; model: string }[]
    >([]),
    [episodes, setEpisodes] = useState(3),
    [steps, setSteps] = useState(8192);
  const [seed, setSeed] = useState(7);
  const [reward, setReward] = useState<RewardSpec | null>(null),
    [feedback, setFeedback] = useState("");
  const selection = useRef("");
  const contentHeading = useRef<HTMLHeadingElement>(null);
  const [connected, setConnected] = useState(false);
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
      setConnected(true);
      const id = selection.current;
      if (id) {
        const d = await api<ExperimentDetail>("/experiments/" + id);
        if (selection.current === id) {
          selection.current = id;
          setSelected(id);
          setDetail(d);
          if (loadedSpecification.current !== id) {
            loadedSpecification.current = id;
            setEpisodes(d.experiment.specification?.episodes ?? 3);
            setSteps(d.experiment.specification?.steps ?? 8192);
            setSeed(d.experiment.specification?.seed ?? 7);
          }
        }
      }
    } catch (e) {
      setConnected(false);
      setReady(true);
      setError(e instanceof Error ? e.message : "Connection failed");
    }
  }, []);
  useEffect(() => {
    const restore = () => {
      const query = new URLSearchParams(window.location.search);
      const id = query.get("experiment") ?? "";
      const scene = query.get("scene");
      const view = query.get("view") ?? "environments";
      selection.current = id;
      setSelected(id);
      setCreating(!id);
      setDetail(null);
      setReward(null);
      setSceneId(scene ?? "scene-01");
      setTab(
        scene
          ? view === "render"
            ? "render"
            : "detail"
          : ["training", "compare", "activity"].includes(view)
            ? view
            : "environments",
      );
      void refresh();
    };
    const initial = setTimeout(restore, 0);
    const timer = setInterval(() => void refresh(), 2500);
    window.addEventListener("popstate", restore);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
      window.removeEventListener("popstate", restore);
    };
  }, [refresh]);
  function navigate(view: string, scene?: string) {
    const query = new URLSearchParams({ experiment: selection.current });
    if (scene) query.set("scene", scene);
    if (view !== "environments") query.set("view", view);
    window.history.pushState(null, "", `/?${query}`);
    if (scene) setSceneId(scene);
    setTab(view);
    requestAnimationFrame(() => contentHeading.current?.focus());
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function newExperiment() {
    setMenuOpen(false);
    selection.current = "";
    window.history.pushState(null, "", "/");
    setSelected("");
    setDetail(null);
    setReward(null);
    setCreating(true);
    setError("");
    setDraftSpec(undefined);
    setComposerKey((key) => key + 1);
  }
  async function choose(id: string) {
    setMenuOpen(false);
    selection.current = id;
    window.history.pushState(
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
    setError("");
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
  function refine() {
    if (detail?.experiment.specification) {
      const initial = detail.experiment.specification;
      newExperiment();
      setDraftSpec({
        ...initial,
        question: feedback.trim() || initial.question,
      });
      return;
    }
    void action(async () => {
      const result = await api<{ experiment: Experiment }>("/experiments", {
        task: detail!.experiment.task ?? "stitch",
        prompt: detail!.experiment.prompt,
        source: "astra",
        parent_id: selected,
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
  const rewardLabels = Object.fromEntries(
    rewardTerms(kind).map((term) => [term.key, term]),
  );
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
  const blocked = busy || Boolean(active) || !connected || !workers.length,
    weights = reward ?? trained?.data.reward ?? plan?.reward;
  const launch = (kind: JobKind, resume = false) =>
    void action(async () => {
      await api("/experiments/" + selected + "/jobs", {
        kind,
        episodes,
        steps,
        seed,
        reward: weights,
        resume,
      });
    });
  const inspecting = tab === "detail" || tab === "render";
  return (
    <div className={"lab-shell" + (menuOpen ? " menu-open" : "")}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <button
          className="wordmark"
          onClick={newExperiment}
          aria-label="Soren workspace"
        >
          <span className="brand-symbol">
            <Command size={21} strokeWidth={1.6} />
          </span>
          soren<span className="brand-edition">LAB</span>
        </button>
        <button
          className="mobile-menu"
          aria-expanded={menuOpen}
          aria-controls="workspace-navigation"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X size={18} /> : <Menu size={18} />} Menu
        </button>
        <div className="sidebar-navigation" id="workspace-navigation">
          <nav className="primary-nav" aria-label="Main navigation">
            <button className="new-button" onClick={newExperiment}>
              <Plus size={16} />
              New experiment
            </button>
          </nav>
          <div className="sidebar-caption">
            EXPERIMENTS{" "}
            <span>{experiments.length.toString().padStart(2, "0")}</span>
          </div>
          <nav className="experiment-nav" aria-label="Experiments">
            {experiments.map((e) => (
              <button
                key={e.id}
                className={
                  "experiment-link " +
                  (selected === e.id && !creating ? "selected" : "")
                }
                onClick={() => void choose(e.id)}
                title={e.title}
              >
                <Box size={15} />
                <span>{e.title}</span>
              </button>
            ))}
            {ready && !experiments.length && (
              <p className="nav-empty">Your experiments will appear here.</p>
            )}
          </nav>
          <div className="sidebar-bottom">
            <div className="connection">
              <span
                className={connected && workers.length ? "dot online" : "dot"}
              />
              {!ready
                ? "Connecting…"
                : connected && workers.length
                  ? "Simulation worker online"
                  : "Simulation worker offline"}
            </div>
          </div>
        </div>
      </aside>
      <main className="workspace" id="main-content">
        <header className="topbar">
          <div className="breadcrumbs">
            <button onClick={newExperiment}>Workspace</button>
            <ChevronRight size={13} />
            {!creating && detail ? (
              <>
                <button onClick={() => navigate("environments")}>
                  {detail.experiment.title}
                </button>
                {inspecting && (
                  <>
                    <ChevronRight size={13} />
                    <span>
                      {scenario && plan
                        ? scenarioInsights(scenario, plan.scenarios).title
                        : ""}
                    </span>
                  </>
                )}
              </>
            ) : (
              <span>New experiment</span>
            )}
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button
              onClick={() => void refresh()}
              aria-label="Retry connection"
            >
              <RefreshCw size={14} />
            </button>
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {creating ? (
          <section className="create-view">
            <ExperimentComposer
              key={composerKey}
              initial={draftSpec}
              available={connected && workers.length > 0}
              trainingAvailable={workers.some((worker) => worker.rl)}
              onCreated={choose}
            />
            {experiments.length > 0 && (
              <section className="recent-experiments">
                <div className="recent-heading">
                  <h2>Recent experiments</h2>
                </div>
                {experiments.slice(0, 3).map((e) => (
                  <button key={e.id} onClick={() => void choose(e.id)}>
                    <span className="recent-icon">
                      <Box size={17} />
                    </span>
                    <span className="recent-title">
                      <strong>{e.title}</strong>
                      <span>
                        {taskInfo[e.task ?? "stitch"].name} ·{" "}
                        {e.plan
                          ? `${e.plan.scenarios.length} environments`
                          : "Preparing suite"}
                      </span>
                    </span>
                    <time dateTime={new Date(e.created_at).toISOString()}>
                      {new Date(e.created_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </time>
                    <ArrowUpRight size={15} />
                  </button>
                ))}
              </section>
            )}
          </section>
        ) : (
          detail && (
            <>
              <section className="experiment-header">
                <div>
                  <div className="eyebrow">
                    {taskInfo[kind].heading.toUpperCase()}
                  </div>
                  <h1 ref={contentHeading} tabIndex={-1}>
                    {inspecting
                      ? scenario && plan
                        ? scenarioInsights(scenario, plan.scenarios).title
                        : ""
                      : (plan?.title ?? "Preparing your experiment")}
                  </h1>
                  <p>
                    {inspecting
                      ? scenario && plan
                        ? scenarioInsights(scenario, plan.scenarios).purpose
                        : ""
                      : (plan?.hypothesis ?? detail.experiment.prompt)}
                  </p>
                </div>
              </section>
              {detail.experiment.specification && (
                <StudyRecord specification={detail.experiment.specification} />
              )}
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
                  <button onClick={newExperiment}>New experiment</button>
                </div>
              )}
              {plan && (
                <nav className="tabs" aria-label="Experiment views">
                  {[
                    ["environments", "Environments"],
                    ["training", "Rewards & training"],
                    ["compare", "Compare"],
                    ["activity", "Activity"],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      aria-current={
                        tab === key || (inspecting && key === "environments")
                          ? "page"
                          : undefined
                      }
                      onClick={() => navigate(key)}
                    >
                      {label}
                      {key === "environments" && (
                        <span>{plan?.scenarios.length ?? 0}</span>
                      )}
                    </button>
                  ))}
                </nav>
              )}
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
                              {plan.scenarios.length} environments · Select one
                              to inspect parameters and rewards
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
                              {[1, 3, 5, 10, 20].map((n) => (
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
                        <p className="suite-condition-key">Each card shows why the case matters. Dots locate its parameters within the study ranges; the center tick marks the range midpoint.</p>
                        <div className="scenario-grid">
                          {plan.scenarios.map((s, i) => {
                            const runs = baseline.filter(
                                (r) => r.scenario_id === s.id,
                              ),
                              failed = runs.some((r) => !r.info.success);
                            return (
                              <button
                                key={s.id}
                                className="scenario-card"
                                onClick={() => navigate("detail", s.id)}
                                aria-label={`Scenario ${i + 1}: ${scenarioInsights(s, plan.scenarios).title}`}
                              >
                                <div className="scenario-image">
                                  <SceneThumbnail
                                    key={s.motion ?? s.id}
                                    scenario={s}
                                    fallback={asset(s.thumbnail)}
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
                                  <strong>
                                    {scenarioInsights(s, plan.scenarios).title}
                                    <ArrowUpRight size={13} />
                                  </strong>
                                  <span className="scenario-role">
                                    {scenarioInsights(s, plan.scenarios).role}
                                  </span>
                                  <p className="scenario-purpose" title={plan.model !== "deterministic" ? s.rationale : undefined}>
                                    {plan.model !== "deterministic" ? s.rationale : scenarioInsights(s, plan.scenarios).purpose}
                                  </p>
                                  <ScenarioFingerprint
                                    scenario={s}
                                    suite={plan.scenarios}
                                  />
                                </div>
                              </button>
                            );
                          })}
                        </div>
                        <details className="workspace-details">
                          <summary>Policy and simulation details</summary>
                          <PolicyContract task={kind} plan={plan} />
                        </details>
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
                    </div>
                  )}
                  {inspecting && scenario && (
                    <section className="environment-detail">
                      <div className="detail-toolbar">
                        <button
                          className="back-button"
                          onClick={() => navigate("environments")}
                        >
                          <ArrowLeft size={14} />
                          All environments
                        </button>
                        <div className="environment-pagination">
                          <button
                            aria-label="Previous environment"
                            disabled={plan.scenarios.indexOf(scenario) === 0}
                            onClick={() =>
                              navigate(
                                tab,
                                plan.scenarios[
                                  plan.scenarios.indexOf(scenario) - 1
                                ].id,
                              )
                            }
                          >
                            <ArrowLeft size={14} />
                          </button>
                          <span>
                            {String(
                              plan.scenarios.indexOf(scenario) + 1,
                            ).padStart(2, "0")}{" "}
                            / {plan.scenarios.length}
                          </span>
                          <button
                            aria-label="Next environment"
                            disabled={
                              plan.scenarios.indexOf(scenario) ===
                              plan.scenarios.length - 1
                            }
                            onClick={() =>
                              navigate(
                                tab,
                                plan.scenarios[
                                  plan.scenarios.indexOf(scenario) + 1
                                ].id,
                              )
                            }
                          >
                            <ArrowRight size={14} />
                          </button>
                        </div>
                      </div>
                      <div
                        className="detail-view-tabs"
                        role="group"
                        aria-label="Environment view"
                      >
                        <button
                          aria-pressed={tab === "detail"}
                          onClick={() => navigate("detail", scenario.id)}
                        >
                          <SlidersHorizontal size={14} />
                          Overview
                        </button>
                        <button
                          aria-pressed={tab === "render"}
                          onClick={() => navigate("render", scenario.id)}
                        >
                          <Play size={14} />
                          Simulation
                        </button>
                      </div>
                      {tab === "detail" ? (
                        <div className="detail-grid">
                          <div>
                            <div className="environment-preview">
                              <SceneThumbnail
                                key={scenario.motion ?? scenario.id}
                                scenario={scenario}
                                fallback={asset(scenario.thumbnail)}
                              />
                              <span className="preview-badge">
                                <span className="dot" />
                                INITIAL SIMULATION STATE
                              </span>
                              <button
                                className="preview-open"
                                onClick={() => navigate("render", scenario.id)}
                              >
                                <Play size={16} />
                                Open simulation
                                <ArrowUpRight size={15} />
                              </button>
                            </div>
                            <div className="detail-outcomes">
                              <div>
                                <span>Baseline successes</span>
                                <strong>
                                  {score(
                                    baseline.filter(
                                      (r) => r.scenario_id === scenario.id,
                                    ),
                                  )}
                                </strong>
                              </div>
                              <div>
                                <span>Mean reward</span>
                                <strong>
                                  {meanReward(
                                    baseline.filter(
                                      (r) => r.scenario_id === scenario.id,
                                    ),
                                  )}
                                </strong>
                              </div>
                              <div>
                                <span>Scenario seed</span>
                                <strong>{scenario.seed}</strong>
                              </div>
                            </div>
                          </div>
                          <div className="detail-specifications">
                            <ScenarioExplanation
                              scenario={scenario}
                              plan={plan}
                            />
                            <section className="detail-panel">
                              <div className="section-heading">
                                <h2>Environment parameters</h2>
                                <span className="eyebrow">CONFIGURATION</span>
                              </div>
                              <ScenarioParameters scenario={scenario} />
                            </section>
                            <section className="detail-panel">
                              <div className="section-heading">
                                <h2>Reward function</h2>
                                <button
                                  className="text-button"
                                  onClick={() => navigate("training")}
                                >
                                  Configure
                                  <ArrowUpRight size={12} />
                                </button>
                              </div>
                              <p>
                                Original experiment proposal · shared across
                                environments. Training runs retain their own
                                reward weights.
                              </p>
                              <dl className="parameters">
                                {Object.entries(plan.reward).map(
                                  ([key, value]) => (
                                    <div key={key}>
                                      <dt>
                                        {
                                          rewardLabels[key as keyof RewardSpec]
                                            .name
                                        }
                                      </dt>
                                      <dd>{value}</dd>
                                    </div>
                                  ),
                                )}
                              </dl>
                            </section>
                          </div>
                        </div>
                      ) : (
                        <div className="render-view">
                          {!base?.video && (
                            <div className="render-notice">
                              <div>
                                <strong>
                                  {active?.kind === "baseline"
                                    ? "Recording your baseline"
                                    : "Ready to run this environment"}
                                </strong>
                                <p>
                                  {active?.kind === "baseline"
                                    ? "The recording will appear when this environment finishes."
                                    : "Evaluate the 16-environment suite to unlock recordings and telemetry."}
                                </p>
                              </div>
                              <button
                                className="primary"
                                disabled={blocked}
                                onClick={() => launch("baseline")}
                              >
                                <Play size={14} />
                                Evaluate baseline
                              </button>
                            </div>
                          )}
                          <Inspector
                            plan={plan}
                            key={`${scenario.id}-${base?.id ?? "initial"}`}
                            scenario={scenario}
                            baseline={base}
                          />
                        </div>
                      )}
                    </section>
                  )}
                  {tab === "training" && weights && (
                    <ResearchTraining
                      key={selected}
                      task={kind}
                      plan={plan}
                      weights={weights}
                      onWeights={setReward}
                      steps={steps}
                      onSteps={setSteps}
                      seed={seed}
                      onSeed={setSeed}
                      jobs={jobs}
                      blocked={blocked}
                      rlAvailable={workers.some((worker) => worker.rl)}
                      baselineReady={baseJob?.status === "completed"}
                      onTrain={(resume) => launch("train", resume)}
                      onCompare={() => navigate("compare")}
                    />
                  )}
                  {tab === "compare" && (
                    <section className="compare-section">
                      <div className="gallery-heading">
                        <div>
                          <h2>Baseline vs. candidate</h2>
                          <span>
                            Same configurations, episode seeds, and episode
                            count · development evaluation
                          </span>
                        </div>
                        <button
                          className="primary"
                          disabled={
                            blocked ||
                            !trained ||
                            baseJob?.status !== "completed" ||
                            !weights ||
                            !validWeights(weights, kind)
                          }
                          onClick={() => launch("candidate")}
                        >
                          <Play size={14} /> Evaluate candidate
                        </button>
                      </div>
                      <div className="research-notice">
                        <strong>Evaluation protocol</strong>
                        <br />
                        Success is checked by the simulator independently of
                        reward weights. A paired regression means the baseline
                        succeeded and the candidate failed on the same scenario
                        and seed.
                        {baseJob?.status !== "completed" ||
                        candidateJob?.status !== "completed"
                          ? " Results remain provisional until both evaluations complete."
                          : " Both displayed evaluations are complete."}
                        {(candidateJob?.data.reward ?? weights) &&
                          baseJob?.data.reward &&
                          !sameWeights(
                            (candidateJob?.data.reward ?? weights)!,
                            baseJob.data.reward,
                          ) &&
                          " Candidate scoring weights differ from the baseline run. Raw reward totals are not directly comparable."}
                        {trained && (
                          <details className="research-details">
                            <summary>
                              Checkpoint and scoring provenance{" "}
                              <ChevronRight size={14} />
                            </summary>
                            <div className="research-detail-body">
                              <p>
                                Baseline job: {baseJob?.id ?? "Not evaluated"}
                                <br />
                                Candidate job:{" "}
                                {candidateJob?.id ?? "Not evaluated"}
                                <br />
                                Candidate checkpoint:{" "}
                                {String(
                                  trained.result?.checkpoint_sha256 ??
                                    "Not recorded",
                                )}
                              </p>
                              <p>
                                The candidate is the latest saved training run.
                                Playback shows episode 1 of each scenario;
                                success counts include every evaluated episode.
                              </p>
                              {baseJob?.data.reward && (
                                <>
                                  <strong>Baseline scoring weights</strong>
                                  <RewardEquation
                                    weights={baseJob.data.reward}
                                    task={kind}
                                  />
                                </>
                              )}
                              {candidateJob?.data.reward && (
                                <>
                                  <strong>Candidate scoring weights</strong>
                                  <RewardEquation
                                    weights={candidateJob.data.reward}
                                    task={kind}
                                  />
                                </>
                              )}
                            </div>
                          </details>
                        )}
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
                                      <span>
                                        {
                                          scenarioInsights(s, plan.scenarios)
                                            .title
                                        }
                                      </span>
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
                            plan={plan}
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
                          <h3>Refine experiment</h3>
                          <p>
                            {detail.experiment.specification
                              ? "Reuse this specification. Review the next question and operating envelope before launch."
                              : "Create a new experiment using these results and your feedback."}
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
                          disabled={
                            blocked ||
                            !baseline.length ||
                            (!detail.experiment.specification &&
                              !workers.some((w) => w.astra))
                          }
                          onClick={refine}
                        >
                          {detail.experiment.specification
                            ? "Create follow-up study"
                            : "Refine with Astra"}{" "}
                          <ArrowRight size={14} />
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
        {!detail && !creating && (
          <div className="generation-empty">
            <LoaderCircle size={24} className="spin" />
            <p>
              {error
                ? "Unable to load this experiment. Retry the connection or return to your workspace."
                : "Loading experiment…"}
            </p>
            {error && (
              <button onClick={newExperiment}>Back to workspace</button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
