"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  Box,
  Cable,
  Camera,
  Check,
  ChevronRight,
  CircleHelp,
  Cpu,
  Expand,
  Link2,
  LoaderCircle,
  Monitor,
  Pause,
  Play,
  Power,
  Radio,
  RotateCcw,
  Settings2,
  Terminal,
  Unplug,
  Video,
} from "lucide-react";
import { DEFAULT_CONNECTION, parseConnection } from "../lib/connection.mjs";
import { useIsaac } from "./use-isaac";

const cameras = [
  { id: "overview", label: "Overview" },
  { id: "workbench", label: "Workbench" },
  { id: "top", label: "Top view" },
];

export default function Studio() {
  const sim = useIsaac();
  const [form, setForm] = useState({
    ...DEFAULT_CONNECTION,
    host: process.env.NEXT_PUBLIC_ISAAC_GPU_HOST || DEFAULT_CONNECTION.host,
    token: process.env.NEXT_PUBLIC_ISAAC_CONTROL_TOKEN || DEFAULT_CONNECTION.token,
  });
  const [formError, setFormError] = useState("");
  const [help, setHelp] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  const viewport = useRef<HTMLDivElement>(null);
  const hostInput = useRef<HTMLInputElement>(null);
  const busy = sim.phase === "connecting" || sim.phase === "live";
  const disabled = !sim.state || sim.pending;
  const update = (name: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [name]: value }));
  const connect = () => {
    try {
      const config = parseConnection(form);
      setFormError("");
      void sim.connect(config);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Check the connection settings.",
      );
    }
  };
  const metric = (value: number | undefined) =>
    Number.isFinite(value) ? value!.toFixed(1) : "—";

  return (
    <div className="studio">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="Soren Isaac Studio home">
          <span className="brand-mark">
            <Box size={21} strokeWidth={1.7} />
          </span>
          soren
          <span className="brand-divider" />
          <span className="brand-product">Isaac Studio</span>
          <span className="version">LOCAL</span>
        </Link>
        <div className="top-actions">
          <Link href="/showcase" className="host-badge">Heart policy showcase ?</Link>
          <span className="host-badge">
            <Monitor size={13} /> Local workspace
          </span>
          <button
            className="icon-button"
            onClick={() => setHelp(!help)}
            aria-label="Toggle setup guide"
            aria-expanded={help}
          >
            <CircleHelp size={18} />
          </button>
        </div>
      </header>
      <main>
        <div className="page-heading">
          <div>
            <div className="breadcrumb">
              Workspace <ChevronRight size={12} /> Robot environment
            </div>
            <h1>
              Simulation workspace
              <span className="heading-dot" />
            </h1>
            <p>
              Explore your environment. Observe your robot. Control the
              simulation.
            </p>
          </div>
          <button className="secondary" onClick={() => setHelp(!help)}>
            <Terminal size={15} /> Setup guide <ArrowUpRight size={14} />
          </button>
        </div>
        {help && (
          <section className="setup-guide" aria-label="Setup guide">
            <div>
              <span className="eyebrow">GET CONNECTED</span>
              <h2>One simulator. Your own interface.</h2>
              <p>
                Run Isaac Sim 6.0.1 on an Ubuntu machine with an NVIDIA RTX GPU.
                This web app can run on that machine or on your Mac.
              </p>
            </div>
            <ol>
              <li>
                <strong>Start the GPU host</strong>
                <code>
                  ISAAC_SIM_PATH=/path/to/isaac-sim bash scripts/start-sim.sh
                  --public-ip GPU_IP
                </code>
              </li>
              <li>
                <strong>Connect this workspace</strong>
                <span>
                  Enter the GPU IP and the control token printed by the
                  launcher. On a second machine, add{" "}
                  <code>--control-host 0.0.0.0</code> to the launcher.
                </span>
              </li>
              <li>
                <strong>See the live environment</strong>
                <span>
                  Wait for “Scene ready,” then connect. Allow TCP 49100, UDP
                  47998, and TCP 8211 on your trusted network. Full instructions
                  are in the project README.
                </span>
              </li>
            </ol>
          </section>
        )}
        <div className="workspace-grid">
          <section className="main-column" aria-label="Simulation viewer">
            <div className="viewer-panel">
              <div className="panel-toolbar">
                <div className="panel-title">
                  <Video size={16} />
                  <span>Environment viewport</span>
                </div>
                <div className={`connection-pill ${sim.phase}`} role="status">
                  <span />
                  {sim.phase === "live"
                    ? "Live stream"
                    : sim.phase === "connecting"
                      ? "Connecting"
                      : sim.phase === "error"
                        ? "Connection interrupted"
                        : "Not connected"}
                </div>
              </div>
              <div
                className={`viewport ${sim.phase === "live" ? "has-video" : ""}`}
                ref={viewport}
              >
                <video
                  id="isaac-video"
                  autoPlay
                  playsInline
                  muted
                  tabIndex={0}
                  aria-label="Live Isaac Sim environment"
                  onPlaying={sim.videoPlaying}
                />
                <audio id="isaac-audio" autoPlay muted />
                {sim.phase !== "live" && (
                  <div className="viewport-empty">
                    <div className="viewport-grid" aria-hidden="true" />
                    <div className="empty-content">
                      <div className="environment-icon">
                        {sim.phase === "connecting" ? (
                          <LoaderCircle size={32} className="spin" />
                        ) : (
                          <Box size={34} strokeWidth={1.2} />
                        )}
                      </div>
                      <span className="eyebrow">NVIDIA ISAAC SIM · WEBRTC</span>
                      <h2>
                        {sim.phase === "connecting"
                          ? "Connecting to your environment"
                          : sim.phase === "error"
                            ? "Let’s get you reconnected"
                            : "Your robot environment, live."}
                      </h2>
                      <p>
                        {sim.streamError ||
                          (sim.phase === "connecting"
                            ? "Establishing a stream from the GPU host. The first launch can take a few minutes."
                            : "Connect to an Isaac Sim host to explore the scene and control your simulation from this workspace.")}
                      </p>
                      {sim.phase === "connecting" ? (
                        <button className="secondary" onClick={sim.disconnect}>
                          Cancel connection
                        </button>
                      ) : (
                        <button
                          className="primary"
                          onClick={() => {
                            hostInput.current?.focus();
                            hostInput.current?.scrollIntoView({
                              block: "nearest",
                              behavior: "smooth",
                            });
                          }}
                        >
                          <Link2 size={15} /> Configure connection{" "}
                          <ChevronRight size={14} />
                        </button>
                      )}
                      <span className="empty-caption">
                        Live rendering requires a running NVIDIA GPU host.
                      </span>
                    </div>
                    <div className="viewport-coordinate" aria-hidden="true">
                      <span className="axis-z">Z</span>
                      <span className="axis-y">Y</span>
                      <span className="axis-x">X</span>
                    </div>
                  </div>
                )}
                {sim.phase === "live" && (
                  <span className="live-overlay">
                    <span /> LIVE · ISAAC SIM
                  </span>
                )}
              </div>
              <div className="viewport-footer">
                <span>
                  <Radio size={13} />{" "}
                  {sim.phase === "live"
                    ? "Click the viewport to interact"
                    : "Waiting for a live video source"}
                </span>
                <button
                  className="icon-button"
                  disabled={sim.phase !== "live"}
                  aria-label="Enter fullscreen"
                  onClick={() => {
                    void viewport.current
                      ?.requestFullscreen()
                      .catch(() =>
                        setFullscreenError(
                          "Fullscreen is unavailable in this browser.",
                        ),
                      );
                  }}
                >
                  <Expand size={16} />
                </button>
              </div>
            </div>
            {fullscreenError && (
              <p className="error-note" role="alert">
                {fullscreenError}
              </p>
            )}
            <div className="playback-panel">
              <div className="playback-actions">
                <button
                  className="primary compact"
                  disabled={disabled}
                  onClick={() =>
                    void sim.command(sim.state?.running ? "pause" : "play")
                  }
                >
                  {sim.state?.running ? (
                    <Pause size={16} />
                  ) : (
                    <Play size={16} />
                  )}
                  {sim.state?.running ? "Pause" : "Play"}
                </button>
                <button
                  className="secondary compact"
                  disabled={disabled}
                  onClick={() => void sim.command("reset")}
                >
                  <RotateCcw size={14} /> Reset
                </button>
                <span className="playback-divider" />
                <label className="demo-toggle">
                  <input
                    type="checkbox"
                    checked={sim.state?.demo ?? false}
                    disabled={
                      disabled || !sim.state?.capabilities.includes("demo")
                    }
                    onChange={(event) =>
                      void sim.command("set_demo", {
                        enabled: event.target.checked,
                      })
                    }
                  />
                  <span>Robot motion</span>
                </label>
              </div>
              <div className="sim-clock">
                <span>SIMULATION TIME</span>
                <strong>
                  {sim.state ? `${sim.state.sim_time.toFixed(2)} s` : "—"}
                </strong>
              </div>
            </div>
            <div className="metrics">
              <div>
                <span>
                  <Activity size={14} /> Stream FPS
                </span>
                <strong>
                  {metric(sim.stats?.fps)}
                  <small>fps</small>
                </strong>
              </div>
              <div>
                <span>
                  <Cable size={14} /> Round-trip latency
                </span>
                <strong>
                  {metric(sim.stats?.rtd)}
                  <small>ms</small>
                </strong>
              </div>
              <div>
                <span>
                  <Monitor size={14} /> Stream resolution
                </span>
                <strong>
                  {sim.stats
                    ? `${sim.stats.streamingResolutionWidth} × ${sim.stats.streamingResolutionHeight}`
                    : "—"}
                </strong>
              </div>
              <div>
                <span>
                  <Radio size={14} /> Video bitrate
                </span>
                <strong>
                  {metric(sim.stats?.currentBitrate)}
                  <small>Mbps</small>
                </strong>
              </div>
            </div>
            <section className="activity-panel">
              <div className="section-header">
                <h2>
                  <Terminal size={15} /> Session activity
                </h2>
                <span>THIS SESSION</span>
              </div>
              <div
                className="activity-list"
                role="log"
                aria-live="polite"
                aria-relevant="additions"
              >
                {sim.logs.length ? (
                  sim.logs.map((entry) => (
                    <div className="log-entry" key={entry.id}>
                      <time>{entry.time}</time>
                      <span>{entry.message}</span>
                    </div>
                  ))
                ) : (
                  <div className="activity-empty">
                    <span className="tiny-dot" /> Connection and control events
                    will appear here.
                  </div>
                )}
              </div>
            </section>
          </section>
          <aside className="side-column">
            <section className="settings-panel">
              <div className="section-header">
                <h2>
                  <Settings2 size={16} /> Connection
                </h2>
                <span>DIRECT</span>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!busy) connect();
                }}
              >
                <label className="field">
                  GPU host
                  <input
                    ref={hostInput}
                    value={form.host}
                    onChange={(event) => update("host", event.target.value)}
                    placeholder="192.168.1.50"
                    disabled={busy}
                    required
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <p className="field-help">
                  Use 127.0.0.1 if Isaac Sim runs on this machine.
                </p>
                <label className="field">
                  Control token
                  <input
                    type="password"
                    value={form.token}
                    onChange={(event) => update("token", event.target.value)}
                    placeholder="Paste token from the launcher"
                    disabled={busy}
                    autoComplete="off"
                  />
                </label>
                <label className="field">
                  Requested quality
                  <select
                    value={form.quality}
                    onChange={(event) => update("quality", event.target.value)}
                    disabled={busy}
                  >
                    <option value="1080">1080p · 30 fps</option>
                    <option value="720">720p · 30 fps</option>
                  </select>
                </label>
                <details className="advanced">
                  <summary>Advanced connection settings</summary>
                  <div className="port-fields">
                    <label className="field">
                      Signaling · TCP
                      <input
                        inputMode="numeric"
                        value={form.signalingPort}
                        onChange={(event) =>
                          update("signalingPort", event.target.value)
                        }
                        disabled={busy}
                      />
                    </label>
                    <label className="field">
                      Media · UDP
                      <input
                        inputMode="numeric"
                        value={form.mediaPort}
                        onChange={(event) =>
                          update("mediaPort", event.target.value)
                        }
                        disabled={busy}
                      />
                    </label>
                    <label className="field">
                      Control · TCP
                      <input
                        inputMode="numeric"
                        value={form.controlPort}
                        onChange={(event) =>
                          update("controlPort", event.target.value)
                        }
                        disabled={busy}
                      />
                    </label>
                  </div>
                </details>
                {formError && (
                  <p className="error-note" role="alert">
                    {formError}
                  </p>
                )}
                {busy ? (
                  <button
                    type="button"
                    className="secondary full"
                    onClick={sim.disconnect}
                  >
                    <Unplug size={15} />
                    {sim.phase === "connecting"
                      ? "Cancel connection"
                      : "Disconnect"}
                  </button>
                ) : (
                  <button type="submit" className="primary full">
                    <Power size={15} />
                    {sim.phase === "error"
                      ? "Reconnect to Isaac Sim"
                      : "Connect to Isaac Sim"}
                  </button>
                )}
              </form>
              <div className="connection-status">
                <div>
                  <span
                    className={`tiny-dot ${sim.phase === "live" ? "green" : ""}`}
                  />{" "}
                  Video stream{" "}
                  <strong>
                    {sim.phase === "live"
                      ? "Connected"
                      : sim.phase === "connecting"
                        ? "Connecting"
                        : "Offline"}
                  </strong>
                </div>
                <div>
                  <span className={`tiny-dot ${sim.state ? "green" : ""}`} />{" "}
                  Control API{" "}
                  <strong>
                    {sim.state
                      ? "Ready"
                      : sim.connection
                        ? "Unavailable"
                        : "Offline"}
                  </strong>
                </div>
              </div>
              {sim.controlError && (
                <p className="error-note control-error">{sim.controlError}</p>
              )}
            </section>
            <section className="camera-panel">
              <div className="section-header">
                <h2>
                  <Camera size={16} /> Camera views
                </h2>
                <span>03</span>
              </div>
              <div className="camera-list">
                {cameras.map((camera, index) => (
                  <button
                    key={camera.id}
                    className={`camera-option ${sim.state?.camera === camera.id ? "selected" : ""}`}
                    disabled={disabled}
                    onClick={() =>
                      void sim.command("set_camera", { camera: camera.id })
                    }
                  >
                    <span className="camera-number">0{index + 1}</span>
                    <span>{camera.label}</span>
                    {sim.state?.camera === camera.id ? (
                      <Check size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                  </button>
                ))}
              </div>
            </section>
            <section className="robot-panel">
              <div className="section-header">
                <h2>
                  <Cpu size={16} /> Robot state
                </h2>
                <span>LIVE</span>
              </div>
              {sim.state ? (
                <>
                  <div className="robot-name">
                    <span className="tiny-dot green" />
                    <strong>{sim.state.scene}</strong>
                    <span>{sim.state.running ? "Running" : "Paused"}</span>
                  </div>
                  {sim.state.joints.length > 0 ? (
                    <div className="joint-list">
                      {sim.state.joints.map((position, index) => (
                        <div key={sim.state!.joint_names[index]}>
                          <span>{sim.state!.joint_names[index]}</span>
                          <strong>
                            {position.toFixed(3)}
                            <small>
                              {sim.state!.joint_names[index].includes("finger")
                                ? "m"
                                : "rad"}
                            </small>
                          </strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="small-note">
                      Custom environment loaded. Robot telemetry is available
                      for the included Franka scene.
                    </p>
                  )}
                </>
              ) : (
                <div className="robot-empty">
                  <Cpu size={23} strokeWidth={1.2} />
                  <p>
                    Joint positions and simulation state appear when the control
                    API connects.
                  </p>
                </div>
              )}
            </section>
            <div className="local-note">
              <Link2 size={14} />
              <p>
                Video is rendered on your GPU host. This workspace displays the
                live stream.
              </p>
            </div>
          </aside>
        </div>
        <footer className="page-footer">
          <span>
            <span className="tiny-dot" /> Soren Isaac Studio
          </span>
          <span>Local development · Isaac Sim 6.0.1 · WebRTC</span>
        </footer>
      </main>
    </div>
  );
}
