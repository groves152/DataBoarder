import { useEffect, useState } from "react";
import { linearChain, usePipelineStore } from "@/stores/pipelineStore";
import {
  OBJECTIVE_LABELS, WEIGHT_MAX, WEIGHT_MIN, activeWeights, clampWeight, useOptimizeStore,
} from "@/stores/optimizeStore";
import { ScalarPanel } from "./ScalarPanel";

// The side panel's "Optimize" tab: tune the toggled knobs of the current chain
// toward the weighted objectives (server: forge_genie's optimizer). Toggle
// knobs with the ◎ next to a param in the inspector. The basic settings pick
// the search and its budget; the descent's own settings sit under "Advanced".

const RUNNING = new Set(["starting", "simulating", "compiling", "running", "refining", "rounding", "refreshing temperatures",
  "verifying"]);

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="border-b border-border px-3 py-2">
      <div className="flex items-center mb-1.5">
        <span className="text-[10px] uppercase tracking-wide text-gray-500">{title}</span>
        <div className="ml-auto flex gap-1">{right}</div>
      </div>
      {children}
    </div>
  );
}

const smallBtn =
  "text-[10px] px-1.5 py-0.5 rounded border border-border text-gray-300 hover:border-accent hover:text-gray-100 transition-colors disabled:opacity-40";
const field = "bg-surface border border-border rounded px-1 py-0.5 text-gray-200 tabular-nums disabled:opacity-40";

function formatWeight(w: number): string {
  return w >= 0.1 ? String(Number(w.toPrecision(2))) : w.toExponential(1);
}

// A weight on a log scale (1e-3 .. 1): slider, plus a text field that takes
// any number ("0.1", "5e-3") and commits on Enter / leaving the field.
function WeightControl({ value, disabled, onChange }: {
  value: number; disabled: boolean; onChange: (w: number) => void;
}) {
  const [draft, setDraft] = useState(formatWeight(value));
  useEffect(() => setDraft(formatWeight(value)), [value]);
  const commit = () => {
    const w = Number(draft.trim());
    if (Number.isFinite(w) && w > 0) onChange(clampWeight(w));
    else setDraft(formatWeight(value));
  };
  return (
    <div className="flex items-center gap-1.5 ml-auto">
      <input
        type="range" min={Math.log10(WEIGHT_MIN)} max={Math.log10(WEIGHT_MAX)} step={0.05}
        value={Math.log10(clampWeight(value))} disabled={disabled}
        onChange={(e) => onChange(clampWeight(10 ** Number(e.target.value)))}
        className="w-20 accent-accent disabled:opacity-40" aria-label="weight (log scale)"
      />
      <input
        type="text" inputMode="decimal" value={draft} disabled={disabled} aria-label="weight"
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className={`w-14 ${field}`}
      />
    </div>
  );
}

export function OptimizePanel() {
  const { nodes, edges, goalName, pathMetadata, selectedNodeId } = usePipelineStore();
  const {
    knobs, objectives, settings, session, status, error, original,
    toggleKnob, toggleAllOn, clearKnobs, setObjective, setSettings, start, stop, newSession, applyBest, revert,
  } = useOptimizeStore();
  const [advanced, setAdvanced] = useState(false);

  const label = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    const l = n?.data.params.label;
    return typeof l === "string" && l ? l : n?.data.kind ?? id;
  };
  const running = status ? RUNNING.has(status.state) : false;
  const challenge = typeof pathMetadata?.challenge === "string" ? (pathMetadata.challenge as string) : null;
  const selected = nodes.filter((n) => n.selected).map((n) => n.id);
  const targets = selected.length ? selected : selectedNodeId ? [selectedNodeId] : [];
  // the server reports knobs by step position in the path (root excluded)
  const chain = linearChain(nodes, edges) ?? [];
  const keyOf = (nodeId: string, param: string) => `${chain.indexOf(nodeId) - 1}:${param}`;
  const bestByKey = new Map((status?.best_knobs ?? []).map((k) => [`${k.index}:${k.param}`, k]));
  const sensByKey = new Map((status?.sensitivity ?? []).map((s) => [`${s.index}:${s.param}`, s]));
  const maxEffect = Math.max(1e-12, ...(status?.sensitivity ?? []).map((s) => s.effect));
  const locked = !!session; // objectives are fixed for a session's runs
  const shown = session?.objectives ?? objectives;
  const nActive = Object.keys(activeWeights(shown, session?.goal ?? goalName, challenge)).length;
  // the session's first run starts at the sum of its weights (each term normalized to 1)
  const sessionStart = session?.startTotal ?? status?.total0 ?? null;
  const improvement =
    sessionStart !== null && typeof status?.best_total === "number" && Number.isFinite(status.best_total)
      ? 1 - status.best_total / Math.max(sessionStart, 1e-12)
      : null;

  return (
    <div className="h-full flex flex-col overflow-y-auto text-xs text-gray-300">
      <Section
        title={session ? `Run · session (${session.runs} run${session.runs === 1 ? "" : "s"}, ${session.evals} evaluations)` : "Run"}
        right={session && !running ? (
          <button onClick={newSession} className={smallBtn} title="Unlock the objectives and start a fresh chart">
            New session
          </button>
        ) : undefined}
      >
        <div className="flex items-center gap-2">
          {running ? (
            <button onClick={stop} className="px-3 py-1 rounded bg-red-600 text-white text-xs">Stop</button>
          ) : (
            <button onClick={start} disabled={knobs.length === 0 || nActive === 0}
                    className="px-3 py-1 rounded bg-accent text-white text-xs disabled:opacity-40"
                    title={session?.runs ? "Another run from the nodes' current values, on the session's scale" : undefined}>
              {session?.runs ? "▶ Continue" : "▶ Run"}
            </button>
          )}
          <button onClick={applyBest} disabled={!status?.best_knobs?.length || running} className={smallBtn}
                  title="Write the best knobs found into the nodes (and cook)">
            Apply best
          </button>
          <button onClick={revert} disabled={!original} className={smallBtn} title="Restore the knobs from before 'Apply best'">
            Revert
          </button>
        </div>
        {error && <div className="mt-1.5 text-red-400">{error}</div>}
        {status && (
          <div className="mt-1.5 flex flex-col gap-0.5 tabular-nums">
            <div>
              <span className="text-gray-100">{status.state}</span>
              {status.state === "compiling" && <span className="text-gray-500"> — once per program shape (cached after)</span>}
              <span className="text-gray-500"> · evaluation {status.iteration}/{status.iterations}</span>
            </div>
            {status.phase && running && <div className="text-gray-500">{status.phase}</div>}
            {improvement !== null && (
              <div>
                best = {(1 - improvement).toFixed(3)} × the session's start —{" "}
                <span className={improvement > 0 ? "text-green-400" : "text-gray-400"}>{(improvement * 100).toFixed(0)}% better</span>
              </div>
            )}
            {!!status.infeasible_evals && (
              <div className="text-gray-500">
                {status.infeasible_evals} of {status.iteration} evaluations infeasible (never kept as best)
              </div>
            )}
            {typeof status.seconds_per_iter === "number" && (
              <div className="text-gray-500">
                {status.seconds_per_iter.toFixed(2)} s / evaluation
                {status.strategy === "auto" && typeof status.chosen_lr === "number" && ` · step size chosen ${status.chosen_lr.toPrecision(2)}`}
              </div>
            )}
            {status.state === "error" && <div className="text-red-400 break-words">{status.error}</div>}
            {!!status.infeasible_steps?.length && (
              <div className="text-amber-400">⚠ infeasible with the best knobs: {status.infeasible_steps.join(", ")}</div>
            )}
          </div>
        )}
      </Section>

      {session && (
        <div className="h-52 shrink-0 border-b border-border">
          <ScalarPanel run="optimize" tag={session.tag} shortNames />
        </div>
      )}

      <Section
        title={`Knobs (${knobs.length})`}
        right={
          <>
            <button onClick={() => toggleAllOn(targets)} disabled={!targets.length} className={smallBtn}
                    title="Toggle every optimizable param of the selected node(s)">
              + all on selected
            </button>
            <button onClick={clearKnobs} disabled={!knobs.length} className={smallBtn}>Clear</button>
          </>
        }
      >
        {knobs.length === 0 && <div className="text-gray-500">Toggle ◎ next to a param in the inspector to make it a knob.</div>}
        <div className="max-h-40 overflow-y-auto pr-1">
          {knobs.map((k) => {
            const sens = sensByKey.get(keyOf(k.nodeId, k.param));
            const best = bestByKey.get(keyOf(k.nodeId, k.param));
            return (
              <div key={`${k.nodeId}:${k.param}`} className="flex items-center gap-1.5 py-0.5">
                <span className="truncate text-gray-200">{label(k.nodeId)}</span>
                <span className="text-gray-500">{k.param}</span>
                {sens && (
                  <div className="w-10 h-1.5 shrink-0 bg-surface rounded overflow-hidden" title={`sensitivity ${sens.effect.toPrecision(2)}`}>
                    <div className="h-full bg-accent" style={{ width: `${(100 * sens.effect) / maxEffect}%` }} />
                  </div>
                )}
                {best && <span className="text-gray-500 tabular-nums shrink-0">{best.start.toFixed(2)} → {best.value.toFixed(2)}</span>}
                <button onClick={() => toggleKnob(k.nodeId, k.param)} className="ml-auto text-gray-500 hover:text-gray-100" title="Remove">
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title={locked ? "Objectives (locked for this session)" : "Objectives (weights)"}>
        {Object.entries(OBJECTIVE_LABELS).map(([id, text]) => {
          const unavailable = (id === "shape" && !(session?.goal ?? goalName)) || (id === "features" && !challenge);
          const note = id === "shape" ? (session?.goal ?? goalName) ?? "pick a goal under Render settings"
            : id === "features" ? challenge ?? "needs a challenge path" : null;
          const o = shown[id] ?? { on: false, weight: 1 };
          return (
            <div key={id} className="flex items-center gap-2 py-0.5">
              <input
                type="checkbox" className="accent-accent" disabled={unavailable || locked}
                checked={!unavailable && o.on} onChange={(e) => setObjective(id, { on: e.target.checked })}
              />
              <span className={unavailable ? "text-gray-600" : "text-gray-200"}>{text}</span>
              {note && <span className="text-gray-500 truncate">({note})</span>}
              <WeightControl value={o.weight} disabled={unavailable || locked || !o.on}
                             onChange={(w) => setObjective(id, { weight: w })} />
            </div>
          );
        })}
        <div className="text-[10px] text-gray-600 mt-1">
          Each term is divided by its value at the session's start, so weights are relative importance.
          {locked && " New session to change them."}
        </div>
      </Section>

      <Section title="Settings">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 items-center">
          <span title="auto: several short descents from the current knobs and nearby restarts at a few step sizes, the better half kept each round, the winner refined. gradient descent: one descent from the current knobs">
            Search
          </span>
          <select value={settings.strategy} aria-label="Search"
                  onChange={(e) => setSettings({ strategy: e.target.value as "auto" })} className={field}>
            <option value="auto">auto (multi-start)</option>
            <option value="gd">gradient descent only</option>
          </select>
          <span title="Loss + gradient evaluations in all">Budget (evaluations)</span>
          <input type="number" min={1} max={5000} value={settings.iterations} aria-label="Iterations"
                 onChange={(e) => setSettings({ iterations: Math.max(1, Number(e.target.value)) })} className={field} />
          <span title="frozen: temperatures from a coupled run, held fixed (fast, compiled). coupled: gradients through the heat solve (exact, slow)">
            Temperature
          </span>
          <select value={settings.temperature} aria-label="Temperature"
                  onChange={(e) => setSettings({ temperature: e.target.value as "frozen" })} className={field}>
            <option value="frozen">frozen (fast)</option>
            <option value="coupled">coupled (exact)</option>
          </select>
          <span title="fast: 120 slabs x 32 angles; medium: 200 x 48; full: the stock node's own">Resolution</span>
          <select value={settings.resolution} aria-label="Resolution"
                  onChange={(e) => setSettings({ resolution: e.target.value as "fast" })} className={field}>
            <option value="fast">fast</option>
            <option value="medium">medium</option>
            <option value="full">full</option>
          </select>
        </div>
        <button onClick={() => setAdvanced((a) => !a)} className="mt-2 text-[10px] uppercase tracking-wide text-gray-500 hover:text-gray-300">
          {advanced ? "▾" : "▸"} Advanced (gradient descent)
        </button>
        {advanced && (
          <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1.5 items-center">
            <span title={settings.strategy === "auto" ? "auto tries 0.4x, 1x and 2.5x this and keeps what works (carried into the next run)" : "Adam step in the knobs' normalized (logit) coordinates"}>
              Step size
            </span>
            <input type="number" min={0.001} max={1} step={0.01} value={settings.lr} aria-label="Step size"
                   onChange={(e) => setSettings({ lr: Number(e.target.value) })} className={field} />
            <span title="cosine: the step decays to a tenth over a descent; constant: fixed">Step schedule</span>
            <select value={settings.schedule} aria-label="Step schedule"
                    onChange={(e) => setSettings({ schedule: e.target.value as "cosine" })} className={field}>
              <option value="cosine">cosine decay</option>
              <option value="constant">constant</option>
            </select>
            {settings.strategy === "auto" && (
              <>
                <span title="Descents started (3 from the current knobs at different step sizes, the rest restarts nearby)">Rollouts</span>
                <input type="number" min={2} max={24} value={settings.candidates} aria-label="Rollouts"
                       onChange={(e) => setSettings({ candidates: Math.max(2, Number(e.target.value)) })} className={field} />
                <span title="How far restarts move each knob, as a fraction of its value">Restart spread</span>
                <input type="number" min={0.01} max={1} step={0.05} value={settings.spread} aria-label="Restart spread"
                       onChange={(e) => setSettings({ spread: Number(e.target.value) })} className={field} />
              </>
            )}
            {settings.temperature === "frozen" && (
              <>
                <span title="Re-run the coupled heat solve at the best knobs every N evaluations">Refresh every</span>
                <input type="number" min={1} value={settings.refreshEvery} aria-label="Refresh every"
                       onChange={(e) => setSettings({ refreshEvery: Math.max(1, Number(e.target.value)) })} className={field} />
              </>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
