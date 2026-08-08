import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { PipelineNodeData } from "@/types/pipeline";

type PipelineNodeType = Node<PipelineNodeData>;

const handleClass =
  "!bg-accent !border-2 !border-surface !w-4 !h-4 hover:!scale-125 transition-transform";

export function PipelineGraphNode({ data, selected }: NodeProps<PipelineNodeType>) {
  return (
    <div
      className={`rounded-md border px-3 py-2 min-w-[150px] bg-panel shadow-md transition-colors ${
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
    </div>
  );
}
