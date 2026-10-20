import { useEffect, useState } from "react";
import { usePipelineStore } from "@/stores/pipelineStore";
import { type PlanLeg, subgoals, usePlanStore } from "@/stores/planStore";
import { type SettingValue, TERMINAL, useSearchStore } from "@/stores/searchStore";
import { FieldInput, Section, smallBtn } from "./SearchPanel";

// The side panel's "Plan" tab: the goal mesh decomposed into groups of
// operations -- cog the stock to a straight preform, then slit, bend, flatten,
// pierce -- each group with the shape it should make (its subgoal; the legs
// inside a group are its settings). Click a group to see its subgoal in the
// viewport; "Add to graph & cook" puts the plan in the graph as a chain of
// controller nodes, each aimed at its subgoal's node, and cooks it (runs it
// forward); make any subgoal a goal of its own (e.g. the straight preform).

const OP_TONE: Record<PlanLeg["op"], string> = {
  cog: "text-gray-300 border-gray-500/60",
  slit: "text-rose-300 border-rose-400/60",
  bend: "text-sky-300 border-sky-400/60",
  flatten: "text-amber-300 border-amber-400/60",
  pierce: "text-violet-300 border-violet-400/60",
};

const STOCK_SOURCE: Record<string, string> = { standard: "the standard bar", graph: "the graph's", preform: "sized to the preform" };
const dims = (s: { radius: number; length: number }) => `D${(2 * s.radius).toFixed(1).replace(/\.0$/, "")} × ${s.length.toFixed(1).replace(/\.0$/, "")} mm`;
const slug = (s: string) => s.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");

export function PlanPanel() {
  const goalName = usePipelineStore((s) => s.goalName);
  const { fields, settings, status, error, view, loadSchema, setSetting, start, stop, makeGoal, setView,
          toGraph } = usePlanStore();
  const cooking = usePipelineStore((s) => s.cooking);
  const openMode = useSearchStore((s) => s.openMode);
  const setOpenMode = useSearchStore((s) => s.setOpenMode);
  useEffect(() => void loadSchema(), [loadSchema]);
  const [naming, setNaming] = useState<{ shape: number | "goal"; name: string } | null>(null);
  const running = !!status && !TERMINAL.includes(status.state);
  const plan = status?.plan;
  const groups = plan ? subgoals(plan) : [];
  const viewing = (shape: number) => view !== null && view.shape === shape;

  if (!fields) {
    return <div className="p-3 text-xs text-gray-500">No planner: the server doesn't have forge-control installed.</div>;
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto text-xs text-gray-300">
      <Section title="Plan">
        <div className="flex items-center gap-2">
          <span className="truncate flex-1 min-w-0 text-gray-400">
            goal: <span className="text-gray-200">{goalName ?? "pick one under Render settings"}</span>
          </span>
          {running ? (
            <button onClick={stop} className="px-3 py-1 rounded bg-red-600 text-white text-xs">Stop</button>
          ) : (
            <button onClick={start} disabled={!goalName} className="px-3 py-1 rounded bg-accent text-white text-xs disabled:opacity-40">
              ▶ Plan
            </button>
          )}
        </div>
        <div className="mt-1 text-[10px] text-gray-500">
          Finds the operations in the goal (bends, flats, holes, a slit), undoes them back to a straight preform, and
          plans the legs that make it: cog the stock to the preform, then each operation, each with the shape it should
          make. Add it to the graph to run it: a controller node per group, aimed at its subgoal.
        </div>
        {error && <div className="mt-1.5 text-red-400 break-words">{error}</div>}
        {status && (
          <div className="mt-1.5 flex flex-col gap-0.5 tabular-nums">
            <div>
              <span className="text-gray-100">{status.state}</span>
              {plan && <span className="text-gray-500"> · {plan.legs.length} legs in {groups.length} groups</span>}
              <span className="text-gray-500"> · {status.goal}</span>
            </div>
            {status.phase && running && <div className="text-gray-500">{status.phase}</div>}
            {status.state === "error" && <div className="text-red-400 break-words">{status.error}</div>}
          </div>
        )}
      </Section>

      {plan && (
        <Section title={`Plan for ${status?.goal}`}>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <span className="text-gray-500">stock</span>
            <span className="text-gray-200 tabular-nums">
              {dims(plan.stock)} <span className="text-gray-500">— {STOCK_SOURCE[plan.stock.source] ?? plan.stock.source}: {plan.stock.why}</span>
              {plan.stock.workable_mm > plan.stock.max_workable_mm && (
                <span className="block text-amber-400">
                  ⚠ needs {plan.stock.workable_mm.toFixed(1)} mm past the held end: over the {plan.stock.max_workable_mm} mm a part may use
                </span>
              )}
            </span>
            {plan.stock.source === "graph" && (
              <>
                <span className="text-gray-500">suggested</span>
                <span className="text-gray-400 tabular-nums">{dims(plan.stock_suggested)} (sized to the preform)</span>
              </>
            )}
            <span className="text-gray-500">found</span>
            <span className="text-gray-200">
              {[`${plan.features.bends} bend${plan.features.bends === 1 ? "" : "s"}`,
                `${plan.features.flats} flat${plan.features.flats === 1 ? "" : "s"}`,
                `${plan.features.holes} hole${plan.features.holes === 1 ? "" : "s"}`,
                plan.features.slit ? "a slit" : "no slit"].join(" · ")}
            </span>
          </div>
          {(plan.seat.offset_mm > 0.5 || plan.seat.tilt_deg > 0.5) && (
            <div className="mt-1.5 text-amber-400">
              ⚠ The goal isn't held along +x from its grip end (off by {plan.seat.offset_mm.toFixed(1)} mm,
              {" "}{plan.seat.tilt_deg.toFixed(1)}°): the plan seats it at the stock's grip, so programs from it cook onto
              the goal as held.{" "}
              <button className="underline" onClick={() => setNaming({ shape: "goal", name: `${status?.goal}_held` })}>
                Make that a goal
              </button>
            </div>
          )}
          {plan.held_mm > 0 && (
            <div className="mt-1.5 text-gray-400">
              The billet's held end ({plan.held_mm.toFixed(0)} mm) is sacrificial: it stays stock size in the tongs,
              isn't scored, and sits behind x = 0 (the billet set back by it), so the part starts where the goal does.
              Programs opened from the plan carry it on their stock node.
            </div>
          )}
          {plan.notes.map((n) => <div key={n} className="mt-1 text-[10px] text-gray-500">· {n}</div>)}
        </Section>
      )}

      {plan && (
        <Section title="Into the graph">
          <div className="flex items-center gap-2">
            <button onClick={() => void toGraph({ chain: true })} disabled={running || cooking}
                    className="px-3 py-1 rounded bg-accent text-white text-xs disabled:opacity-40"
                    title="A stock and a controller node per group (cog, bend, flatten, ...), each with its Subgoal node in its goal input, then cooked: the plan run forward. Each controller's settings are on its node.">
              ▶ Add to graph &amp; cook
            </button>
            {cooking && <span className="text-gray-500">cooking…</span>}
          </div>
          <div className="flex items-center gap-1 mt-1.5 text-[10px]"
               title="Replace: the chain becomes the graph. Add: it goes beside what's there, as its own program (to compare).">
            <span className="text-gray-500 mr-1">The chain goes</span>
            {(["replace", "add"] as const).map((m) => (
              <button key={m} onClick={() => setOpenMode(m)}
                      className={`px-1.5 py-0.5 rounded border transition-colors ${
                        openMode === m ? "bg-accent border-accent text-white" : "border-border text-gray-400 hover:border-accent"}`}>
                {m === "replace" ? "replacing the graph" : "beside it"}
              </button>
            ))}
          </div>
          <div className="mt-1 text-[10px] text-gray-500">
            Each controller's badges show its hits and how close it gets to its subgoal; select one to see its steps.
            Export the path to get the whole program as plain steps (Transform → fill heats adds the reheats).
          </div>
        </Section>
      )}

      {plan && (
        <Section title="Operations — click one to see it" right={view !== null ? (
          <button className={smallBtn} onClick={() => setView(null)} title="Give the viewport back to the graph">Hide</button>
        ) : undefined}>
          <div className="flex flex-col gap-1">
            {groups.map((g, gi) => {
              const groupOn = viewing(g.shape);
              const show = () => setView({ shape: g.shape });
              const single = g.legs.length === 1 ? plan.legs[g.legs[0]] : null;
              return (
                <div key={g.shape} role="button" tabIndex={0} onClick={show} onKeyDown={(e) => e.key === "Enter" && show()}
                     className={`rounded border px-2 py-1 cursor-pointer transition-colors ${
                       groupOn ? "border-accent bg-accent/10" : "border-border hover:border-accent/60"}`}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-500 tabular-nums w-4">{gi + 1}</span>
                    <span className={`px-1 rounded border text-[10px] uppercase tracking-wide ${OP_TONE[g.op]}`}>{g.op}</span>
                    <span className="text-gray-100">{g.label}</span>
                    {g.legs.length > 1 && <span className="text-gray-500">{g.legs.length} legs</span>}
                  </div>
                  <div className="pl-5 flex items-center gap-1.5 text-[10px]">
                    <span className="text-gray-500">makes</span>
                    <button className={`hover:text-gray-100 ${viewing(g.shape) ? "text-gray-100" : "text-amber-300/90"}`}
                            title="Show this subgoal on its own" onClick={(e) => { e.stopPropagation(); setView({ shape: g.shape }); }}>
                      {g.name}
                    </button>
                    <button className="text-gray-500 hover:text-gray-200 underline decoration-dotted"
                            title="This subgoal as a Subgoal node in the graph (aim a Controller node at it)"
                            onClick={(e) => { e.stopPropagation(); void toGraph({ groups: [groups.indexOf(g)] }); }}>
                      add to graph
                    </button>
                    <button className="text-gray-500 hover:text-gray-200 underline decoration-dotted"
                            title="Save this subgoal as a goal mesh (for the Search and Optimize tabs)"
                            onClick={(e) => { e.stopPropagation(); setNaming({ shape: g.shape, name: slug(`${status?.goal}_${g.name}`) }); }}>
                      make goal…
                    </button>
                  </div>
                  {naming?.shape === g.shape && (
                    <div className="pl-5 mt-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <input value={naming.name} onChange={(e) => setNaming({ ...naming, name: e.target.value })} aria-label="Goal name"
                             className="flex-1 min-w-0 bg-surface border border-border rounded px-1.5 py-0.5 text-gray-200" />
                      <button className={smallBtn} onClick={() => { void makeGoal(naming.shape, naming.name); setNaming(null); }}>Make goal</button>
                      <button className={smallBtn} onClick={() => setNaming(null)}>Cancel</button>
                    </div>
                  )}
                  {g.legs.map((i) => {
                    const lg = plan.legs[i];
                    return (
                      <div key={i} className="pl-5 mt-0.5 text-[10px] text-gray-400">
                        {single ? "" : `${lg.label}${lg.chain_name !== "root" ? `, ${lg.chain_name}` : ""}: `}
                        {single && lg.chain_name !== "root" ? `${lg.chain_name}: ` : ""}{lg.summary}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {naming?.shape === "goal" && (
            <div className="mt-1.5 flex items-center gap-1">
              <input value={naming.name} onChange={(e) => setNaming({ ...naming, name: e.target.value })} aria-label="Goal name"
                     className="flex-1 min-w-0 bg-surface border border-border rounded px-1.5 py-0.5 text-gray-200" />
              <button className={smallBtn} onClick={() => { void makeGoal(naming.shape, naming.name); setNaming(null); }}>Make goal</button>
              <button className={smallBtn} onClick={() => setNaming(null)}>Cancel</button>
            </div>
          )}
        </Section>
      )}

      <Section title="Settings">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 items-center">
          {fields.map((f) => (
            <div key={f.name} className="contents">
              <span title={f.help}>{f.label}</span>
              <FieldInput f={f} value={settings[f.name] ?? (f.default as SettingValue)} disabled={running}
                          onChange={(v) => setSetting(f.name, v)} />
            </div>
          ))}
        </div>
        <div className="text-[10px] text-gray-600 mt-1">
          The goal is fitted at 300 slabs × 48 angles. The controllers are isothermal: the reheats go in on export
          (Transform → fill heats).
        </div>
      </Section>
    </div>
  );
}
