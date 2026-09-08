"use client";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import CameraControls, {
  type CameraView,
  type NavigationMode,
} from "./camera-controls";
import FullscreenButton from "./fullscreen-button";
import { scenarioInsights, formatParameter } from "@/lib/scenario-insights";
import type { ScenarioGuide } from "./scenario-guides";
import type { Run, Scenario } from "@/lib/types";
import type { Motion } from "./showcase/types";
import type { StitchMotion } from "./suturing/types";
import "./scenario-rendering.css";

const HeartViewer = lazy(() => import("./showcase/motion-view"));
const StitchViewer = lazy(() => import("./suturing/viewer"));
const asset = (key: string) => "/api/lab/artifacts/" + key;
type Recording = Motion | StitchMotion;
const recordings = new Map<string, Recording>();
function useRecording(key?: string) {
  const [state, setState] = useState<{
    key?: string;
    motion?: Recording;
    error?: string;
  }>(() => ({ key, motion: key ? recordings.get(key) : undefined }));
  useEffect(() => {
    if (!key) return;
    const cached = recordings.get(key);
    if (cached) return;
    const controller = new AbortController();
    fetch(asset(key), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("3D recording unavailable");
        const motion = (await response.json()) as Recording;
        if (!motion.frames?.length || !motion.geometry?.length)
          throw new Error("Invalid 3D recording");
        if (recordings.size >= 48)
          recordings.delete(recordings.keys().next().value!);
        recordings.set(key, motion);
        if (!controller.signal.aborted) setState({ key, motion });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ key, error: String(error.message) });
      });
    return () => controller.abort();
  }, [key]);
  return key && recordings.has(key)
    ? { motion: recordings.get(key) }
    : state.key === key
      ? state
      : {};
}

function Scene({
  motion,
  time,
  geometry = false,
  thumbnail = false,
  onCapture,
  guide,
}: {
  motion: Recording;
  time: number;
  geometry?: boolean;
  thumbnail?: boolean;
  onCapture?: (url: string) => void;
  guide?: ScenarioGuide;
}) {
  const [view, setView] = useState<CameraView>("macro");
  const [navigation, setNavigation] = useState<NavigationMode>("orbit");
  const [status, setStatus] = useState("");
  return (
    <Suspense
      fallback={
        <span className="scene-loading">Loading surgical rendering…</span>
      }
    >
      {motion.schema_version === "soren.stitch.v1" ? (
        <>
          <StitchViewer
            motion={motion as StitchMotion}
            time={time}
            angle={view}
            navigation={navigation}
            geometry={geometry}
            asset={null}
            onStatus={setStatus}
            onCapture={onCapture}
            guide={guide}
          />
          {!thumbnail && (
            <CameraControls
              view={view}
              onView={setView}
              mode={navigation}
              onMode={setNavigation}
              geometry={geometry}
            />
          )}
          {!thumbnail && (
            <span className="generated-scene-status" role="status">
              {status}
            </span>
          )}
        </>
      ) : (
        <HeartViewer
          motion={motion as Motion}
          time={time}
          context={!geometry}
          initialView="field"
          guide={guide}
          onCapture={onCapture}
        />
      )}
    </Suspense>
  );
}

// One thumbnail renderer for the entire suite, regardless of how many cards are visible.
// Completed cards are ordinary images and consume no WebGL contexts.
const thumbnails = new Map<string, string>();
const queue: (() => void)[] = [];
let busy = false;
function nextThumbnail() {
  if (busy) return;
  const next = queue.shift();
  if (next) {
    busy = true;
    next();
  }
}
function ThumbnailRender({
  motionKey,
  onDone,
}: {
  motionKey: string;
  onDone: (url?: string) => void;
}) {
  const { motion, error } = useRecording(motionKey);
  useEffect(() => {
    if (error) onDone();
  }, [error, onDone]);
  return createPortal(
    <div className="thumbnail-render-stage" aria-hidden="true" inert>
      {motion && (
        <Scene motion={motion} time={0} thumbnail onCapture={onDone} />
      )}
    </div>,
    document.body,
  );
}
export function SceneThumbnail({
  scenario,
  fallback,
}: {
  scenario: Scenario;
  fallback?: string;
}) {
  const key = scenario.motion;
  const [url, setUrl] = useState(key ? thumbnails.get(key) : undefined);
  const [active, setActive] = useState(false);
  const release = useRef<() => void>(() => {});
  const done = useCallback(
    (image?: string) => {
      if (image && key) {
        if (thumbnails.size >= 128)
          thumbnails.delete(thumbnails.keys().next().value!);
        thumbnails.set(key, image);
        setUrl(image);
      }
      setActive(false);
      release.current();
    },
    [key],
  );
  useEffect(() => {
    if (!key || thumbnails.has(key)) return;
    let acquired = false,
      released = false;
    const finish = () => {
      if (!acquired || released) return;
      released = true;
      busy = false;
      nextThumbnail();
    };
    release.current = finish;
    const start = () => {
      acquired = true;
      setActive(true);
    };
    queue.push(start);
    nextThumbnail();
    return () => {
      const index = queue.indexOf(start);
      if (index >= 0) queue.splice(index, 1);
      finish();
    };
  }, [key]);
  useEffect(() => {
    if (!active) return;
    const timeout = setTimeout(() => done(), 30000);
    return () => clearTimeout(timeout);
  }, [active, done]);
  return (
    <>
      {(url || fallback) && (
        <Image
          unoptimized
          width={640}
          height={480}
          src={url || fallback!}
          alt={`${url ? "Surgical rendering" : "Initial simulation"}: ${scenario.name}`}
          loading="lazy"
        />
      )}
      {active && key && <ThumbnailRender motionKey={key} onDone={done} />}
    </>
  );
}

export function SimulationPlayer({
  scenario,
  suite,
  run,
  label,
  time,
  playing,
  speed,
  videoRef,
  onTime,
  onDuration,
  onPlayingChange,
}: {
  scenario: Scenario;
  suite: Scenario[];
  run?: Run;
  label: string;
  time: number;
  playing: boolean;
  speed: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onTime?: (time: number) => void;
  onDuration: (duration: number) => void;
  onPlayingChange: (playing: boolean) => void;
}) {
  const [showGuides, setShowGuides] = useState(true);
  const insights = useMemo(
    () => scenarioInsights(scenario, suite),
    [scenario, suite],
  );
  const guide = useMemo(
    () => ({
      scenario,
      midpoint: Object.fromEntries(
        insights.parameters.map((p) => [p.key, p.midpoint]),
      ),
    }),
    [scenario, insights],
  );
  const [mode, setMode] = useState<"surgical" | "geometry" | "video">(
    "surgical",
  );
  const { motion, error } = useRecording(run ? run.motion : scenario.motion);
  useEffect(() => {
    if (motion && run) onDuration(motion.duration_s);
  }, [motion, run, onDuration]);
  const native =
    mode === "video" ||
    (!motion && (!!error || (run ? !run.motion : !scenario.motion)));
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !native) return;
    video.playbackRate = speed;
    if (Math.abs(video.currentTime - time) > 0.15) video.currentTime = time;
    if (playing) void video.play().catch(() => {});
    else video.pause();
  }, [playing, speed, time, native, videoRef]);
  return (
    <div className="video-panel">
      <div className="video-label">
        <span>{label}</span>
        <span>
          {run
            ? `${run.info.success ? "Success" : run.info.termination} · seed ${run.seed}`
            : "Initial state"}
        </span>
      </div>
      <div
        className="simulation-modes"
        role="group"
        aria-label={`${label} rendering`}
      >
        <button
          aria-pressed={mode === "surgical"}
          onClick={() => setMode("surgical")}
        >
          Surgical view
        </button>
        <button
          aria-pressed={mode === "geometry"}
          onClick={() => setMode("geometry")}
        >
          Simulation geometry
        </button>
        <button
          aria-pressed={showGuides}
          onClick={() => setShowGuides(!showGuides)}
        >
          {showGuides ? "Hide" : "Show"} condition guides
        </button>
        <button
          aria-pressed={mode === "video"}
          disabled={!run?.video}
          onClick={() => setMode("video")}
        >
          Original simulation
        </button>
      </div>
      <div className="generated-viewport" data-procedure-player>
        {native ? (
          run?.video ? (
            <video
              muted
              ref={videoRef}
              src={asset(run.video)}
              controls
              playsInline
              preload="metadata"
              onPlay={() => onPlayingChange(true)}
              onPause={(event) => {
                if (!event.currentTarget.ended) onPlayingChange(false);
              }}
              onSeeked={(event) => {
                if (Math.abs(event.currentTarget.currentTime - time) > 0.2)
                  onTime?.(event.currentTarget.currentTime);
              }}
              onLoadedMetadata={(event) =>
                onDuration(event.currentTarget.duration)
              }
              aria-label={`${label} simulation playback`}
              onTimeUpdate={(event) => {
                if (!playing) onTime?.(event.currentTarget.currentTime);
              }}
            />
          ) : (
            <div className="video-placeholder">
              <SceneThumbnail
                scenario={scenario}
                fallback={
                  scenario.thumbnail ? asset(scenario.thumbnail) : undefined
                }
              />
            </div>
          )
        ) : motion ? (
          <Scene
            key={mode}
            motion={motion}
            time={run ? Math.min(time, motion.duration_s) : 0}
            geometry={mode === "geometry"}
            guide={showGuides ? guide : undefined}
          />
        ) : (
          <span className="scene-loading">Loading surgical rendering…</span>
        )}
        {showGuides && (
          <div className="condition-overlay">
            <strong>
              Initial conditions · {scenario.id.replace("scene-", "Case ")}
            </strong>
            {insights.primary.map((p) => (
              <span key={p.key}>
                {p.label}: {formatParameter(p.value)} {p.unit}{" "}
                <small>
                  ({p.delta > 0 ? "+" : ""}
                  {formatParameter(p.delta)} vs midpoint)
                </small>
              </span>
            ))}
            {!native && motion && (
              <span className="condition-legend">
                <i /> Initial{" "}
                {scenario.task === "lifting"
                  ? "bounding outlines"
                  : "gap / needle circle"}{" "}
                <i className="reference" /> Range midpoint
              </span>
            )}
            <small>
              {scenario.task === "lifting"
                ? "Guides mark initial positions, not the transport trajectory."
                : "Guides mark initial dimensions. Spring stiffness affects dynamics, not visible shape."}
            </small>
          </div>
        )}
        <FullscreenButton />
        {run && motion && (
          <div className="fullscreen-playback">
            <button
              onClick={() => {
                if (motion && time >= motion.duration_s) onTime?.(0);
                onPlayingChange(!playing);
              }}
            >
              {playing ? "Pause" : "Play"}
            </button>
            <button
              onClick={() => {
                onPlayingChange(false);
                onTime?.(0);
              }}
            >
              Restart
            </button>
            <input
              aria-label={`${label} fullscreen time`}
              type="range"
              min={0}
              max={motion.duration_s}
              step={0.05}
              value={Math.min(time, motion.duration_s)}
              onChange={(event) => onTime?.(Number(event.target.value))}
            />
            <span>{time.toFixed(2)} s</span>
          </div>
        )}
      </div>
      {error && (
        <p className="rendering-note" role="status">
          {error}. Original simulation is available.
        </p>
      )}
      {run && !run.motion && (
        <p className="rendering-note">
          Surgical rendering is being prepared from this saved trajectory. The
          original recording remains available.
        </p>
      )}
    </div>
  );
}
