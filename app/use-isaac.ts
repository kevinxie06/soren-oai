"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppStreamer, StreamStats } from "@nvidia/ov-web-rtc";
import { errorMessage, parseConnection } from "../lib/connection.mjs";
import { parseState } from "../lib/simulation.mjs";

export type Connection = ReturnType<typeof parseConnection>;
export type SimState = {
  ready: boolean;
  running: boolean;
  demo: boolean;
  camera: string;
  scene: string;
  sim_time: number;
  joints: number[];
  joint_names: string[];
  capabilities: string[];
  updated_at: number;
};
type Phase = "idle" | "connecting" | "live" | "error";
type LogEntry = { id: number; time: string; message: string };

export function useIsaac() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [connection, setConnection] = useState<Connection | null>(null);
  const [state, setState] = useState<SimState | null>(null);
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [streamError, setStreamError] = useState("");
  const [controlError, setControlError] = useState("");
  const [pending, setPending] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const stream = useRef<AppStreamer | null>(null);
  const generation = useRef(0);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanup = useRef<Promise<unknown>>(Promise.resolve());
  const commandBusy = useRef(false);
  const logId = useRef(0);
  const log = useCallback((message: string) => {
    setLogs((items) =>
      [
        {
          id: ++logId.current,
          time: new Date().toLocaleTimeString([], { hour12: false }),
          message,
        },
        ...items,
      ].slice(0, 30),
    );
  }, []);

  const release = useCallback(() => {
    if (watchdog.current) clearTimeout(watchdog.current);
    watchdog.current = null;
    const previous = stream.current;
    stream.current = null;
    if (previous)
      cleanup.current = previous.terminate(false).catch(() => undefined);
    return cleanup.current;
  }, []);

  const disconnect = useCallback(() => {
    generation.current++;
    void release();
    setConnection(null);
    setPhase("idle");
    setState(null);
    setStats(null);
    setStreamError("");
    setControlError("");
    log("Viewer disconnected. The simulator continues on the GPU host.");
  }, [log, release]);

  useEffect(
    () => () => {
      generation.current++;
      void release();
    },
    [release],
  );

  const connect = useCallback(
    async (config: Connection) => {
      const attempt = ++generation.current;
      const current = () => attempt === generation.current;
      setPhase("connecting");
      setState(null);
      setStats(null);
      setStreamError("");
      setControlError("");
      setConnection(config);
      log(`Connecting to ${config.host}:${config.signalingPort}.`);
      await release();
      if (!current()) return;
      try {
        if (!window.RTCPeerConnection)
          throw new Error(
            "WebRTC is unavailable. Open this app in Chrome or Edge.",
          );
        if (window.location.protocol === "https:" && !config.secure)
          throw new Error(
            "This local connector uses HTTP signaling. Open the app at http://localhost:3000.",
          );
        // The SDK accesses browser globals; never import it during server rendering.
        const { AppStreamer, StreamType, LogLevel, EventStatus, StreamStatus } =
          await import("@nvidia/ov-web-rtc");
        if (!current()) return;
        const instance = new AppStreamer();
        stream.current = instance;
        const fail = (message: string) => {
          if (!current()) return;
          generation.current++;
          setPhase("error");
          setStreamError(message);
          setStats(null);
          log(message);
          void release();
        };
        watchdog.current = setTimeout(
          () =>
            fail(
              "No video arrived within 45 seconds. Wait for Isaac Sim to finish loading, verify TCP 49100 / UDP 47998, and reconnect.",
            ),
          45000,
        );
        await instance.connect({
          streamSource: StreamType.DIRECT,
          logLevel: LogLevel.WARN,
          streamConfig: {
            signalingServer: config.host,
            signalingPort: config.signalingPort,
            signalingPath: config.signalingPath,
            forceWSS: config.secure,
            mediaServer: config.host,
            mediaPort: config.mediaPort,
            videoElementId: "isaac-video",
            audioElementId: "isaac-audio",
            width: config.width,
            height: config.height,
            fps: 30,
            autoLaunch: true,
            mic: false,
            cursor: "free",
            nativeTouchEvents: true,
            maxReconnects: 2,
            connectivityTimeout: 10000,
            onStart: (event) => {
              if (!current()) return;
              if (event.status === EventStatus.SUCCESS)
                log("WebRTC connected. Waiting for decoded video.");
              if (event.status === EventStatus.ERROR) fail(errorMessage(event));
            },
            onStop: () =>
              fail("The stream stopped. Check the GPU host, then reconnect."),
            onStreamStatusChange: (status) => {
              if (status === StreamStatus.STOPPED)
                fail(
                  "The stream disconnected. Check the GPU host, then reconnect.",
                );
            },
            onStreamStats: (event) => {
              if (current()) setStats(event.data.stats);
            },
          },
        });
        if (!current() && stream.current !== instance)
          await instance.terminate(false).catch(() => undefined);
      } catch (error) {
        if (!current()) return;
        generation.current++;
        const message = errorMessage(error);
        setPhase("error");
        setStreamError(message);
        log(message);
        void release();
      }
    },
    [log, release],
  );

  const videoPlaying = useCallback(() => {
    if (!stream.current) return;
    if (watchdog.current) clearTimeout(watchdog.current);
    watchdog.current = null;
    setPhase("live");
    setStreamError("");
  }, []);

  // Recursive polling prevents overlapping requests; cleanup aborts in-flight work.
  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    const poll = async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const response = await fetch(`${connection.controlUrl}/state`, {
          headers: { Authorization: `Bearer ${connection.token}` },
          signal: controller.signal,
        });
        if (response.status === 401)
          throw new Error(
            "Enter the control token printed by the Isaac Sim launcher.",
          );
        if (!response.ok)
          throw new Error(`Control API returned ${response.status}.`);
        const next: SimState = parseState(await response.json());
        if (!next.ready) throw new Error("The scene is still loading.");
        if (Date.now() / 1000 - next.updated_at > 5)
          throw new Error(
            "The simulation heartbeat is stale. Check the GPU host.",
          );
        if (!cancelled) {
          setState(next);
          setControlError("");
        }
      } catch (error) {
        if (!cancelled) {
          setState(null);
          setControlError(
            error instanceof TypeError ||
              (error instanceof Error && error.name === "AbortError")
              ? `Control API unavailable at ${connection.controlUrl}. Check the launcher, token, and allowed origin.`
              : errorMessage(error),
          );
        }
      } finally {
        clearTimeout(timeout);
        if (!cancelled) timer = setTimeout(poll, 1000);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [connection]);

  const command = useCallback(
    async (action: string, payload: Record<string, unknown> = {}) => {
      if (!connection || !state || commandBusy.current) return;
      const activeConnection = connection;
      const attempt = generation.current;
      commandBusy.current = true;
      setPending(true);
      try {
        const response = await fetch(`${activeConnection.controlUrl}/command`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${activeConnection.token}`,
          },
          body: JSON.stringify({ action, ...payload }),
          signal: AbortSignal.timeout(8000),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error || `Command failed (${response.status}).`,
          );
        if (generation.current === attempt) {
          setState(parseState(result.state));
          log(`${action.replaceAll("_", " ")} confirmed by Isaac Sim.`);
        }
      } catch (error) {
        if (generation.current === attempt)
          log(`Command failed: ${errorMessage(error)}`);
      } finally {
        commandBusy.current = false;
        setPending(false);
      }
    },
    [connection, state, log],
  );

  return {
    phase,
    connection,
    state,
    stats,
    streamError,
    controlError,
    pending,
    logs,
    connect,
    disconnect,
    command,
    videoPlaying,
  };
}
