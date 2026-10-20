import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { NodeBadge, PipelineNodeData } from "@/types/pipeline";
import { usePipelineStore } from "@/stores/pipelineStore";
import { formatRadiansAsPi } from "@/utils/angleFormat";

type PipelineNodeType = Node<PipelineNodeData>;

const handleClass =
  "!bg-accent !border-2 !border-surface !w-4 !h-4 hover:!scale-125 transition-transform";
// a side input that may be left unconnected (a controller's goal): hollow
const optionalHandleClass =
  "!bg-surface !border-2 !border-amber-400 !w-4 !h-4 hover:!scale-125 transition-transform";

const BADGE_TONE: Record<string, string> = {
  ok: "text-green-300 border-green-500/50 bg-green-500/10",
  bad: "text-red-300 border-red-500/60 bg-red-500/10",
  warn: "text-amber-300 border-amber-500/60 bg-amber-500/10",
  info: "text-sky-300 border-sky-500/50 bg-sky-500/10",
};

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
  // Several inputs (a controller: its state, and its goal): a labelled handle each.
  const schema = usePipelineStore((s) => s.nodeKinds.find((k) => k.kind === data.kind));
  const inputs = schema?.inputs ?? [];
  // (a string: a new Set per store change would re-render every node)
  const connected = usePipelineStore((s) => s.edges.filter((e) => e.target === id).map((e) => e.targetHandle || "state").join(","))
    .split(",");
  const badges = usePipelineStore((s) => s.diagnostics[id]?.badges) as NodeBadge[] | undefined;
  const frozenStale = usePipelineStore((s) => s.frozenStale[id]);

  return (
    <div
      className={`relative rounded-md border px-3 py-2 min-w-[150px] bg-panel shadow-md transition-colors ${
        selected ? "border-accent" : "border-border"
      }`}
    >
      {inputs.length <= 1 ? (
        <Handle type="target" position={Position.Left} className={handleClass} title="Drag from an upstream node's output dot here" />
      ) : inputs.map((name, i) => {
        const optional = schema?.optional?.includes(name);
        const top = `${((i + 1) / (inputs.length + 1)) * 100}%`;
        return (
          <div key={name}>
            <Handle type="target" id={name} position={Position.Left} style={{ top }}
                    className={optional && !connected.includes(name) ? optionalHandleClass : handleClass}
                    title={i === 0 ? `${name}: the part before it (drag an upstream node's output here)`
                      : `${name}${optional ? " (optional)" : ""}: drag the node it aims at here`} />
            <span className="absolute left-2.5 -translate-y-1/2 text-[9px] text-gray-500 pointer-events-none" style={{ top }}>
              {name}
            </span>
          </div>
        );
      })}
      <div className={`flex items-center gap-1.5 ${inputs.length > 1 ? "pl-7 min-h-[30px]" : ""}`}>
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${data.cooked ? "bg-green-400" : "bg-gray-500"}`}
          title={data.cooked ? "cooked" : "stale — needs cook"}
        />
        <span className="text-xs font-semibold text-gray-200">{label ?? data.kind}</span>
        {data.frozen && (
          <span className={`text-[10px] ${frozenStale ? "text-amber-400" : "text-sky-300"}`}
                title={frozenStale ? "Frozen, and what's before it has changed since: unfreeze to re-run it"
                  : "Frozen: keeps its result whatever changes before it"}>
            ❄{frozenStale ? " stale" : ""}
          </span>
        )}
      </div>
      {label && <div className={`text-[10px] text-gray-500 ${inputs.length > 1 ? "pl-10" : "pl-3"}`}>{data.kind}</div>}
      {badges && badges.length > 0 && (
        <div className={`flex flex-wrap gap-1 mt-1 ${inputs.length > 1 ? "pl-7" : "pl-3"}`}>
          {badges.map((b) => (
            <span key={b.text} title={b.title}
                  className={`px-1 rounded border text-[10px] tabular-nums ${BADGE_TONE[b.tone ?? ""] ?? "text-gray-300 border-border"}`}>
              {b.text}
            </span>
          ))}
        </div>
      )}
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
