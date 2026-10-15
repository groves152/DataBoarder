import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, ReactFlowProvider, Background, Controls, Panel, useReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { usePipelineStore } from "@/stores/pipelineStore";
import { PipelineGraphNode } from "./PipelineGraphNode";
import { HeatingEdge, type HeatingEdgeData } from "./HeatingEdge";
import { RadialMenu } from "./RadialMenu";
import { CHROME, useResolvedTheme } from "@/theme";
import type { PipelineNodeData } from "@/types/pipeline";
import type { Edge, Node } from "@xyflow/react";

const nodeTypes = { pipelineNode: PipelineGraphNode };
const edgeTypes = { heating: HeatingEdge };

// Folds runs of "thermal" nodes (category from the server: heating, dwell --
// steps that change only temperature/time) out of view: each edge into such a
// run is replaced by one `heating` edge from its source to the first forging
// node after the run. Purely a view: the store's nodes/edges (what cooks) are
// untouched.
function foldThermal(
  nodes: Node<PipelineNodeData>[], edges: Edge[], thermalKinds: Set<string>, heatingKinds: Set<string>,
): { nodes: Node<PipelineNodeData>[]; edges: Edge[] } {
  const hidden = new Set(nodes.filter((n) => thermalKinds.has(n.data.kind)).map((n) => n.id));
  if (hidden.size === 0) return { nodes, edges };
  const kindOf = new Map(nodes.map((n) => [n.id, n.data.kind]));
  const out = new Map<string, Edge[]>();
  for (const e of edges) out.set(e.source, [...(out.get(e.source) ?? []), e]);
  const shown: Edge[] = [];
  for (const e of edges) {
    if (hidden.has(e.source)) continue;
    if (!hidden.has(e.target)) {
      shown.push(e);
      continue;
    }
    const folded: string[] = [];
    let cur = e.target;
    while (hidden.has(cur) && !folded.includes(cur)) {
      folded.push(cur);
      const next = out.get(cur)?.[0];
      if (!next) break;
      cur = next.target;
    }
    if (hidden.has(cur)) continue; // the chain ends in thermal steps: nothing to bridge to
    const data: HeatingEdgeData = { folded, heats: folded.some((id) => heatingKinds.has(kindOf.get(id) ?? "")) };
    shown.push({ id: `fold:${e.id}`, source: e.source, target: cur, type: "heating", data,
                 selectable: false, deletable: false });
  }
  return { nodes: nodes.map((n) => (hidden.has(n.id) ? { ...n, hidden: true } : n)), edges: shown };
}

export function GraphPanel() {
  return (
    <ReactFlowProvider>
      <GraphCanvas />
    </ReactFlowProvider>
  );
}

type MenuState = { x: number; y: number; flow: { x: number; y: number } } | null;

function GraphCanvas() {
  const theme = useResolvedTheme();
  const { screenToFlowPosition } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const openMenuAt = useCallback(
    (x: number, y: number) => setMenu({ x, y, flow: screenToFlowPosition({ x, y }) }),
    [screenToFlowPosition],
  );
  const {
    nodeKinds, nodes, edges, selectedNodeId,
    fetchNodeKinds, addNode, deleteSelectedNodes, selectNode, resetGraph, clearCache,
    onNodesChange, onEdgesChange, onConnect,
    copyNodes, paste, expandedNodes, setExpandedNodes, meshSelectedNodes, expandHeating, setExpandHeating,
  } = usePipelineStore();

  const thermalKinds = useMemo(
    () => new Set(nodeKinds.filter((k) => k.category === "thermal").map((k) => k.kind)), [nodeKinds]);
  // "heats": thermal kinds that add heat (named so), vs. plain time in air
  const heatingKinds = useMemo(
    () => new Set([...thermalKinds].filter((k) => k.includes("heat"))), [thermalKinds]);
  const view = useMemo(
    () => (expandHeating ? { nodes, edges } : foldThermal(nodes, edges, thermalKinds, heatingKinds)),
    [expandHeating, nodes, edges, thermalKinds, heatingKinds],
  );

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
      if (e.key === "Tab" && lastPointer.current) {
        // Tab with the pointer over the canvas: the node menu at the pointer
        e.preventDefault();
        openMenuAt(lastPointer.current.x, lastPointer.current.y);
        return;
      }
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
  }, [deleteSelectedNodes, copyNodes, paste, openMenuAt]);

  return (
    <div
      ref={wrapperRef}
      className="h-full w-full bg-surface"
      onMouseMove={(e) => { lastPointer.current = { x: e.clientX, y: e.clientY }; }}
      onMouseLeave={() => { lastPointer.current = null; }}
    >
      {menu && (
        <RadialMenu
          x={menu.x}
          y={menu.y}
          kinds={nodeKinds}
          onClose={() => setMenu(null)}
          onPick={(kind) => {
            addNode(kind, menu.flow);
            setMenu(null);
          }}
        />
      )}
      <ReactFlow
        nodes={view.nodes}
        edges={view.edges}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        deleteKeyCode={null}
        onNodeClick={(_, node: Node<PipelineNodeData>) => selectNode(node.id)}
        onPaneClick={() => selectNode(null)}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          openMenuAt(e.clientX, e.clientY);
        }}
        fitView
        colorMode={theme}
      >
        <Background color={CHROME[theme].grid} gap={18} />
        <Controls showInteractive={false} />
        <Panel position="top-left">
          <div className="flex items-center gap-1.5">
            <button
              title="Add a node (or right-click / Tab on the canvas)"
              onClick={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                // open beside the button, far enough in that both rings fit on the canvas
                openMenuAt(r.left + r.width / 2 + 190, r.top + r.height / 2 + 190);
              }}
              className="w-10 h-10 rounded-full bg-accent text-white text-2xl leading-none shadow-lg hover:brightness-110 transition flex items-center justify-center"
            >
              +
            </button>
            <div className="flex gap-1.5 bg-panel border border-border rounded-md p-1">
            {selectedNodeId && (
              <button
                onClick={() => deleteSelectedNodes()}
                title="Deletes every multi-selected node if any, else just this one"
                className="text-xs px-2 py-1 rounded bg-surface border border-border text-red-400 hover:border-red-400 transition-colors"
              >
                Delete node
              </button>
            )}
            {selectedNodeId && (
              <button
                onClick={() => meshSelectedNodes()}
                title="Runs LSQR mesh reconstruction for every multi-selected forge_net node (or just this one) -- forge_net's own live autocook only ever shows the raw point cloud; this turns it into a real triangulated surface on demand"
                className="text-xs px-2 py-1 rounded bg-surface border border-border text-gray-300 hover:border-accent hover:text-gray-100 transition-colors"
              >
                🔗 Mesh selected
              </button>
            )}
            <button
              onClick={resetGraph}
              title="Clear the graph and re-fetch node kinds from the server"
              className="text-xs px-2 py-1 rounded bg-surface border border-border text-gray-400 hover:border-accent hover:text-gray-100 transition-colors"
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
          </div>
        </Panel>
        <Panel position="top-right">
          <div className="flex items-center gap-2">
            <label
              className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] px-2 py-1 rounded bg-panel border border-border text-gray-400"
              title="Show every node's current param values inline on its card. (Shift-drag to box-select, ctrl/cmd-click to multi-select; Path ▾ exports a selection.)"
            >
              <input
                type="checkbox"
                checked={expandedNodes}
                onChange={(e) => setExpandedNodes(e.target.checked)}
                className="accent-accent"
              />
              <span>Expand nodes</span>
            </label>
            {thermalKinds.size > 0 && (
              <label
                className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] px-2 py-1 rounded bg-panel border border-border text-gray-400"
                title="Show heating / dwell steps as their own nodes. Off: they fold into a 🔥 badge on the edge between forging steps (click it to inspect)."
              >
                <input
                  type="checkbox"
                  checked={expandHeating}
                  onChange={(e) => setExpandHeating(e.target.checked)}
                  className="accent-accent"
                />
                <span>Expand heating actions</span>
              </label>
            )}

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
