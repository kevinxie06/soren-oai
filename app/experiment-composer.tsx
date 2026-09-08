"use client";

import { useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Box,
  Check,
  ChevronDown,
  Crosshair,
  LoaderCircle,
  SlidersHorizontal,
} from "lucide-react";
import {
  coverageLabel,
  defaultSpecification,
  taskPackages,
  validateSpecification,
} from "@/lib/experiment-spec";
import type {
  ExperimentSpecification,
  ReviewedStudy,
} from "@/lib/experiment-spec";
import type { TaskKind } from "@/lib/types";
import "./experiment-composer.css";

async function request<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/lab${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      (data as { error?: string }).error ??
        "Unable to prepare this study. Try again.",
    );
  return data as T;
}
export function StudyRecord({
  specification: s,
}: {
  specification: ExperimentSpecification;
}) {
  const pkg = taskPackages[s.task];
  return (
    <details className="study-record">
      <summary>
        <Box size={13} />
        Reviewed study ·{" "}
        {s.purpose === "evaluate" ? "Evaluate reliability" : "Improve policy"}
        <span>{s.episodes} episodes / environment</span>
        <ChevronDown size={13} />
      </summary>
      <div className="study-record-body">
        <p>
          {pkg.id} · {pkg.policy} · seed {s.seed}
        </p>
        <dl>
          {pkg.parameters.map((p) => (
            <div key={p.key}>
              <dt>{p.label}</dt>
              <dd>
                {rangeLabel(s.ranges[p.key])} {p.unit}
              </dd>
            </div>
          ))}
        </dl>
        <p>
          Exploratory simulator package. Physical calibration is not
          established. Development evaluation; no held-out validation set. Run
          history records any later budget or reward changes.
        </p>
      </div>
    </details>
  );
}
function rangeLabel([lo, hi]: [number, number]) {
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}
export default function ExperimentComposer({
  available,
  trainingAvailable,
  initial,
  onCreated,
}: {
  available: boolean;
  trainingAvailable: boolean;
  initial?: ExperimentSpecification;
  onCreated: (id: string) => Promise<void>;
}) {
  const [spec, setSpec] = useState<ExperimentSpecification>(
    () => initial ?? defaultSpecification(),
  );
  const [review, setReview] = useState<ReviewedStudy | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const question = useRef<HTMLTextAreaElement>(null);
  const pkg = taskPackages[spec.task];
  function update(patch: Partial<ExperimentSpecification>) {
    setSpec((s) => ({ ...s, ...patch }));
    setReview(null);
    setError("");
  }
  async function prepare() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const draft = validateSpecification(spec);
      const result = await request<ReviewedStudy>("/plans", {
        specification: draft,
      });
      setSpec(result.specification);
      setReview(result);
      requestAnimationFrame(() => reviewHeading.current?.focus());
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to prepare this study.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function launch() {
    if (!review || busy || !available) return;
    setBusy(true);
    setError("");
    try {
      const result = await request<{ experiment: { id: string } }>(
        "/experiments",
        {
          specification: review.specification,
          review_fingerprint: review.fingerprint,
        },
      );
      await onCreated(result.experiment.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to launch this study.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="study-composer">
      <div className="launch-heading">
        <span className="launch-symbol">
          <Crosshair size={26} strokeWidth={1.3} />
        </span>
        <div className="eyebrow">GROUNDED EXPERIMENTS</div>
        <h1 ref={reviewHeading} tabIndex={-1}>
          {review ? "Review your experiment" : "Launch a new experiment"}
          <span>.</span>
        </h1>
        <p>
          {review
            ? "A defined question. A reproducible plan."
            : "Choose a skill. Define the question. Test the policy."}
        </p>
      </div>
      {error && (
        <div className="study-error" role="alert">
          {error}
        </div>
      )}
      {!review ? (
        <form
          className="study-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void prepare();
          }}
        >
          <fieldset disabled={busy}>
            <div className="study-selectors">
              <label>
                Task package
                <select
                  aria-label="Task package"
                  value={spec.task}
                  onChange={(e) => {
                    const next = defaultSpecification(
                      e.target.value as TaskKind,
                    );
                    setSpec({
                      ...next,
                      purpose: spec.purpose,
                      episodes: spec.episodes,
                      steps: spec.steps,
                      seed: spec.seed,
                    });
                    setError("");
                  }}
                >
                  <option value="stitch">Needle transfer & closure</option>
                  <option value="lifting">Object lifting & placement</option>
                </select>
              </label>
              <label>
                Purpose
                <select
                  value={spec.purpose}
                  onChange={(e) =>
                    update({
                      purpose: e.target
                        .value as ExperimentSpecification["purpose"],
                    })
                  }
                >
                  <option value="evaluate">Evaluate reliability</option>
                  <option value="improve">Improve policy</option>
                </select>
              </label>
            </div>
            <div className="study-package-caption">
              <Box size={13} />
              <span>{pkg.description}</span>
              <span className="study-version">v1</span>
            </div>
            <label className="question-label" htmlFor="research-question">
              Research question<span>Editable starting point</span>
            </label>
            <textarea
              ref={question}
              id="research-question"
              rows={3}
              minLength={10}
              maxLength={4000}
              required
              value={spec.question}
              onChange={(e) => update({ question: e.target.value })}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <p className="study-question-hint">
              Your question records intent. The settings below define what the
              simulator tests.
            </p>
            <details className="study-settings">
              <summary>
                <SlidersHorizontal size={14} />
                Study settings
                <span>
                  {coverageLabel(spec)} · {spec.episodes * 16} episodes
                </span>
                <ChevronDown size={13} />
              </summary>
              <div className="study-settings-body">
                <div className="range-heading">
                  <strong>Operating envelope</strong>
                  <span>Equal values keep a parameter fixed.</span>
                </div>
                <div className="study-ranges">
                  {pkg.parameters.map((p) => (
                    <div className="study-range" key={p.key}>
                      <span>
                        {p.label}
                        <small>{p.unit}</small>
                      </span>
                      <label>
                        <span className="sr-only">{p.label} minimum</span>
                        <input
                          type="number"
                          min={p.bounds[0]}
                          max={p.bounds[1]}
                          step="any"
                          required
                          value={
                            Number.isNaN(spec.ranges[p.key][0])
                              ? ""
                              : spec.ranges[p.key][0]
                          }
                          onChange={(e) =>
                            update({
                              ranges: {
                                ...spec.ranges,
                                [p.key]: [
                                  e.target.valueAsNumber,
                                  spec.ranges[p.key][1],
                                ],
                              },
                            })
                          }
                        />
                      </label>
                      <span className="range-to">to</span>
                      <label>
                        <span className="sr-only">{p.label} maximum</span>
                        <input
                          type="number"
                          min={p.bounds[0]}
                          max={p.bounds[1]}
                          step="any"
                          required
                          value={
                            Number.isNaN(spec.ranges[p.key][1])
                              ? ""
                              : spec.ranges[p.key][1]
                          }
                          onChange={(e) =>
                            update({
                              ranges: {
                                ...spec.ranges,
                                [p.key]: [
                                  spec.ranges[p.key][0],
                                  e.target.valueAsNumber,
                                ],
                              },
                            })
                          }
                        />
                      </label>
                    </div>
                  ))}
                </div>
                <div className="study-budgets">
                  <label>
                    Episodes / environment
                    <select
                      value={spec.episodes}
                      onChange={(e) =>
                        update({ episodes: Number(e.target.value) })
                      }
                    >
                      {[1, 3, 5, 10, 20].map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Study seed
                    <input
                      type="number"
                      min={0}
                      max={99999}
                      step={1}
                      required
                      value={Number.isNaN(spec.seed) ? "" : spec.seed}
                      onChange={(e) => update({ seed: e.target.valueAsNumber })}
                    />
                  </label>
                  {spec.purpose === "improve" && (
                    <label>
                      Training transitions
                      <select
                        value={spec.steps}
                        onChange={(e) =>
                          update({ steps: Number(e.target.value) })
                        }
                      >
                        {[1024, 8192, 32768, 131072].map((n) => (
                          <option key={n} value={n}>
                            {n.toLocaleString()}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                <div className="study-fixed">
                  <span>Starting policy</span>
                  <strong>{pkg.policy}</strong>
                  <p>
                    {pkg.robot} · {pkg.observations} state observations ·{" "}
                    {pkg.actions} actions · 20 Hz
                  </p>
                  <p>
                    The included checkpoint is the compatible starting policy.
                    Camera renderings are for inspection.
                  </p>
                </div>
              </div>
            </details>
            <div className="study-submit">
              <span>16 environments · exploratory simulation</span>
              <button className="primary" type="submit" disabled={busy}>
                {busy ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <ArrowRight size={14} />
                )}
                {busy ? "Preparing plan…" : "Generate experiment plan"}
              </button>
            </div>
          </fieldset>
        </form>
      ) : (
        <section className="study-review" aria-label="Experiment plan review">
          <div className="study-review-top">
            <span>
              <Check size={13} />
              Configuration checked
            </span>
            <button
              disabled={busy}
              onClick={() => {
                setReview(null);
                setError("");
                requestAnimationFrame(() => question.current?.focus());
              }}
            >
              <ArrowLeft size={13} />
              Edit study
            </button>
          </div>
          <h2>{pkg.name}</h2>
          <p className="review-question">{review.specification.question}</p>
          <div className="study-review-stats">
            <div>
              <strong>16</strong>
              <span>environments</span>
            </div>
            <div>
              <strong>{spec.episodes * 16}</strong>
              <span>baseline episodes</span>
            </div>
            <div>
              <strong>{spec.purpose === "improve" ? "PPO" : "Baseline"}</strong>
              <span>
                {spec.purpose === "improve"
                  ? `${spec.steps.toLocaleString()} transitions planned`
                  : "reliability evaluation"}
              </span>
            </div>
          </div>
          <div className="review-coverage">
            <div>
              <h3>What will vary</h3>
              <span>{coverageLabel(spec)}</span>
            </div>
            <dl>
              {pkg.parameters
                .filter((p) => spec.ranges[p.key][0] !== spec.ranges[p.key][1])
                .map((p) => (
                  <div key={p.key}>
                    <dt>{p.label}</dt>
                    <dd>
                      {rangeLabel(spec.ranges[p.key])} {p.unit}
                    </dd>
                  </div>
                ))}
            </dl>
            <p>
              Fixed:{" "}
              {pkg.parameters
                .filter((p) => spec.ranges[p.key][0] === spec.ranges[p.key][1])
                .map(
                  (p) =>
                    `${p.label.toLowerCase()} ${spec.ranges[p.key][0]} ${p.unit}`,
                )
                .join("; ") || "object geometry and task mechanics"}
              .
            </p>
            <p>
              {spec.task === "lifting"
                ? "Episode seeds also vary the initial gripper XY within ±25 mm."
                : "Episode seeds also vary the task-native scene initialization."}{" "}
              Training perturbations stay within the reviewed ranges.
            </p>
          </div>
          <details className="review-detail">
            <summary>
              Policy, success criteria & measurements
              <ChevronDown size={13} />
            </summary>
            <div>
              <p>
                <strong>{pkg.policy}</strong>
                <br />
                {pkg.robot} · {pkg.observations} state inputs · {pkg.actions}{" "}
                actions · 20 Hz
              </p>
              <h3>Successful completion</h3>
              <p>{pkg.success}</p>
              <h3>Failures & reporting</h3>
              <p>{pkg.failures}</p>
              <p>{pkg.metrics.join(" · ")}</p>
              <h3>Learning objective</h3>
              <p>
                Package reward defaults are separate from the fixed success
                checker. Review and adjust weights in Rewards & training.
              </p>
              <dl>
                {Object.entries(pkg.reward).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </details>
          <div className="study-evidence">
            <span className="eyebrow">EXPLORATORY SIMULATOR · {pkg.id}</span>
            <p>
              Physical calibration is not established. This is a development
              suite, with no held-out validation set.
            </p>
            <p>
              {pkg.limitations[0]} Unsupported mechanics are not added or
              substituted by the research question.
            </p>
            <details>
              <summary>Package assumptions & evidence</summary>
              <p>{pkg.limitations.slice(1).join(" ")}</p>
              <p>
                Reference: included simulator and checkpoint. No physical
                measurement or clinical evidence package is attached.
              </p>
            </details>
          </div>
          <div className="review-execution">
            <strong>After launch</strong>
            <p>
              {spec.purpose === "improve"
                ? "Build the suite, evaluate the baseline, then start PPO training and compare the candidate. Training starts only when you run it."
                : "Build the suite, then run the baseline evaluation. Inspect each environment’s outcomes and recordings."}
            </p>
          </div>
          {!available && (
            <p className="study-availability" role="status">
              Your plan is ready. Connect a simulation worker to launch.
            </p>
          )}
          {spec.purpose === "improve" && available && !trainingAvailable && (
            <p className="study-availability">
              This worker can build and evaluate the suite. PPO training
              requires a worker with training support.
            </p>
          )}
          <button
            className="primary study-launch"
            disabled={busy || !available}
            onClick={() => void launch()}
          >
            {busy ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <ArrowRight size={15} />
            )}
            {busy ? "Launching experiment…" : "Launch experiment"}
          </button>
        </section>
      )}
      {!review && (
        <p className="study-bottom-note">
          Review coverage, policy compatibility, and simulation limits before
          anything runs.
        </p>
      )}
    </div>
  );
}
