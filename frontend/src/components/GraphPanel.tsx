import { useEffect } from "react";
import { ReactFlow, Background, Controls, Panel } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { usePipelineStore } from "@/stores/pipelineStore";
import { PipelineGraphNode } from "./PipelineGraphNode";
import type { PipelineNodeData } from "@/types/pipeline";
import type { Node } from "@xyflow/react";

const nodeTypes = { pipelineNode: PipelineGraphNode };

export function GraphPanel() {
  const {
    nodeKinds, nodes, edges, selectedNodeId,
    fetchNodeKinds, addNode, deleteNode, selectNode, resetGraph, clearCache,
    onNodesChange, onEdgesChange, onConnect,
  } = usePipelineStore();

  useEffect(() => {
    fetchNodeKinds();
  }, [fetchNodeKinds]);

  // Custom delete handling (not react-flow's built-in deleteKeyCode) so
  // removing a node also cleans up its edges and marks downstream nodes
  // stale via the store's own deleteNode.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (typing) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedNodeId) {
        deleteNode(selectedNodeId);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedNodeId, deleteNode]);

  return (
    <div className="h-full w-full bg-surface">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        deleteKeyCode={null}
        onNodeClick={(_, node: Node<PipelineNodeData>) => selectNode(node.id)}
        onPaneClick={() => selectNode(null)}
        fitView
        colorMode="dark"
      >
        <Background color="#2a2d3e" gap={18} />
        <Controls showInteractive={false} />
        <Panel position="top-left">
          <div className="flex gap-1.5 bg-panel border border-border rounded-md p-1.5">
            {nodeKinds.map((k) => (
              <button
                key={k.kind}
                onClick={() => addNode(k.kind)}
                className="text-xs px-2 py-1 rounded bg-surface border border-border text-gray-300 hover:border-accent hover:text-white transition-colors"
              >
                + {k.kind}
              </button>
            ))}
            {selectedNodeId && (
              <button
                onClick={() => deleteNode(selectedNodeId)}
                className="text-xs px-2 py-1 rounded bg-surface border border-border text-red-400 hover:border-red-400 transition-colors"
              >
                Delete node
              </button>
            )}
            <button
              onClick={resetGraph}
              title="Clear the graph and re-fetch node kinds from the server"
              className="text-xs px-2 py-1 rounded bg-surface border border-border text-gray-400 hover:border-accent hover:text-white transition-colors"
            >
              ↺ Reset
            </button>
            <button
              onClick={() => {
                if (window.confirm(
                  "Delete all nodes AND permanently release their cooked mesh data on the server " +
                  "(including SQLite history, if logging is enabled)? This can't be undone.",
                )) clearCache();
              }}
              title="Delete all nodes and purge their cooked meshes from the server buffer"
              className="text-xs px-2 py-1 rounded bg-surface border border-border text-red-400 hover:border-red-400 transition-colors"
            >
              🗑 Clear cache
            </button>
          </div>
        </Panel>
        <Panel position="top-right">
          <div className="text-[11px] px-2 py-1 rounded bg-panel border border-border text-gray-500">
            Shift-drag to box-select, ctrl/cmd-click to multi-select — use Path ▾ to export a selection
          </div>
        </Panel>
        {nodes.length > 0 && edges.length === 0 && (
          <Panel position="top-center">
            <div className="text-[11px] px-2 py-1 rounded bg-panel border border-border text-gray-400">
              Drag from a node's right dot to another node's left dot to connect them
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
