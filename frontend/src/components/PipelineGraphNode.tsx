import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { PipelineNodeData } from "@/types/pipeline";
import { usePipelineStore } from "@/stores/pipelineStore";
import { formatRadiansAsPi } from "@/utils/angleFormat";

type PipelineNodeType = Node<PipelineNodeData>;

const handleClass =
  "!bg-accent !border-2 !border-surface !w-4 !h-4 hover:!scale-125 transition-transform";

function formatParamValue(name: string, value: unknown): string {
  if (name === "phi" && typeof value === "number") return formatRadiansAsPi(value);
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
}

export function PipelineGraphNode({ id, data, selected }: NodeProps<PipelineNodeType>) {
  // Only ever true when the GLOBAL "Physical press limit" toggle
  // (ViewportSidebar) is on -- when it's off, every node's own
  // force_correct_closure param is false, so slab_strike_diagnostics'
  // `capped` computation can never come back true in the first place
  // (see slab_nodes.py) -- no separate frontend gating needed here.
  const capped = usePipelineStore((s) => {
    const d = s.diagnostics[id];
    return Boolean(d?.capped) || Number(d?.n_capped ?? 0) > 0;
  });
  // Ops nodes report a gate-valued `feasible` (1 = legal action); < 1 means the
  // step asked for something the press/part can't do (grip, clearance, fold...).
  const infeasible = usePipelineStore((s) => {
    const f = s.diagnostics[id]?.feasible;
    return typeof f === "number" && f < 1;
  });
  // Ops nodes report the press load the step needs (N); tonnage is a design
  // output, so show it on the card -- the heaviest step stands out.
  const requiredLoad = usePipelineStore((s) => {
    const v = s.diagnostics[id]?.required_load_N;
    return typeof v === "number" && v > 0 ? v : null;
  });
  // Ops nodes report the process clock after the step and the temperature range.
  const timing = usePipelineStore((s) => {
    const d = s.diagnostics[id];
    const t = d?.time_s;
    if (typeof t !== "number") return null;
    const lo = d?.T_min_C;
    const hi = d?.T_max_C;
    return { t, lo: typeof lo === "number" ? lo : null, hi: typeof hi === "number" ? hi : null };
  });
  // Program generators attach a human-readable step `label` param.
  const label = typeof data.params.label === "string" && data.params.label ? data.params.label : null;
  const expandedNodes = usePipelineStore((s) => s.expandedNodes);
  const connectNearestTarget = usePipelineStore((s) => s.connectNearestTarget);

  return (
    <div
      className={`relative rounded-md border px-3 py-2 min-w-[150px] bg-panel shadow-md transition-colors ${
        selected ? "border-accent" : "border-border"
      }`}
    >
      <Handle type="target" position={Position.Left} className={handleClass} title="Drag from an upstream node's output dot here" />
      <div className="flex items-center gap-1.5">
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${data.cooked ? "bg-green-400" : "bg-gray-500"}`}
          title={data.cooked ? "cooked" : "stale — needs cook"}
        />
        <span className="text-xs font-semibold text-gray-200">{label ?? data.kind}</span>
      </div>
      {label && <div className="text-[10px] text-gray-500 pl-3">{data.kind}</div>}
      {requiredLoad !== null && (
        <div className="text-[10px] text-warn pl-3 tabular-nums" title="Estimated press load this step needs">
          needs {(requiredLoad / 1000).toFixed(0)} kN
        </div>
      )}
      {timing && (
        <div className="text-[10px] text-info pl-3 tabular-nums" title="Process clock after this step, and the part's temperature range">
          t {timing.t.toFixed(0)} s{timing.lo !== null && timing.hi !== null
            ? ` · ${timing.lo.toFixed(0)}–${timing.hi.toFixed(0)} °C` : ""}
        </div>
      )}
      {expandedNodes && (
        <div className="mt-1.5 pt-1.5 border-t border-border flex flex-col gap-0.5">
          {Object.entries(data.params).filter(([name]) => name !== "label").map(([name, value]) => (
            <div key={name} className="flex justify-between gap-3 text-[10px] text-gray-400 tabular-nums">
              <span className="text-gray-500">{name}</span>
              <span className="text-gray-300">{formatParamValue(name, value)}</span>
            </div>
          ))}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Right}
        className={handleClass}
        title="Drag to a downstream node's input dot, or double-click to auto-connect to the nearest available one"
        onDoubleClick={(e) => {
          e.stopPropagation();
          connectNearestTarget(id);
        }}
      />
      {capped && (
        <span
          title="Limited by physical press capacity -- requested closure exceeds what a real press achieves in one hit"
          className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 flex items-center justify-center rounded-full bg-amber-500 text-black text-[9px] font-bold leading-none"
        >
          !
        </span>
      )}
      {infeasible && (
        <span
          title="Infeasible step: the action breaks a press/part constraint (see the node's diagnostics)"
          className={`absolute -top-1.5 ${capped ? "right-3" : "-right-1.5"} w-3.5 h-3.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold leading-none`}
        >
          x
        </span>
      )}
    </div>
  );
}
