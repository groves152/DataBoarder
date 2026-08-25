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
    fetchNodeKinds, addNode, deleteSelectedNodes, selectNode, resetGraph, clearCache,
    onNodesChange, onEdgesChange, onConnect,
    copyNodes, paste, expandedNodes, setExpandedNodes,
  } = usePipelineStore();

  useEffect(() => {
    fetchNodeKinds();
  }, [fetchNodeKinds]);

  // Custom delete/copy/paste handling (not react-flow's built-ins) so
  // delete also cleans up edges/marks downstream stale AND covers a
  // multi-selection (via the store's own deleteSelectedNodes), and
  // copy/paste work on NODE PARAMS (or, pasting into empty space, whole
  // new nodes) rather than react-flow's own node-object clipboard concept.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (typing) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        deleteSelectedNodes();
      }
      const cmdOrCtrl = e.metaKey || e.ctrlKey;
      if (cmdOrCtrl && e.key.toLowerCase() === "c") {
        e.preventDefault();
        copyNodes();
      }
      if (cmdOrCtrl && e.key.toLowerCase() === "v") {
        e.preventDefault();
        paste();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelectedNodes, copyNodes, paste]);

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
                onClick={() => deleteSelectedNodes()}
                title="Deletes every multi-selected node if any, else just this one"
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
          <div className="flex items-center gap-2">
            <label
              className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] px-2 py-1 rounded bg-panel border border-border text-gray-400"
              title="Show every node's current param values inline on its card"
            >
              <input
                type="checkbox"
                checked={expandedNodes}
                onChange={(e) => setExpandedNodes(e.target.checked)}
                className="accent-accent"
              />
              <span>Expand nodes</span>
            </label>
            <div className="text-[11px] px-2 py-1 rounded bg-panel border border-border text-gray-500">
              Shift-drag to box-select, ctrl/cmd-click to multi-select — use Path ▾ to export a selection
            </div>
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
