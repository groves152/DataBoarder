import { useMemo, useState } from "react";
import { usePipelineStore } from "@/stores/pipelineStore";
import { useCurrentProgram } from "@/hooks/useCurrentProgram";
import { programLabel, type Program } from "@/utils/programs";
import { programStats, type ProgramStats } from "@/utils/programStats";
import { describeStep, paramDiff } from "@/utils/steps";
import { openSetupSheet } from "@/utils/setupSheet";
import { toast } from "@/stores/toastStore";
import { seriesColor, useResolvedTheme } from "@/theme";

// The side panel's Compare tab: the program in view against the pinned ones
// (◐ on a program card) -- their headline numbers side by side, differences
// against the one in view, and a step-by-step parameter diff. Also opens the
// setup sheet of the program in view.
const ROWS: [keyof ProgramStats, string, number][] = [
  ["hits", "hits", 0], ["heats", "heats", 0], ["otherOps", "other ops", 0],
  ["lengthMm", "final length (mm)", 1], ["dMinMm", "size min (mm)", 1], ["dMaxMm", "size max (mm)", 1],
  ["roughness", "roughness", 3], ["strainMax", "max strain", 2],
  ["timeS", "process time (s)", 0], ["peakLoadKN", "peak load (kN)", 0], ["coldestHitC", "coldest press step (°C)", 0],
  ["cappedHits", "hits at the press limit", 0],
];
const btn = "px-2 py-0.5 rounded border border-border text-gray-300 hover:border-accent hover:text-gray-100 transition-colors";

export function ComparePanel() {
  const { nodes, diagnostics, pinnedPrograms, goalName } = usePipelineStore();
  const theme = useResolvedTheme();
  const { programs, current } = useCurrentProgram();
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const name = (p: Program) => programLabel(p, programs.indexOf(p), (id) => {
    const l = byId.get(id)?.data.params.label;
    return typeof l === "string" && l ? l : undefined;
  });
  const cols = current ? [current, ...programs.filter((p) => pinnedPrograms.includes(p.root) && p.root !== current.root)] : [];
  const stats = cols.map((p) => programStats(p.nodeIds, byId, diagnostics));
  const [otherRoot, setOtherRoot] = useState<string | null>(null);
  const [allSteps, setAllSteps] = useState(false);
  const other = cols.find((p) => p.root === otherRoot) ?? cols[1];

  const sheet = () => {
    if (current && !openSetupSheet(name(current), goalName, current.nodeIds, byId, diagnostics)) {
      toast({ text: "The browser blocked the setup sheet's window: allow pop-ups for this page", tone: "error" });
    }
  };

  if (!current) return <div className="p-3 text-xs text-gray-500">No program yet.</div>;
  const diffRows = other ? Array.from({ length: Math.max(current.nodeIds.length, other.nodeIds.length) }, (_, i) => {
    const a = byId.get(current.nodeIds[i]);
    const b = byId.get(other.nodeIds[i]);
    const change = !a ? "only in the other" : !b ? "only in this one"
      : a.data.kind !== b.data.kind ? `${describeStep(a.data.kind, a.data.params).op} → ${describeStep(b.data.kind, b.data.params).op}`
      : paramDiff(a.data.params, b.data.params).join(", ");
    return { i, a, b, change };
  }).filter((r) => allSteps || r.change) : [];

  return (
    <div className="h-full flex flex-col overflow-y-auto text-xs text-gray-300">
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <span className="text-gray-400 truncate flex-1">In view: <span className="text-gray-100">{name(current)}</span></span>
        <button className={btn} onClick={sheet} title="A printable sheet of this program's steps for the press operator (and its CSV)">
          Setup sheet
        </button>
      </div>
      {cols.length < 2 && (
        <div className="p-3 text-gray-500">
          Pin programs with ◐ on their cards (the graph's programs view) to compare them with the one in view.
        </div>
      )}
      {cols.length >= 2 && (
        <>
          <table className="m-3 tabular-nums">
            <thead>
              <tr>
                <th />
                {cols.map((p) => (
                  <th key={p.root} className="text-left font-normal px-2 pb-1">
                    <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle"
                          style={{ background: seriesColor(programs.indexOf(p), theme) }} />
                    <span className="text-gray-100">{name(p)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([key, label, digits]) => (
                <tr key={key} className="border-t border-border">
                  <td className="py-0.5 pr-2 text-gray-500 whitespace-nowrap">{label}</td>
                  {stats.map((st, j) => {
                    const v = st[key] as number | null;
                    const v0 = stats[0][key] as number | null;
                    const d = j > 0 && v !== null && v0 !== null ? v - v0 : null;
                    return (
                      <td key={j} className="px-2 py-0.5 whitespace-nowrap">
                        {v === null ? "—" : v.toFixed(digits)}
                        {d !== null && Math.abs(d) >= 0.5 * 10 ** -digits && (
                          <span className="text-gray-500"> ({d > 0 ? "+" : ""}{d.toFixed(digits)})</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="px-3 py-2 border-t border-border flex items-center gap-2">
            <span className="text-gray-400">Steps against</span>
            <select value={other?.root ?? ""} onChange={(e) => setOtherRoot(e.target.value)}
                    className="bg-surface border border-border rounded px-1.5 py-0.5 text-gray-200 min-w-0 flex-1">
              {cols.slice(1).map((p) => <option key={p.root} value={p.root}>{name(p)}</option>)}
            </select>
            <label className="flex items-center gap-1 text-gray-400 cursor-pointer select-none">
              <input type="checkbox" className="accent-accent" checked={allSteps} onChange={(e) => setAllSteps(e.target.checked)} />
              all steps
            </label>
          </div>
          <div className="px-3 pb-3">
            {diffRows.length === 0 && <div className="text-gray-500">Same steps, same settings.</div>}
            {diffRows.map(({ i, a, b, change }) => (
              <div key={i} className="py-1 border-t border-border">
                <div className="flex gap-2">
                  <span className="text-gray-500 w-6 shrink-0 tabular-nums">{i}</span>
                  <span className="text-gray-200">{a ? describeStep(a.data.kind, a.data.params).op : "—"}</span>
                  {b && a?.data.kind !== b.data.kind && <span className="text-gray-400">/ {describeStep(b.data.kind, b.data.params).op}</span>}
                </div>
                <div className={`pl-8 text-[11px] ${change ? "text-amber-300" : "text-gray-500"}`}>{change || "same"}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
