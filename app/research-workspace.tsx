"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronRight,
  FlaskConical,
  GitBranch,
  Info,
  Play,
  RefreshCw,
  Sigma,
} from "lucide-react";
import { taskInfo } from "@/lib/tasks";
import {
  episodeHistory,
  numberLabel,
  optimizerHistory,
  rewardTerms,
  sameWeights,
  validWeights,
} from "@/lib/research";
import type { Job, Plan, RewardSpec, TaskKind } from "@/lib/types";
import "./research-workspace.css";

const artifact = (key: string) => "/api/lab/artifacts/" + key;

export function ResearchPrimer({ task }: { task: TaskKind }) {
  return (
    <div className="research-primer">
      <div className="research-primer-title">
        <FlaskConical size={16} />
        <strong>An experiment, from hypothesis to evidence</strong>
      </div>
      <div className="research-primer-grid">
        <div>
          <span>01 / DISTRIBUTION</span>
          <strong>Choose what varies</strong>
          <p>
            Choose how many executable scenarios to generate for{" "}
            {task === "lifting"
              ? "object lifting"
              : "needle transfer and closure"}
            . Measure the starting policy.
          </p>
        </div>
        <div>
          <span>02 / OBJECTIVE</span>
          <strong>Define the learning signal</strong>
          <p>
            Inspect reward terms and their math. Keep task success independently
            defined.
          </p>
        </div>
        <div>
          <span>03 / OPTIMIZATION</span>
          <strong>Post-train with PPO</strong>
          <p>
            Collect new simulator transitions and update the actor and critic.
            Inspect recorded learning curves.
          </p>
        </div>
        <div>
          <span>04 / EVIDENCE</span>
          <strong>Test the candidate</strong>
          <p>
            Compare matched episodes. Inspect regressions and use findings to
            refine the next experiment.
          </p>
        </div>
      </div>
      <p className="research-footnote">
        Starts from the included {taskInfo[task].name.toLowerCase()} checkpoint.
        Astra proposes scenarios and reward weights; PPO trains the control
        policy.
      </p>
    </div>
  );
}

export function PolicyContract({ task, plan }: { task: TaskKind; plan: Plan }) {
  const [stage, setStage] = useState(0);
  const lifting = task === "lifting";
  const stages = ["Observe", "Act", "Score", "Update"];
  const text = [
    {
      title: `${lifting ? 32 : 38} state observations`,
      math: "zₜ = (oₜ − μbaseline) / σbaseline",
      description: lifting
        ? "Object, gripper, and tray positions; relative offsets; linear and angular velocities; orientation; grasp and release state."
        : "Needle pose and velocity; alignment and entry/exit geometry; grasp and transfer state; wound gap, edge velocities, and thread tension.",
      note: "Numerical simulator state. Frozen baseline normalization travels with every checkpoint. Rendered camera views are for inspection; they are not policy inputs.",
    },
    {
      title: `${lifting ? 4 : 7} control actions at 20 Hz`,
      math: "aₜ ∼ πθ(· | zₜ)     →     oₜ₊₁ = simulator(oₜ, aₜ)",
      description: lifting
        ? "XYZ motion plus a close/open gripper command. Candidate evaluation converts the gripper output to a binary command."
        : "XYZ motion, needle rotation, donor grip, receiving grip, and thread tension. The actor outputs bounded commands.",
      note: `Actor: ${lifting ? 32 : 38} → 64 → 64 → ${lifting ? 4 : 7}, with tanh hidden layers. Physics runs at 500 Hz; one control transition spans 50 ms. Training samples actions; evaluation uses deterministic actions.`,
    },
    {
      title: "Five terms, one scalar reward",
      math: "rₜ = wₛSₜ + wₘMₜ + wₚΔΦₜ − w𝒹Dₜ − w𝒻Fₜ",
      description:
        "Completion and milestones credit achievements. Net progress shapes the path. Action changes and terminal failures subtract reward.",
      note: "Rewards guide optimization. Success and failure come from the fixed simulator checker. Changing weights cannot redefine a successful task.",
    },
    {
      title: "PPO updates the actor and critic",
      math: "J(θ) = Eτ∼πθ [ Σₜ γᵗ rₜ ]",
      description:
        "Collect 256 transitions, estimate advantages with a value network, then optimize in minibatches of 64 for up to four epochs. Repeat until the budget is reached.",
      note: "The actor starts from the behavior-cloned task checkpoint; the critic starts fresh. Resuming a candidate restores both networks and optimizer state at a new episode boundary.",
    },
  ];
  return (
    <section
      className="policy-contract"
      aria-label="Environment and policy specification"
    >
      <div className="research-section-heading">
        <div>
          <span className="eyebrow">THE LEARNING LOOP</span>
          <h2>What happens inside the simulation?</h2>
        </div>
        <span className="research-badge">MuJoCo · state-based control</span>
      </div>
      <div
        className="learning-loop"
        role="tablist"
        tabIndex={-1}
        aria-label="Learning loop"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? 3
                : (stage + (event.key === "ArrowRight" ? 1 : -1) + 4) % 4;
          setStage(next);
          (
            event.currentTarget.querySelectorAll("button")[
              next
            ] as HTMLButtonElement
          ).focus();
        }}
      >
        {stages.map((label, index) => (
          <button
            key={label}
            id={`loop-${index}`}
            role="tab"
            aria-selected={stage === index}
            aria-controls="loop-description"
            tabIndex={stage === index ? 0 : -1}
            onClick={() => setStage(index)}
          >
            <span>0{index + 1}</span>
            {label}
            {index < 3 && <ArrowRight size={15} />}
          </button>
        ))}
      </div>
      <div
        className="loop-description"
        role="tabpanel"
        id="loop-description"
        aria-labelledby={`loop-${stage}`}
      >
        <div>
          <h3>{text[stage].title}</h3>
          <p>{text[stage].description}</p>
        </div>
        <div>
          <div className="research-equation">{text[stage].math}</div>
          <p>{text[stage].note}</p>
        </div>
      </div>
      <details className="research-details">
        <summary>
          Training distribution & evaluation protocol <ChevronRight size={14} />
        </summary>
        <div className="distribution-grid">
          <div>
            <strong>Training / randomized</strong>
            <p>
              Sample from {plan.scenarios.length} scenario families with fresh
              seeds in [1.1 billion, 2 billion).{" "}
              {lifting
                ? "Object XY receives 1 mm Gaussian variation and yaw receives 0.01 rad variation, clipped to supported bounds."
                : "Gap receives 0.2 mm Gaussian variation and stiffness receives 1 N/m variation, clipped to supported bounds."}
            </p>
          </div>
          <div>
            <strong>Evaluation / paired</strong>
            <p>
              Preserve each scenario’s configuration. Episode seed = scenario
              seed + episode index. Baseline and candidate use identical seeds
              and episode counts, with deterministic policy actions.
            </p>
          </div>
          <div>
            <strong>Interpretation / development</strong>
            <p>
              Separate training seeds prevent exact seed reuse. These scenario
              families are also used to guide refinement; they are a development
              suite, not a held-out generalization test.
            </p>
          </div>
        </div>
      </details>
    </section>
  );
}

export function RewardEquation({
  weights,
  task,
}: {
  weights: RewardSpec;
  task: TaskKind;
}) {
  return (
    <div className="reward-equation-block">
      <span className="research-label">PER-TRANSITION REWARD · rₜ</span>
      <div
        className="research-equation reward-equation"
        aria-label="Weighted reward equation"
      >
        {rewardTerms(task).map(({ key, symbol }, index) => (
          <span
            key={key}
            className={index >= 3 ? "negative-term" : "positive-term"}
          >
            {index > 0 && <b>{index >= 3 ? " − " : " + "}</b>}
            {Number.isFinite(weights[key]) ? weights[key] : "—"}
            <i>{symbol}</i>
          </span>
        ))}
      </div>
      <p>
        Weights scale measured events; they do not sum to 100. Negative progress
        and penalties can make the total reward negative.
      </p>
    </div>
  );
}

function PPOExplanation() {
  return (
    <details className="research-details ppo-explanation">
      <summary>
        <span>
          <Sigma size={16} /> Inside the PPO update
        </span>
        <ChevronRight size={14} />
      </summary>
      <div className="ppo-math">
        <span className="research-label">
          CLIPPED ACTOR OBJECTIVE · MAXIMIZE
        </span>
        <div className="research-equation">
          Lclip = Eₜ[min(ρₜ Âₜ, clip(ρₜ, 1 − ε, 1 + ε) Âₜ)]
        </div>
        <p>
          <strong>ρₜ</strong> is the new/old action probability ratio.{" "}
          <strong>Âₜ</strong> estimates whether an action did better than the
          critic expected. Clipping limits the incentive for large probability
          changes; it is not a hard bound on policy movement.
        </p>
        <div className="ppo-explainer-grid">
          <div>
            <strong>01 / Estimate advantage</strong>
            <code>δₜ = rₜ + γV(oₜ₊₁) − V(oₜ)</code>
            <p>
              Generalized advantage estimation combines these prediction errors
              using γ = 0.99 and λ = 0.95. Advantages are normalized for actor
              updates.
            </p>
          </div>
          <div>
            <strong>02 / Fit the critic</strong>
            <code>LV = mean[(R̂ₜ − V(oₜ))²]</code>
            <p>
              The critic predicts future return. Its squared error contributes
              with weight 0.5. A fresh run learns a new critic alongside the
              imported actor.
            </p>
          </div>
          <div>
            <strong>03 / Constrain updates</strong>
            <code>ε = 0.2 · target KL = 0.02</code>
            <p>
              Gradient norm is clipped at 0.5. SB3 stops epochs early if
              approximate KL exceeds 1.5 × the target. The entropy coefficient
              is 0; action sampling still provides exploration.
            </p>
          </div>
        </div>
        <p className="research-footnote">
          Fresh-run settings from the implemented trainer. Saved reports
          identify the settings used by each checkpoint.{" "}
          <a
            href="https://arxiv.org/abs/1707.06347"
            target="_blank"
            rel="noreferrer"
          >
            PPO paper ↗
          </a>{" "}
          ·{" "}
          <a
            href="https://stable-baselines3.readthedocs.io/en/stable/modules/ppo.html"
            target="_blank"
            rel="noreferrer"
          >
            SB3 implementation ↗
          </a>
        </p>
      </div>
    </details>
  );
}

interface TrainingProps {
  task: TaskKind;
  plan: Plan;
  weights: RewardSpec;
  onWeights: (value: RewardSpec) => void;
  steps: number;
  onSteps: (value: number) => void;
  seed: number;
  onSeed: (value: number) => void;
  jobs: Job[];
  blocked: boolean;
  rlAvailable: boolean;
  baselineReady: boolean;
  onTrain: (resume: boolean) => void;
  onCompare: () => void;
}

export function ResearchTraining({
  task,
  plan,
  weights,
  onWeights,
  steps,
  onSteps,
  seed,
  onSeed,
  jobs,
  blocked,
  rlAvailable,
  baselineReady,
  onTrain,
  onCompare,
}: TrainingProps) {
  const trained = jobs.find(
    (job) => job.kind === "train" && job.status === "completed",
  );
  const [resume, setResume] = useState(false);
  const resumeEnabled = resume && !!trained;
  const latestWeights = trained?.data.reward;
  const draft = !sameWeights(weights, latestWeights ?? plan.reward);
  const valid =
    validWeights(weights, task) &&
    Number.isInteger(seed) &&
    seed >= 0 &&
    seed <= 2147483647;
  return (
    <div className="research-training">
      <div className="research-training-grid">
        <section className="research-card reward-editor">
          <div className="research-card-heading">
            <div>
              <h2>Reward weights</h2>
            </div>
            <Sigma size={19} />
          </div>
          <div className="reward-provenance">
            <span className={draft ? "research-badge draft" : "research-badge"}>
              {draft
                ? "Unsaved run configuration"
                : trained
                  ? "Latest candidate weights"
                  : "Experiment proposal"}
            </span>
          </div>
          <details className="research-details">
            <summary>Reward equation</summary>
            <RewardEquation weights={weights} task={task} />
          </details>
          <div className="reward-editor-labels">
            <span>Reward term / definition</span>
            <span>Weight</span>
          </div>
          {rewardTerms(task).map(
            ({ key, name, symbol, description, min, max, step }) => (
              <label className="research-reward-row" key={key}>
                <span className="reward-symbol">{symbol}</span>
                <span>
                  <strong>{name}</strong>
                  <small>{description}</small>
                </span>
                <span className="weight-field">
                  <input
                    aria-label={name}
                    type="number"
                    min={min}
                    max={max}
                    step={step}
                    value={Number.isFinite(weights[key]) ? weights[key] : ""}
                    disabled={blocked}
                    onChange={(event) =>
                      onWeights({
                        ...weights,
                        [key]:
                          event.target.value === ""
                            ? NaN
                            : Number(event.target.value),
                      })
                    }
                  />
                  <small>
                    {min}–{max}
                  </small>
                </span>
              </label>
            ),
          )}
          <div className="reward-actions">
            <button
              disabled={blocked || sameWeights(weights, plan.reward)}
              onClick={() => onWeights({ ...plan.reward })}
            >
              <RefreshCw size={12} /> Reset to proposal
            </button>
            {latestWeights && (
              <button
                disabled={blocked || sameWeights(weights, latestWeights)}
                onClick={() => onWeights({ ...latestWeights })}
              >
                Load latest run
              </button>
            )}
          </div>
          <p className="research-footnote">
            Edits apply to the next run and are cleared on reload.
          </p>
          <details className="research-details">
            <summary>
              How progress and penalties are calculated{" "}
              <ChevronRight size={14} />
            </summary>
            <div className="research-detail-body">
              <code>
                {task === "lifting"
                  ? "Φₜ = clip(1 − placement_error / initial_distance, 0, 1)"
                  : "Φₜ = clip(1 − gap / initial_gap, 0, 1)"}
              </code>
              <p>
                {task === "lifting"
                  ? "Progress is zero until the cavity rim has been cleared."
                  : "Progress is zero unless the needle is caught and clear, and the donor has released it."}{" "}
                ΔΦₜ = Φₜ − Φₜ₋₁. It measures net progress rather than repeatedly
                paying for holding position.
              </p>
              <code>Dₜ = mean[(aₜ − aₜ₋₁)²]</code>
              <p>
                The first action has no change penalty. Sₜ and Fₜ are one-time
                terminal indicators; Mₜ counts only newly reached milestones.
                Drops and flagged contacts are reported separately, not added as
                independent penalty terms.
              </p>
            </div>
          </details>
          <div className="research-criteria">
            <Check size={16} />
            <div>
              <strong>Success criteria stay fixed</strong>
              <p>
                {task === "lifting"
                  ? "Clear the rim, release with an open gripper in the tray, and settle for 0.75 seconds. Drops and contacts are reported separately."
                  : "Valid pass, receiving catch, donor release, full clearance, and gap below 0.7 mm for 0.75 seconds with low needle velocity."}
              </p>
            </div>
          </div>
        </section>
        <section className="research-card optimizer-setup">
          <div className="research-card-heading">
            <div>
              <h2>Training</h2>
            </div>
            <GitBranch size={19} />
          </div>
          <label className="research-field">
            Initialize from
            <select
              aria-label="Training initialization"
              value={resumeEnabled ? "candidate" : "baseline"}
              disabled={blocked}
              onChange={(event) =>
                setResume(event.target.value === "candidate")
              }
            >
              <option value="baseline">
                Original baseline · fresh PPO run
              </option>
              <option value="candidate" disabled={!trained}>
                Latest candidate · continue training
              </option>
            </select>
          </label>
          <div className="research-field-pair">
            <label className="research-field">
              Transition budget
              <select
                aria-label="Transition budget"
                value={steps}
                disabled={blocked}
                onChange={(event) => onSteps(Number(event.target.value))}
              >
                <option value={1024}>1,024 · smoke run</option>
                <option value={8192}>8,192 · short experiment</option>
                <option value={32768}>32,768 · extended experiment</option>
                <option value={131072}>131,072 · longer training</option>
              </select>
            </label>
            <label className="research-field">
              Training seed
              <input
                aria-label="Training seed"
                type="number"
                min={0}
                max={2147483647}
                step={1}
                value={Number.isNaN(seed) ? "" : seed}
                disabled={blocked}
                onChange={(event) =>
                  onSeed(
                    event.target.value === ""
                      ? NaN
                      : Number(event.target.value),
                  )
                }
              />
            </label>
          </div>
          <details className="research-details">
            <summary>Optimizer and checkpoint details</summary>
            <div className="policy-source">
              <span className="research-label">
                {resumeEnabled
                  ? "PARENT CANDIDATE"
                  : "BEHAVIOR-CLONED BASELINE"}
              </span>
              <code>
                {resumeEnabled ? trained?.id : taskInfo[task].checkpoint}
              </code>
              <p>
                {resumeEnabled
                  ? `${numberLabel(trained?.result?.steps, 0)} prior transitions. Restore actor, critic, and optimizer; sample new episodes with the selected seed.`
                  : "Import the existing actor and verify action parity before learning. Initialize a new critic and optimizer."}
              </p>
            </div>
            <div className="budget-explanation">
              <strong>{(steps / 256).toLocaleString()} rollout batches</strong>
              <span>
                {steps.toLocaleString()} new transitions ·{" "}
                {(steps / 20).toLocaleString()} simulated seconds
              </span>
              <p>
                A transition is one observe → act → reward step. Episodes reset
                on termination. Simulated time is not wall-clock runtime.
              </p>
            </div>
            <dl className="optimizer-settings">
              <div>
                <dt>Actor / critic hidden layers</dt>
                <dd>64 → 64 / 64 → 64</dd>
              </div>
              <div>
                <dt>Learning rate</dt>
                <dd>1 × 10⁻⁵</dd>
              </div>
              <div>
                <dt>Rollout / minibatch</dt>
                <dd>256 / 64 transitions</dd>
              </div>
              <div>
                <dt>Epochs per rollout</dt>
                <dd>Up to 4</dd>
              </div>
              <div>
                <dt>Training distribution</dt>
                <dd>{plan.scenarios.length} families + variation</dd>
              </div>
              <div>
                <dt>Observation normalization</dt>
                <dd>Frozen baseline statistics</dd>
              </div>
            </dl>
            <PPOExplanation />
          </details>
          {!valid && (
            <p className="research-validation" role="alert">
              Enter reward weights within their bounds and an integer seed from
              0 to 2,147,483,647.
            </p>
          )}
          <button
            className="primary research-train-button"
            disabled={blocked || !baselineReady || !rlAvailable || !valid}
            onClick={() => onTrain(resumeEnabled)}
          >
            {resumeEnabled ? <RefreshCw size={15} /> : <Play size={15} />}
            {resumeEnabled
              ? "Continue from saved candidate"
              : "Start RL training"}
            <ArrowRight size={15} />
          </button>
          {!baselineReady ? (
            <p className="research-footnote">
              Complete baseline evaluation to enable training.
            </p>
          ) : !rlAvailable ? (
            <p className="research-footnote">
              An RL-capable worker must be online to train.
            </p>
          ) : (
            <p className="research-footnote">
              Run settings and rewards are saved with the checkpoint.
              Optimization can improve or regress performance.
            </p>
          )}
        </section>
      </div>
      <TrainingEvidence jobs={jobs} onCompare={onCompare} />
    </div>
  );
}

type Point = { x: number; y: number };
function MetricChart({
  title,
  description,
  points,
  unit,
}: {
  title: string;
  description: string;
  points: Point[];
  unit: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const index =
    cursor === null ? points.length - 1 : Math.min(cursor, points.length - 1);
  const point = points[index];
  useEffect(() => {
    const element = canvas.current;
    if (!element || !points.length) return;
    const draw = () => {
      const width = element.clientWidth,
        height = 185,
        ratio = window.devicePixelRatio || 1;
      element.width = width * ratio;
      element.height = height * ratio;
      const context = element.getContext("2d");
      if (!context) return;
      context.scale(ratio, ratio);
      const ys = points.map((p) => p.y);
      const low = Math.min(...ys),
        high = Math.max(...ys);
      const pad = Math.max((high - low) * 0.12, Math.abs(high) * 0.02, 0.001);
      const min = low - pad,
        max = high + pad;
      const left = 52,
        right = width - 16,
        top = 14,
        bottom = height - 28;
      const x = (p: Point) =>
        left +
        ((p.x - points[0].x) / Math.max(1, points.at(-1)!.x - points[0].x)) *
          (right - left);
      const y = (p: Point) =>
        bottom - ((p.y - min) / (max - min)) * (bottom - top);
      context.font = "10px ui-monospace, monospace";
      for (let tick = 0; tick < 4; tick++) {
        const at = top + ((bottom - top) * tick) / 3;
        context.strokeStyle = "#e4e9e5";
        context.beginPath();
        context.moveTo(left, at);
        context.lineTo(right, at);
        context.stroke();
        context.fillStyle = "#64736b";
        context.textAlign = "right";
        const value = max - ((max - min) * tick) / 3;
        context.fillText(
          Math.abs(value) < 0.01 ? value.toExponential(1) : value.toFixed(1),
          left - 8,
          at + 3,
        );
      }
      context.strokeStyle = "#28664c";
      context.lineWidth = 1.6;
      context.beginPath();
      points.forEach((p, i) =>
        i === 0 ? context.moveTo(x(p), y(p)) : context.lineTo(x(p), y(p)),
      );
      context.stroke();
      if (point) {
        context.fillStyle = "#28664c";
        context.beginPath();
        context.arc(x(point), y(point), 3.5, 0, Math.PI * 2);
        context.fill();
      }
      context.fillStyle = "#64736b";
      context.textAlign = "left";
      context.fillText(points[0].x.toLocaleString(), left, height - 8);
      context.textAlign = "right";
      context.fillText(points.at(-1)!.x.toLocaleString(), right, height - 8);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    return () => observer.disconnect();
  }, [points, point]);
  return (
    <div className="metric-chart">
      <div className="metric-chart-heading">
        <h4>{title}</h4>
        <strong>
          {point ? numberLabel(point.y) : "—"}
          <small>{unit}</small>
        </strong>
      </div>
      <p>{description}</p>
      {points.length ? (
        <>
          <canvas
            ref={canvas}
            role="img"
            aria-label={`${title}, ${points.length} recorded samples. Use the control below to inspect individual values.`}
          />
          <div className="chart-axis">
            <span>Total training transitions</span>
            <span>
              {point?.x.toLocaleString()} → {numberLabel(point?.y)}
            </span>
          </div>
          <input
            type="range"
            aria-label={`Inspect ${title.toLowerCase()}`}
            min={0}
            max={Math.max(0, points.length - 1)}
            value={Math.max(0, index)}
            onChange={(event) => setCursor(Number(event.target.value))}
          />
        </>
      ) : (
        <div className="chart-empty">No recorded samples for this metric.</div>
      )}
    </div>
  );
}

function TrainingEvidence({
  jobs,
  onCompare,
}: {
  jobs: Job[];
  onCompare: () => void;
}) {
  const saved = jobs.filter(
    (job) => job.kind === "train" && job.status === "completed",
  );
  const [chosen, setChosen] = useState("");
  const [metric, setMetric] = useState("return");
  const [diagnostic, setDiagnostic] = useState<
    "approx_kl" | "clip_fraction" | "value_loss" | "explained_variance"
  >("approx_kl");
  const selected = saved.find((job) => job.id === chosen) ?? saved[0];
  const result = selected?.result;
  const history = episodeHistory(result);
  const updates = optimizerHistory(result);
  const active = jobs.find(
    (job) => job.kind === "train" && ["queued", "running"].includes(job.status),
  );
  const metricNames = {
    approx_kl: "Approximate KL",
    clip_fraction: "Clip fraction",
    value_loss: "Value loss",
    explained_variance: "Explained variance",
  };
  const descriptions = {
    approx_kl:
      "Estimated policy movement per rollout update. Target KL is a training control, not a performance score.",
    clip_fraction:
      "Fraction of sampled probability ratios outside the clipping interval.",
    value_loss:
      "Mean squared error of the critic’s return predictions. Its scale depends on reward weights.",
    explained_variance:
      "Critic fit to return targets. 1 is ideal; 0 is no better than predicting a constant. Undefined values are omitted.",
  };
  const metricPoints = history.map((row, index) => ({
    x: row.step,
    y:
      metric === "return"
        ? row.return_value
        : metric === "length"
          ? row.length
          : (history
              .slice(Math.max(0, index - 9), index + 1)
              .filter((sample) => sample.success).length /
              Math.min(10, index + 1)) *
            100,
  }));
  const diagnosticPoints = updates.flatMap((row) =>
    typeof row[diagnostic] === "number" && Number.isFinite(row[diagnostic])
      ? [{ x: row.step, y: row[diagnostic]! }]
      : [],
  );
  const sourceWeights = selected?.data.reward;
  return (
    <section className="research-card training-evidence">
      <div className="research-card-heading">
        <div>
          <span className="research-label">03 / LEARNING EVIDENCE</span>
          <h3>What changed during training?</h3>
          <p>
            Measured samples from saved runs. Training return describes the
            objective; paired evaluation measures task performance.
          </p>
        </div>
        <Activity size={19} />
      </div>
      {active && (
        <p className="research-notice" role="status">
          Training is {active.status}. Curves are published with the completed
          checkpoint.
          {selected
            ? " The evidence below belongs to the selected saved run."
            : " Live transition progress appears above."}
        </p>
      )}
      {!selected ? (
        <div className="evidence-empty">
          <Activity size={27} />
          <h4>Your first run will establish a learning trace.</h4>
          <p>
            Episode return, success, length, and PPO update diagnostics will
            appear here after training completes. No training results have been
            recorded for this experiment.
          </p>
          <div>
            <span>Episode outcomes</span>
            <span>Optimizer diagnostics</span>
            <span>Checkpoint lineage</span>
          </div>
        </div>
      ) : (
        <>
          <div className="evidence-toolbar">
            <label className="research-field">
              Saved training run
              <select
                aria-label="Saved training run"
                value={selected.id}
                onChange={(event) => setChosen(event.target.value)}
              >
                {saved.map((job, index) => (
                  <option key={job.id} value={job.id}>
                    {index === 0 ? "Latest · " : ""}
                    {new Date(job.created_at).toLocaleString()} ·{" "}
                    {numberLabel(job.result?.steps, 0)} transitions ·{" "}
                    {job.data.checkpoint ? "resumed" : "fresh"}
                  </option>
                ))}
              </select>
            </label>
            {typeof result?.report === "string" && (
              <a
                href={artifact(result.report)}
                target="_blank"
                rel="noreferrer"
              >
                <ArrowDownToLine size={13} /> Training report
              </a>
            )}
            {typeof result?.checkpoint === "string" && (
              <a href={artifact(result.checkpoint)} download="candidate.zip">
                <ArrowDownToLine size={13} /> Download checkpoint
              </a>
            )}
          </div>
          <div className="research-stats">
            <div>
              <span>New / total transitions</span>
              <strong>
                {numberLabel(result?.new_steps ?? result?.requested_steps, 0)} /{" "}
                {numberLabel(result?.steps, 0)}
              </strong>
            </div>
            <div>
              <span>Completed training episodes</span>
              <strong>{history.length.toLocaleString()}</strong>
            </div>
            <div>
              <span>Training success</span>
              <strong>
                {history.length
                  ? `${history.filter((row) => row.success).length}/${history.length}`
                  : "—"}
              </strong>
            </div>
            <div>
              <span>Actor parameter change · L2</span>
              <strong>
                {numberLabel(result?.actor_parameter_delta_l2, 5)}
              </strong>
            </div>
          </div>
          <div className="learning-charts">
            <div>
              <label className="chart-select">
                Episode metric
                <select
                  aria-label="Episode metric"
                  value={metric}
                  onChange={(event) => setMetric(event.target.value)}
                >
                  <option value="return">Episode return</option>
                  <option value="success">
                    Training success · trailing 10
                  </option>
                  <option value="length">Episode length</option>
                </select>
              </label>
              <MetricChart
                key={`${selected.id}-${metric}`}
                title={
                  metric === "return"
                    ? "Episode return"
                    : metric === "success"
                      ? "Training success"
                      : "Episode length"
                }
                description={
                  metric === "return"
                    ? "Undiscounted sum of rewards for each completed episode. Raw samples; no smoothing."
                    : metric === "success"
                      ? "Trailing mean over up to 10 completed episodes. These are training outcomes, not evaluation results."
                      : "Control transitions per completed episode. A shorter failure is not an improvement."
                }
                points={metricPoints}
                unit={
                  metric === "success"
                    ? "%"
                    : metric === "length"
                      ? "steps"
                      : "reward"
                }
              />
            </div>
            <div>
              <label className="chart-select">
                Optimizer metric
                <select
                  aria-label="Optimizer metric"
                  value={diagnostic}
                  onChange={(event) =>
                    setDiagnostic(event.target.value as typeof diagnostic)
                  }
                >
                  {Object.entries(metricNames).map(([key, name]) => (
                    <option key={key} value={key}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <MetricChart
                key={`${selected.id}-${diagnostic}`}
                title={metricNames[diagnostic]}
                description={descriptions[diagnostic]}
                points={diagnosticPoints}
                unit=""
              />
              {!updates.length && (
                <p className="research-footnote">
                  This report predates optimizer diagnostics. Run training again
                  to record them; historical values are not reconstructed.
                </p>
              )}
            </div>
          </div>
          <details className="research-details">
            <summary>
              Run provenance, settings & recorded reward{" "}
              <ChevronRight size={14} />
            </summary>
            <div className="research-detail-body">
              <dl className="run-provenance">
                <div>
                  <dt>Checkpoint SHA-256</dt>
                  <dd>{String(result?.checkpoint_sha256 ?? "Not recorded")}</dd>
                </div>
                <div>
                  <dt>Parent SHA-256</dt>
                  <dd>{String(result?.parent_sha256 ?? "Not recorded")}</dd>
                </div>
                <div>
                  <dt>Run / seed</dt>
                  <dd>
                    {selected.id} / {numberLabel(result?.seed, 0)}
                  </dd>
                </div>
                <div>
                  <dt>Initialization</dt>
                  <dd>
                    {result?.resumed
                      ? "Resumed candidate; new episode boundary"
                      : "Baseline actor; fresh critic and optimizer"}
                  </dd>
                </div>
                <div>
                  <dt>Learning rate / rollout / batch / epochs</dt>
                  <dd>
                    {numberLabel(result?.learning_rate)} /{" "}
                    {numberLabel(result?.n_steps, 0)} /{" "}
                    {numberLabel(result?.batch_size, 0)} /{" "}
                    {numberLabel(result?.n_epochs, 0)}
                  </dd>
                </div>
                <div>
                  <dt>γ / λ / ε / target KL</dt>
                  <dd>
                    {numberLabel(result?.gamma)} /{" "}
                    {numberLabel(result?.gae_lambda)} /{" "}
                    {numberLabel(result?.clip_range)} /{" "}
                    {numberLabel(result?.target_kl)}
                  </dd>
                </div>
              </dl>
              {sourceWeights && (
                <RewardEquation
                  weights={sourceWeights}
                  task={result?.task === "lifting" ? "lifting" : "stitch"}
                />
              )}
              <p className="research-footnote">
                Actor change measures the L2 distance between action-network
                parameters at the start and end of this run. It proves parameter
                movement, not improved performance. Missing fields remain “Not
                recorded” for older reports.
              </p>
            </div>
          </details>
          <div className="evidence-next">
            <div>
              <Check size={16} />
              <span>
                <strong>Candidate checkpoint saved</strong>
                <small>
                  Compare the latest candidate on the baseline’s configurations
                  and seeds.
                </small>
              </span>
            </div>
            <button onClick={onCompare}>
              Open paired evaluation <ArrowRight size={14} />
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export function RewardBreakdown({
  terms,
  task,
  label,
}: {
  terms?: Record<string, number>;
  task: TaskKind;
  label: string;
}) {
  const values = rewardTerms(task).map((term) => ({
    ...term,
    value: terms?.[term.key] ?? 0,
  }));
  const max = Math.max(0.001, ...values.map((term) => Math.abs(term.value)));
  return (
    <div className="recorded-reward">
      <div>
        <strong>{label} reward at this step</strong>
        <span>
          {terms
            ? numberLabel(values.reduce((sum, term) => sum + term.value, 0))
            : "—"}
        </span>
      </div>
      {terms ? (
        values.map((term) => (
          <div className="recorded-reward-row" key={term.key}>
            <span>{term.symbol}</span>
            <span className="reward-bar-track">
              <span
                className={term.value < 0 ? "negative" : ""}
                style={{ width: `${(Math.abs(term.value) / max) * 100}%` }}
              />
            </span>
            <span>{numberLabel(term.value)}</span>
          </div>
        ))
      ) : (
        <p>Awaiting recorded telemetry.</p>
      )}
      <p>
        <Info size={11} /> Recorded weighted contributions. S = success; M =
        milestones; ΔΦ = progress; D = action change; F = failure. Values
        include their signs.
      </p>
    </div>
  );
}
