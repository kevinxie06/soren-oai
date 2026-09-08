"use client";
import ProcedureHeader from "../procedure-header";
import FullscreenButton from "../fullscreen-button";
import { useEffect, useRef, useState } from "react";
import { Download, Pause, Play, RotateCcw } from "lucide-react";
import MotionView from "./motion-view";
import PolicyComparison, { type PolicyVersion } from "../policy-comparison";
import type { Motion } from "./types";
import "./showcase.css";

export default function Showcase() {
  const [motion, setMotion] = useState<Motion | null>(null);
  const [error, setError] = useState("");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [view, setView] = useState("presentation");
  const [version, setVersion] = useState<PolicyVersion>("current");
  const motionBase = `/motion/heart${version === "old" ? "-old" : ""}`;
  const video = useRef<HTMLVideoElement>(null);
  const cursor = useRef(0);
  useEffect(() => {
    cursor.current = time;
  }, [time]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${motionBase}.json`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error("Motion export is missing");
        return r.json() as Promise<Motion>;
      })
      .then((data) => {
        if (data.schema_version !== "soren.motion.v1" || !data.frames?.length)
          throw new Error("Unsupported motion export");
        setMotion(data);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [motionBase]);
  useEffect(() => {
    if (!playing || !motion || view === "video") return;
    let previous = performance.now();
    let id = 0;
    const tick = (now: number) => {
      if (cursor.current >= motion.duration_s) {
        setPlaying(false);
        return;
      }
      const dt = Math.min((now - previous) / 1000, 0.1) * speed;
      previous = now;
      setTime((t) => Math.min(t + dt, motion.duration_s));
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, motion, speed, view]);
  const frame =
    motion?.frames[
      Math.min(Math.floor(time * motion.sample_hz), motion.frames.length - 1)
    ];
  const stage =
    frame?.demonstration_phase ??
    (!frame
      ? "Loading"
      : frame.state.released
        ? "Release & settle"
        : frame.state.cleared
          ? "Transfer to tray"
          : frame.state.attached
            ? "Lift clear"
            : frame.state.closed
              ? "Grasp"
              : "Approach");
  const chapters = [
    { label: "Approach", find: () => true },
    { label: "Grasp", find: (f: Motion["frames"][number]) => f.state.closed },
    {
      label: "Lift clear",
      find: (f: Motion["frames"][number]) => f.state.attached,
    },
    {
      label: "Transfer to tray",
      find: (f: Motion["frames"][number]) => f.state.cleared,
    },
    {
      label: "Release & settle",
      find: (f: Motion["frames"][number]) => f.state.released,
    },
  ];
  function seek(t: number) {
    setTime(t);
    if (video.current) video.current.currentTime = Math.max(0, t - 0.05);
  }
  function toggle() {
    if (!motion) return;
    const atEnd = time >= motion.duration_s;
    if (atEnd) seek(0);
    const next = atEnd || !playing;
    setPlaying(next);
    if (video.current) {
      if (next) void video.current.play().catch(() => setPlaying(false));
      else video.current.pause();
    }
  }
  return (
    <div className="showcase">
      <ProcedureHeader current="heart" />
      <main className="showcase-main">
        <div className="showcase-heading">
          <div>
            <h1>Heart extraction</h1>
            <p>Recorded policy playback</p>
          </div>
          <span className="recorded-badge">Recorded simulation</span>
        </div>
        {error && <p role="alert">{error}. Try reloading the page.</p>}
        <div className="showcase-grid">
          <section
            data-procedure-player
            className="showcase-player"
            aria-label="Procedure playback"
          >
            <PolicyComparison
              task="heart"
              value={version}
              onChange={(next) => {
                video.current?.pause();
                setPlaying(false);
                setTime(0);
                cursor.current = 0;
                setMotion(null);
                setError("");
                setVersion(next);
              }}
            />
            <div className="view-tabs" role="group" aria-label="Rendering view">
              {[
                ["presentation", "Surgical rendering"],
                ["geometry", "Simulation geometry"],
                ["video", "Original simulation"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  aria-pressed={view === id}
                  onClick={() => {
                    setPlaying(false);
                    setView(id);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="showcase-viewport">
              <FullscreenButton />
              {view === "video" ? (
                <video
                  ref={video}
                  key={version}
                  src={`${motionBase}.mp4`}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label="Native MuJoCo learned-policy recording"
                  onTimeUpdate={(e) =>
                    setTime(
                      Math.min(
                        e.currentTarget.currentTime + 0.05,
                        motion?.duration_s ?? 0,
                      ),
                    )
                  }
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                  onLoadedMetadata={(e) => {
                    e.currentTarget.currentTime = Math.max(0, time - 0.05);
                    e.currentTarget.playbackRate = speed;
                  }}
                >
                  <track
                    kind="captions"
                    src={`${motionBase}.vtt`}
                    srcLang="en"
                    label="Procedure events"
                  />
                </video>
              ) : (
                motion && (
                  <MotionView
                    key={version}
                    motion={motion}
                    time={time}
                    context={view === "presentation"}
                  />
                )
              )}
              {!motion && !error && (
                <p className="motion-loading">Loading measured motion…</p>
              )}
              <span className="viewport-label">
                {view === "video" ? "Recorded simulation" : "3D replay"}
              </span>
              <span className="viewport-help">
                {view === "video"
                  ? "Same seed and learned checkpoint"
                  : "Orbit/Pan: drag · Scroll to zoom"}
              </span>
            </div>
            <div className="playback-controls">
              <button
                onClick={toggle}
                disabled={!motion}
                aria-label={
                  playing && time < (motion?.duration_s ?? 0)
                    ? "Pause playback"
                    : "Play playback"
                }
              >
                {playing && time < (motion?.duration_s ?? 0) ? (
                  <Pause size={18} />
                ) : (
                  <Play size={18} />
                )}
              </button>
              <button
                aria-label="Restart playback"
                onClick={() => {
                  setPlaying(false);
                  video.current?.pause();
                  seek(0);
                }}
              >
                <RotateCcw size={17} />
              </button>
              <input
                aria-label="Playback position"
                type="range"
                min="0"
                max={motion?.duration_s ?? 1}
                step="0.01"
                value={time}
                onChange={(e) => seek(Number(e.target.value))}
              />
              <span className="timecode">
                {time.toFixed(2)} / {(motion?.duration_s ?? 0).toFixed(2)}s
              </span>
              <select
                aria-label="Playback speed"
                value={speed}
                onChange={(e) => {
                  const s = Number(e.target.value);
                  setSpeed(s);
                  if (video.current) video.current.playbackRate = s;
                }}
              >
                {[0.25, 0.5, 0.75, 1, 2].map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
            </div>
            <div className="heart-chapters" aria-label="Procedure phases">
              {chapters.map(({ label, find }, i) => (
                <button
                  key={label}
                  disabled={!motion?.frames.some(find)}
                  aria-current={stage === label ? "step" : undefined}
                  onClick={() => {
                    const index = motion?.frames.findIndex(find);
                    if (motion && index !== undefined && index >= 0)
                      seek(index / motion.sample_hz);
                  }}
                >
                  <span>0{i + 1}</span>
                  {label}
                </button>
              ))}
            </div>
            <div className="playback-note">
              <span className="stage-dot" />
              {stage}
            </div>
          </section>
          <aside className="showcase-sidebar">
            <div className="procedure-card">
              <h2>Episode results</h2>
              <div
                className={`result-pill${motion && !motion.result.success ? " failed" : ""}`}
              >
                {motion
                  ? motion.result.success
                    ? "✓ Successful recorded episode"
                    : "Episode failed"
                  : "Loading result"}
              </div>
              <dl>
                <div>
                  <dt>Scene seed</dt>
                  <dd>{motion?.seed ?? "—"}</dd>
                </div>
                <div>
                  <dt>Placement error</dt>
                  <dd>
                    {motion
                      ? `${(motion.result.placement_error * 1000).toFixed(2)} mm`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Flagged drops</dt>
                  <dd>{motion?.result.drops ?? "—"}</dd>
                </div>
                <div>
                  <dt>Unwanted contacts</dt>
                  <dd>{motion?.result.unwanted_collisions ?? "—"}</dd>
                </div>
              </dl>
            </div>
            <a className="export-button" href={`${motionBase}.json`} download>
              <Download size={15} /> Download motion data
            </a>
          </aside>
        </div>
      </main>
    </div>
  );
}
