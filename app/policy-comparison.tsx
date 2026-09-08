"use client";
import { useEffect, useState } from "react";
import "./policy-comparison.css";

export type PolicyVersion = "current" | "old";
type Scores = { current: { successes: number; episodes: number }; old: { successes: number; episodes: number } };

export default function PolicyComparison({ task, value, onChange }: {
  task: "heart" | "stitch"; value: PolicyVersion; onChange: (value: PolicyVersion) => void;
}) {
  const [scores, setScores] = useState<Scores | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/motion/${task}-comparison.json`, { signal: controller.signal }).then((r) => {
      if (!r.ok) throw new Error("Comparison unavailable"); return r.json() as Promise<Scores>;
    }).then(setScores).catch(() => {});
    return () => controller.abort();
  }, [task]);
  return <div className="policy-comparison">
    <div className="policy-version-options" role="group" aria-label="Policy version">
      {([['current', 'Current version'], ['old', 'Old version']] as const).map(([id, label]) =>
        <button key={id} aria-pressed={value === id} onClick={() => { if (id !== value) onChange(id); }}>
          {label}{scores && <span>{scores[id].successes}/{scores[id].episodes} successful scenes</span>}
        </button>)}
    </div>
  </div>;
}
