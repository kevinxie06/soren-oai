import { formatParameter, scenarioInsights } from "@/lib/scenario-insights";
import type { Plan, Scenario } from "@/lib/types";

export function ScenarioFingerprint({
  scenario,
  suite,
}: {
  scenario: Scenario;
  suite: Scenario[];
}) {
  const info = scenarioInsights(scenario, suite);
  return (
    <div className="scenario-fingerprint" aria-label="Environment conditions">
      {(info.varying.length ? info.varying : info.parameters).map((p) => (
        <div key={p.key}>
          <span>
            {p.short}{" "}
            <b>
              {formatParameter(p.value)} {p.unit}
            </b>
          </span>
          <span className="parameter-track" aria-hidden="true">
            <i style={{ left: `${p.position * 100}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

export function ScenarioExplanation({
  scenario,
  plan,
}: {
  scenario: Scenario;
  plan: Plan;
}) {
  const info = scenarioInsights(scenario, plan.scenarios);
  const generatedByModel = plan.model !== "deterministic";
  return (
    <section className="scenario-explanation detail-panel">
      <div className="section-heading">
        <h2>Why this environment?</h2>
        <span className="pill">{info.role}</span>
      </div>
      <p>{info.rationale}</p>
      {generatedByModel && (
        <div className="planner-reason">
          <strong>Planner’s stated rationale</strong>
          <p>{scenario.name}</p>
          <p>{scenario.rationale}</p>
        </div>
      )}
      <p className="scenario-evidence">
        {generatedByModel
          ? `Proposed by ${plan.provider}.`
          : "Selected by systematic parameter coverage."}{" "}
        Expected sensitivities are hypotheses; episode results establish
        observed behavior.
      </p>
      <h3>What to look for</h3>
      <ul>
        {info.observations.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
      <h3>What changes in this case</h3>
      <p>
        The reference is the midpoint of{" "}
        {scenario.training_bounds
          ? "the reviewed ranges"
          : "this suite’s parameter ranges"}
        , not a tested baseline policy or a separate rollout.
      </p>
      <div className="scenario-differences">
        <table>
          <thead>
            <tr>
              <th>Parameter</th>
              <th>This case</th>
              <th>Midpoint</th>
              <th>Difference</th>
              <th>Coverage</th>
            </tr>
          </thead>
          <tbody>
            {info.parameters.map((p) => (
              <tr key={p.key} className={p.varying ? "varied" : "fixed"}>
                <th scope="row">{p.label}</th>
                <td>
                  {formatParameter(p.value)} {p.unit}
                </td>
                <td>
                  {formatParameter(p.midpoint)} {p.unit}
                </td>
                <td>
                  {p.delta > 0 ? "+" : ""}
                  {formatParameter(p.delta)} {p.unit}
                </td>
                <td>{p.location}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
