// The operator's setup sheet for one program: stock, then every step in
// shop terms (where, angle, setting) with the load and temperatures the last
// cook predicted. Opens as a printable page in a new window, with its CSV.
import type { Node } from "@xyflow/react";
import type { NodeDiagnostics, PipelineNodeData } from "@/types/pipeline";
import { describeStep } from "./steps";
import { programStats } from "./programStats";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

interface Row { step: number; op: string; where: string; angle: string; setting: string; load: string;
                temp: string; clock: string; notes: string }

function rows(nodeIds: string[], byId: Map<string, Node<PipelineNodeData>>, diag: Record<string, NodeDiagnostics>): Row[] {
  return nodeIds.flatMap((id, i) => {
    const node = byId.get(id);
    if (!node) return [];
    const d = diag[id] ?? {};
    const desc = describeStep(node.data.kind, node.data.params);
    const load = num(d.required_load_N) ?? num(d.required_load_N_max);
    const lo = num(d.T_min_C) ?? num(d.T_part_min_C);
    const hi = num(d.T_max_C) ?? num(d.T_part_max_C);
    const notes = [
      typeof node.data.params.label === "string" ? node.data.params.label : "",
      (num(d.n_capped) ?? 0) > 0 || d.capped ? "press limit reached" : "",
      num(d.feasible) !== null && (d.feasible as number) < 1 ? "NOT FEASIBLE" : "",
    ].filter(Boolean).join("; ");
    return [{
      step: i, op: desc.op, where: desc.where, angle: desc.angle, setting: desc.setting,
      load: load !== null && load > 0 ? (load / 1e3).toFixed(0) : "",
      temp: lo !== null && hi !== null ? `${lo.toFixed(0)}–${hi.toFixed(0)}` : "",
      clock: num(d.time_s) !== null ? (d.time_s as number).toFixed(0) : "", notes,
    }];
  });
}

const COLUMNS: [keyof Row, string][] = [
  ["step", "#"], ["op", "Operation"], ["where", "Where (stock mm)"], ["angle", "Angle"], ["setting", "Setting"],
  ["load", "Load (kN)"], ["temp", "Part T (°C)"], ["clock", "Clock (s)"], ["notes", "Notes"],
];

export function setupSheetCsv(r: Row[]): string {
  const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  return [COLUMNS.map(([, h]) => cell(h)).join(","), ...r.map((row) => COLUMNS.map(([k]) => cell(row[k])).join(","))].join("\n");
}

export function openSetupSheet(title: string, goal: string | null, nodeIds: string[],
                               byId: Map<string, Node<PipelineNodeData>>, diag: Record<string, NodeDiagnostics>) {
  const r = rows(nodeIds, byId, diag);
  const st = programStats(nodeIds, byId, diag);
  const stale = !st.cooked ? `<p class="warn">Not every step is cooked: loads and temperatures may be missing or out of date.</p>` : "";
  const facts = [
    `${st.hits} hits`, st.heats ? `${st.heats} heats` : "", st.otherOps ? `${st.otherOps} other ops` : "",
    st.timeS !== null ? `${st.timeS.toFixed(0)} s total` : "", st.peakLoadKN !== null ? `peak load ${st.peakLoadKN.toFixed(0)} kN` : "",
    st.coldestHitC !== null ? `coldest press step ${st.coldestHitC.toFixed(0)} °C` : "",
    st.lengthMm !== null ? `final length ${st.lengthMm.toFixed(1)} mm` : "",
  ].filter(Boolean).join(" · ");
  const csv = "data:text/csv;charset=utf-8," + encodeURIComponent(setupSheetCsv(r));
  const file = title.replace(/[^\w.-]+/g, "_") || "program";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} · setup sheet</title>
<style>
  body { font: 12px/1.4 system-ui, sans-serif; color: #111; background: #fff; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; } .meta { color: #555; margin-bottom: 12px; }
  table { border-collapse: collapse; width: 100%; } th, td { border-bottom: 1px solid #ddd; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f3f3f1; font-weight: 600; } td.n { text-align: right; font-variant-numeric: tabular-nums; }
  .warn { color: #a15c00; } .bar { margin-bottom: 12px; display: flex; gap: 8px; }
  @media print { .bar { display: none; } body { margin: 10mm; } }
</style></head><body>
<div class="bar"><button onclick="print()">Print</button><a href="${csv}" download="${esc(file)}_setup.csv"><button>Download CSV</button></a></div>
<h1>${esc(title)}</h1>
<div class="meta">Setup sheet · ${esc(new Date().toLocaleString())}${goal ? ` · goal ${esc(goal)}` : ""}<br>${esc(facts)}</div>
${stale}
<table><thead><tr>${COLUMNS.map(([, h]) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>
${r.map((row) => `<tr>${COLUMNS.map(([k]) => `<td class="${["step", "load", "clock"].includes(k) ? "n" : ""}">${esc(String(row[k]))}</td>`).join("")}</tr>`).join("\n")}
</tbody></table></body></html>`;
  const w = window.open("", "_blank");
  if (!w) return false; // a popup blocker
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}
