"use client";
import { useEffect, useRef, useState } from "react";
import type { ExperimentDetail, Job, Outcome, RewardSpec, Scenario } from "@/lib/types";
import "./manual-control.css";

type Command = number[] | null;
type Result = { image: string; info: Outcome; terminal: boolean; manual_steps: number; executed_steps: number };
async function request<T>(path: string, body?: unknown) {
  const r = await fetch("/api/lab" + path, body === undefined ? {cache:"no-store"} : {
    method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body),
  });
  const value = await r.json();
  if (!r.ok) throw new Error((value as {error?: string}).error || "Request failed");
  return value as T;
}
export default function ManualControl({experimentId, scenario, reward}: {
  experimentId: string; scenario: Scenario; reward: RewardSpec;
}) {
  const lifting = scenario.task === "lifting";
  const [open, setOpen] = useState(false), [commands, setCommands] = useState<Command[]>([]);
  const [pending, setPending] = useState(false), [jobId, setJobId] = useState("");
  const [result, setResult] = useState<Result | null>(null), [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [repeat, setRepeat] = useState(5), [strength, setStrength] = useState(0.5);
  const [grip, setGrip] = useState(-1), [donor, setDonor] = useState(1), [receiver, setReceiver] = useState(-1), [tension, setTension] = useState(0);
  const [weights, setWeights] = useState<RewardSpec>({...reward});
  const mounted = useRef(true), locked = useRef(false);
  useEffect(() => { mounted.current = true; return () => {mounted.current = false;}; }, []);
  async function wait(id: string): Promise<Job> {
    while (mounted.current) {
      const detail: ExperimentDetail = await request<ExperimentDetail>(`/experiments/${experimentId}`);
      const job = detail.jobs.find(j => j.id === id);
      if (job?.status === "completed") return job;
      if (job?.status === "failed" || job?.status === "cancelled") throw new Error(job.error || job.message || job.status);
      if (job) setMessage(job.message || "Waiting for simulation worker…");
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error("Control panel closed");
  }
  async function step(action: Command, reset = false) {
    if (locked.current) return;
    locked.current = true; setPending(true); setError("");
    const next = reset ? [null] : [...commands, ...Array.from({length:repeat}, () => action)];
    try {
      const {job_id} = await request<{job_id: string}>(`/experiments/${experimentId}/jobs`, {kind:"manual", scenario_id:scenario.id, commands:next});
      const job = await wait(job_id);
      if (!mounted.current) return;
      const r = job.result as unknown as Result;
      setCommands(next.slice(0, r.executed_steps)); setResult(r); setJobId(job_id);
      setMessage(r.info.success ? "Simulation succeeded. Ready to update." : r.terminal ? `Attempt ended: ${r.info.termination}. Reset to retry.` : `${r.executed_steps} steps · operator control`);
    } catch (e) { if (mounted.current) setError((e as Error).message); }
    finally {locked.current = false; if (mounted.current) setPending(false);}
  }
  function jog(axis = -1, direction = 0) {
    const action = lifting ? [0,0,0,grip] : [0,0,0,0,donor,receiver,tension];
    if (axis >= 0) action[axis] = direction * strength;
    void step(action);
  }
  async function restore() {
    if (locked.current) return;
    locked.current = true; setPending(true); setError("");
    try {
      const detail = await request<ExperimentDetail>(`/experiments/${experimentId}`);
      const job = detail.jobs.find(j => j.kind === "manual" && j.status === "completed" && j.data.scenario_id === scenario.id);
      if (!job?.result || !job.data.commands) throw new Error("No saved attempt for this environment yet.");
      if (!mounted.current) return;
      const r = job.result as unknown as Result;
      setCommands(job.data.commands.slice(0,r.executed_steps)); setJobId(job.id); setResult(r);
      setMessage(r.info.success ? "Successful attempt restored. Ready to update." : "Last attempt restored. Continue or reset.");
    } catch (e) {if (mounted.current) setError((e as Error).message);}
    finally {locked.current = false; if (mounted.current) setPending(false);}
  }
  async function update() {
    if (locked.current) return;
    locked.current = true; setPending(true); setError("");
    try {
      const detail: ExperimentDetail = await request<ExperimentDetail>(`/experiments/${experimentId}`);
      const resume = detail.jobs.some(j => j.kind === "train" && j.status === "completed");
      const {job_id} = await request<{job_id: string}>(`/experiments/${experimentId}/jobs`, {
        kind:"train", correction_job_id:jobId, reward:weights, steps:1024, resume,
      });
      await wait(job_id);
      if (mounted.current) setMessage("Updated candidate saved. Evaluate it in Compare to check whether it improved.");
    } catch (e) {if (mounted.current) setError((e as Error).message);}
    finally {locked.current = false; if (mounted.current) setPending(false);}
  }
  return <section className="manual-control">
    <button onClick={() => setOpen(!open)} aria-expanded={open}>Manual operator control {open ? "−" : "+"}</button>
    {open && <>
      <p>Advance the baseline or move the robot yourself. Each click runs real simulation steps. Attempts are saved automatically.</p>
      {result?.image && <img src={`/api/lab/artifacts/${result.image}`} alt="Current operator-controlled simulation state" />}
      <fieldset disabled={pending}>
        <div className="manual-row">
          <button onClick={() => void step(null, true)}>Reset attempt</button>
          <button onClick={() => void restore()}>Restore last attempt</button>
          <button disabled={!!result?.terminal || commands.length + repeat > 500} onClick={() => void step(null)}>Advance policy</button>
          <label>Steps <input type="number" min={1} max={20} value={repeat} onChange={e => setRepeat(Math.max(1,Math.min(20,Number(e.target.value) || 1)))} /></label>
          <label>Movement <input type="range" min={0.1} max={1} step={0.1} value={strength} onChange={e => setStrength(Number(e.target.value))} /></label>
        </div>
        <fieldset disabled={!!result?.terminal || commands.length + repeat > 500}>
          <div className="manual-row">{["X", "Y", "Z", ...(lifting ? [] : ["Rotation"])].map((name, axis) => <span key={name}>
            <button aria-label={`${name} minus`} onClick={() => jog(axis,-1)}>{name} −</button>
            <button aria-label={`${name} plus`} onClick={() => jog(axis,1)}>{name} +</button>
          </span>)}</div>
          <div className="manual-row">{(lifting ? [["Gripper", grip, setGrip] as const] : [["Donor", donor, setDonor] as const, ["Receiver", receiver, setReceiver] as const]).map(([name,value,set]) => <label key={name}>{name} <select value={value} onChange={e => set(Number(e.target.value))}><option value={-1}>Open</option><option value={1}>Closed</option></select></label>)}
            {!lifting && <label>Thread tension <input type="range" min={0} max={1} step={0.05} value={tension} onChange={e => setTension(Number(e.target.value))} /></label>}
            <button onClick={() => jog()}>Apply grippers / hold</button>
          </div>
        </fieldset>
        <details><summary>Reward weights for update</summary><div className="manual-row">{Object.entries(weights).map(([key,value]) => <label key={key}>{key}<input type="number" min={key === "completion" ? 1 : 0} max={key === "smoothness" ? 1 : ["completion","failure"].includes(key) ? 100 : 10} step={0.01} value={value} onChange={e => setWeights({...weights,[key]:Number(e.target.value)})} /></label>)}</div></details>
        <p>Update learns from your successful manual actions, then runs 1,024 PPO steps with these weights. Complete baseline evaluation first.</p>
        <button className="primary" disabled={!result?.info.success || !result.manual_steps} onClick={() => void update()}>Update from successful attempt</button>
      </fieldset>
      <p role="status">{pending ? "Working… " : ""}{message}</p>
      {error && <p role="alert">{error}</p>}
    </>}
  </section>;
}
