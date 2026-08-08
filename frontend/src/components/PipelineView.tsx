import { usePipelineStore } from "@/stores/pipelineStore";
import { GraphPanel } from "./GraphPanel";
import { NodeInspector } from "./NodeInspector";
import { MeshPanel } from "./MeshPanel";

export function PipelineView() {
  const { run, tag, setRun, setTag, selectedNodeId, cook, cooking } = usePipelineStore();

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 h-10 border-b border-border bg-panel shrink-0 text-xs">
        <span className="font-semibold text-gray-400 uppercase tracking-wide mr-1">Pipeline</span>
        <span className="text-gray-500">run</span>
        <input
          value={run}
          onChange={(e) => setRun(e.target.value)}
          className="bg-surface border border-border rounded px-2 py-1 w-32 text-gray-200"
        />
        <span className="text-gray-500">tag</span>
        <input
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          className="bg-surface border border-border rounded px-2 py-1 w-32 text-gray-200"
        />
        <button
          onClick={() => cook()}
          disabled={cooking}
          className="ml-2 px-3 py-1 rounded bg-accent text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {cooking ? "Cooking…" : "Cook"}
        </button>
        <span className="text-gray-500 ml-auto">
          Node output meshes are logged under tag <code className="text-gray-400">{`${tag}/<node id>`}</code>
        </span>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        <div className="h-1/2 min-h-0 border-b border-border">
          {selectedNodeId ? (
            <MeshPanel run={run} tag={`${tag}/${selectedNodeId}`} />
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-gray-500">
              Select a node to preview its cooked geometry.
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 min-w-0">
            <GraphPanel />
          </div>
          <div className="w-72 border-l border-border shrink-0">
            <NodeInspector />
          </div>
        </div>
      </div>
    </div>
  );
}
