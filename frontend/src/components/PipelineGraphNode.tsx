import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { PipelineNodeData } from "@/types/pipeline";
import { usePipelineStore } from "@/stores/pipelineStore";

type PipelineNodeType = Node<PipelineNodeData>;

const handleClass =
  "!bg-accent !border-2 !border-surface !w-4 !h-4 hover:!scale-125 transition-transform";

export function PipelineGraphNode({ id, data, selected }: NodeProps<PipelineNodeType>) {
  // Only ever true when the GLOBAL "Physical press limit" toggle
  // (ViewportSidebar) is on -- when it's off, every node's own
  // force_correct_closure param is false, so slab_strike_diagnostics'
  // `capped` computation can never come back true in the first place
  // (see slab_nodes.py) -- no separate frontend gating needed here.
  const capped = usePipelineStore((s) => Boolean(s.diagnostics[id]?.capped));

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
        <span className="text-xs font-semibold text-gray-200">{data.kind}</span>
      </div>
      <Handle type="source" position={Position.Right} className={handleClass} title="Drag from here to a downstream node's input dot" />
      {capped && (
        <span
          title="Limited by physical press capacity -- requested closure exceeds what a real press achieves in one hit"
          className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 flex items-center justify-center rounded-full bg-amber-500 text-black text-[9px] font-bold leading-none"
        >
          !
        </span>
      )}
    </div>
  );
}
