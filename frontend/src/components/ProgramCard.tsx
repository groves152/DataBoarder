import type { Node, NodeProps } from "@xyflow/react";
import { usePipelineStore } from "@/stores/pipelineStore";
import { Icon } from "./icons";

// One program (a stock and its steps) as a single card, for the graph's
// programs level: what it does and what it makes, at a glance, to compare
// programs side by side. Double-click (GraphPanel) or "Open its steps" dives in.
export interface ProgramCardData extends Record<string, unknown> {
  root: string;
  label: string;
  nodeIds: string[];
  color: string; // its overlay color, once pinned
}

const HIT_KINDS = new Set(["ops_strike", "slab_strike"]);

export function ProgramCard({ data, selected }: NodeProps<Node<ProgramCardData>>) {
  const { nodes, diagnostics, pinnedPrograms, togglePinnedProgram, focusProgram } = usePipelineStore();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const steps = data.nodeIds.map((id) => byId.get(id)).filter((n) => n !== undefined);
  const kindCount = (pred: (k: string) => boolean) => steps.filter((n) => pred(n.data.kind)).length;
  const hits = steps.reduce((sum, n) => sum + (HIT_KINDS.has(n.data.kind) ? 1
    : n.data.kind === "ops_draw_pass" ? Number(n.data.params.n ?? 0) : 0), 0);
  const heats = kindCount((k) => k.includes("heat"));
  const others = kindCount((k) => /bend|pierce|slit|regrip/.test(k));
  const last = diagnostics[data.nodeIds[data.nodeIds.length - 1]];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const peakKN = Math.max(0, ...data.nodeIds.map((id) => {
    const d = diagnostics[id];
    return num(d?.required_load_N) ?? num(d?.required_load_N_max) ?? 0;
  })) / 1e3;
  const cooked = steps.length > 0 && steps.every((n) => n.data.cooked);
  const pinned = pinnedPrograms.includes(data.root);
  const length = num(last?.length_mm);
  const dMin = num(last?.d_eq_min_mm);
  const dMax = num(last?.d_eq_max_mm);
  const t = num(last?.time_s);

  return (
    <div className={`rounded-md border px-3 py-2 w-[230px] bg-panel shadow-md transition-colors ${
           selected ? "border-accent" : "border-border"}`}>
      <div className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full shrink-0 ${cooked ? "bg-green-400" : "bg-gray-500"}`}
              title={cooked ? "cooked" : "not cooked yet"} />
        <span className="text-xs font-semibold text-gray-200 truncate" title={data.label}>{data.label}</span>
        <button onClick={(e) => { e.stopPropagation(); togglePinnedProgram(data.root); }}
                title={pinned ? "Stop overlaying its final part" : "Compare: overlay its final part in the viewport"}
                className={`ml-auto shrink-0 w-5 h-5 rounded border flex items-center justify-center text-[10px] ${
                  pinned ? "text-white" : "border-border text-gray-400 hover:border-accent"}`}
                style={pinned ? { background: data.color, borderColor: data.color } : undefined}>
          ◐
        </button>
      </div>
      <div className="text-[10px] text-gray-400 mt-1 tabular-nums">
        {hits} hits{heats ? ` · ${heats} heats` : ""}{others ? ` · ${others} other ops` : ""} · {steps.length} nodes
      </div>
      {length !== null && (
        <div className="text-[10px] text-gray-400 tabular-nums">
          L {length.toFixed(1)} mm{dMin !== null && dMax !== null ? ` · d ${dMin.toFixed(1)}–${dMax.toFixed(1)} mm` : ""}
        </div>
      )}
      {(t !== null || peakKN > 0) && (
        <div className="text-[10px] text-gray-500 tabular-nums">
          {t !== null ? `${t.toFixed(0)} s` : ""}{t !== null && peakKN > 0 ? " · " : ""}
          {peakKN > 0 ? `peak ${peakKN.toFixed(0)} kN` : ""}
        </div>
      )}
      <button onClick={(e) => { e.stopPropagation(); focusProgram(data.root); }}
              className="mt-1.5 flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-100">
        Open its steps <Icon name="up" className="w-3 h-3 rotate-90" />
      </button>
    </div>
  );
}
