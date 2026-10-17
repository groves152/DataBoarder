import type { Node, NodeProps } from "@xyflow/react";
import { usePipelineStore } from "@/stores/pipelineStore";
import { Icon } from "./icons";
import { programStats } from "@/utils/programStats";

// One program (a stock and its steps) as a single card, for the graph's
// programs level: what it does and what it makes, at a glance, to compare
// programs side by side. Double-click (GraphPanel) or "Open its steps" dives in.
export interface ProgramCardData extends Record<string, unknown> {
  root: string;
  label: string;
  nodeIds: string[];
  color: string; // its overlay color, once pinned
}

export function ProgramCard({ data, selected }: NodeProps<Node<ProgramCardData>>) {
  const { nodes, diagnostics, pinnedPrograms, togglePinnedProgram, focusProgram } = usePipelineStore();
  const st = programStats(data.nodeIds, new Map(nodes.map((n) => [n.id, n])), diagnostics);
  const pinned = pinnedPrograms.includes(data.root);

  return (
    <div className={`rounded-md border px-3 py-2 w-[230px] bg-panel shadow-md transition-colors ${
           selected ? "border-accent" : "border-border"}`}>
      <div className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full shrink-0 ${st.cooked ? "bg-green-400" : "bg-gray-500"}`}
              title={st.cooked ? "cooked" : "not cooked yet"} />
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
        {st.hits} hits{st.heats ? ` · ${st.heats} heats` : ""}{st.otherOps ? ` · ${st.otherOps} other ops` : ""} · {st.nodes} nodes
      </div>
      {st.lengthMm !== null && (
        <div className="text-[10px] text-gray-400 tabular-nums">
          L {st.lengthMm.toFixed(1)} mm
          {st.dMinMm !== null && st.dMaxMm !== null ? ` · d ${st.dMinMm.toFixed(1)}–${st.dMaxMm.toFixed(1)} mm` : ""}
        </div>
      )}
      {(st.timeS !== null || st.peakLoadKN !== null) && (
        <div className="text-[10px] text-gray-500 tabular-nums">
          {[st.timeS !== null ? `${st.timeS.toFixed(0)} s` : "", st.peakLoadKN !== null ? `peak ${st.peakLoadKN.toFixed(0)} kN` : ""]
            .filter(Boolean).join(" · ")}
        </div>
      )}
      <button onClick={(e) => { e.stopPropagation(); focusProgram(data.root); }}
              className="mt-1.5 flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-100">
        Open its steps <Icon name="up" className="w-3 h-3 rotate-90" />
      </button>
    </div>
  );
}
