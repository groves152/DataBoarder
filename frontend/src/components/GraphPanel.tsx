import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, ReactFlowProvider, Background, Panel, useReactFlow, type NodeChange, type OnNodesChange } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { usePipelineStore } from "@/stores/pipelineStore";
import { PipelineGraphNode } from "./PipelineGraphNode";
import { HeatingEdge, type HeatingEdgeData } from "./HeatingEdge";
import { RadialMenu } from "./RadialMenu";
import { Icon, IconButton } from "./icons";
import { layoutGraph } from "@/utils/graphLayout";
import { programLabel, programsOf } from "@/utils/programs";
import { ProgramCard, type ProgramCardData } from "./ProgramCard";
import { CHROME, seriesColor, useResolvedTheme } from "@/theme";
import type { PipelineNodeData } from "@/types/pipeline";
import type { Edge, Node } from "@xyflow/react";

const nodeTypes = { pipelineNode: PipelineGraphNode, programCard: ProgramCard };
// fit the view, but never zoom past 1:1 (two cards would fill the panel)
const FIT = { padding: 0.15, duration: 250, maxZoom: 1 };
const CARD_W = 270;
const CARD_H = 150;
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
  const { screenToFlowPosition, fitView, zoomIn, zoomOut } = useReactFlow();
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
    selectAllNodes, setNodePositions, layoutRequest, graphLevel, setGraphLevel, focusedProgram, focusProgram,
    canUndo, canRedo, undo, redo,
  } = usePipelineStore();
  const programsLevel = graphLevel === "programs";
  const programsLevelRef = useRef(programsLevel);
  programsLevelRef.current = programsLevel;

  const thermalKinds = useMemo(
    () => new Set(nodeKinds.filter((k) => k.category === "thermal").map((k) => k.kind)), [nodeKinds]);
  // "heats": thermal kinds that add heat (named so), vs. plain time in air
  const heatingKinds = useMemo(
    () => new Set([...thermalKinds].filter((k) => k.includes("heat"))), [thermalKinds]);
  // The hierarchy (utils/programs): one card per program, or the steps --
  // every program's, or only the one dived into (plus any loose nodes).
  const programs = useMemo(() => programsOf(nodes, edges), [nodes, edges]);
  const focused = programs.find((p) => p.root === focusedProgram);
  // Cards' dragged positions and measured sizes, by program root (React Flow
  // hides a node it gets without its `measured` size until it re-measures).
  const [cardPos, setCardPos] = useState<Record<string, { x: number; y: number }>>({});
  const [cardSize, setCardSize] = useState<Record<string, { width: number; height: number }>>({});
  const cards = useMemo(() => {
    const cols = Math.max(1, Math.ceil(Math.sqrt(programs.length * 1.5)));
    const labelOf = (id: string) => {
      const l = nodes.find((n) => n.id === id)?.data.params.label;
      return typeof l === "string" && l ? l : undefined;
    };
    return programs.map((p, i): Node<ProgramCardData> => ({
      id: `program:${p.root}`,
      type: "programCard",
      position: cardPos[p.root] ?? { x: (i % cols) * CARD_W, y: Math.floor(i / cols) * CARD_H },
      data: { root: p.root, label: programLabel(p, i, labelOf), nodeIds: p.nodeIds, color: seriesColor(i, theme) },
      selected: !!selectedNodeId && p.nodeIds.includes(selectedNodeId),
      measured: cardSize[p.root],
    }));
  }, [programs, nodes, cardPos, cardSize, selectedNodeId, theme]);
  // A node param that refers to another node ("node_ref": e.g. a controller's
  // subgoal) shows as a dashed link from that node -- display only: it isn't
  // an edge of the graph, and can't be selected or deleted.
  const refEdges = useMemo((): Edge[] => {
    const ids = new Set(nodes.map((n) => n.id));
    const out: Edge[] = [];
    for (const n of nodes) {
      const params = nodeKinds.find((k) => k.kind === n.data.kind)?.params ?? {};
      for (const [name, spec] of Object.entries(params)) {
        const ref = n.data.params[name];
        if (spec.type !== "node_ref" || typeof ref !== "string" || !ids.has(ref)) continue;
        out.push({ id: `ref:${ref}->${n.id}:${name}`, source: ref, target: n.id, selectable: false, deletable: false,
                   focusable: false, style: { stroke: "#fbbf24", strokeDasharray: "5 4", opacity: 0.8 } });
      }
    }
    return out;
  }, [nodes, nodeKinds]);
  const view = useMemo((): { nodes: Node[]; edges: Edge[] } => {
    if (programsLevel) return { nodes: cards, edges: [] };
    const folded = expandHeating ? { nodes, edges } : foldThermal(nodes, edges, thermalKinds, heatingKinds);
    const all = { nodes: folded.nodes, edges: [...folded.edges, ...refEdges] };
    if (!focused) return all;
    const shown = new Set([...focused.nodeIds, ...programs.filter((p) => p.nodeIds.length === 1).map((p) => p.root)]);
    return {
      nodes: all.nodes.map((n) => (shown.has(n.id) ? n : { ...n, hidden: true })),
      edges: all.edges.filter((e) => shown.has(e.source) && shown.has(e.target)),
    };
  }, [programsLevel, cards, expandHeating, nodes, edges, thermalKinds, heatingKinds, focused, programs, refEdges]);
  // Changing level / diving in: fit what's now shown.
  useEffect(() => {
    const t = setTimeout(() => fitView(FIT), 60);
    return () => clearTimeout(t);
  }, [graphLevel, focusedProgram, fitView]);

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
      const cmdOrCtrl = e.metaKey || e.ctrlKey;
      // Undo / redo anywhere but in a text field (which has its own): a
      // focused slider or checkbox still undoes graph edits.
      const textField = target && (target.tagName === "TEXTAREA" || target.isContentEditable
        || (target.tagName === "INPUT" && !["range", "checkbox", "radio", "button"].includes((target as HTMLInputElement).type)));
      if (!textField && cmdOrCtrl && (e.key.toLowerCase() === "z" || (e.ctrlKey && e.key.toLowerCase() === "y"))) {
        e.preventDefault();
        if (e.key.toLowerCase() === "y" || e.shiftKey) redo();
        else undo();
        return;
      }
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (typing) return;
      // the programs level has no steps to delete / select / copy here
      if (programsLevelRef.current && e.key !== "Tab") return;
      if (e.key === "Tab" && lastPointer.current) {
        // Tab with the pointer over the canvas: the node menu at the pointer
        e.preventDefault();
        openMenuAt(lastPointer.current.x, lastPointer.current.y);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        deleteSelectedNodes();
      }
      if (cmdOrCtrl && e.key.toLowerCase() === "a" && lastPointer.current) {
        // Cmd/Ctrl+A with the pointer over the graph: select every node (elsewhere: the browser's own)
        e.preventDefault();
        selectAllNodes();
      }
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
  }, [deleteSelectedNodes, copyNodes, paste, openMenuAt, selectAllNodes, undo, redo]);

  // "Clean up": positions that fit the panel (utils/graphLayout), then fit the view.
  const cleanUp = useCallback(() => {
    if (programsLevel) { // cards back on their grid
      setCardPos({});
      requestAnimationFrame(() => fitView(FIT));
      return;
    }
    const el = wrapperRef.current;
    const visible = view.nodes.filter((n) => !n.hidden);
    if (!el || visible.length === 0) return;
    setNodePositions(layoutGraph(visible, view.edges, el.clientWidth, el.clientHeight));
    requestAnimationFrame(() => fitView(FIT));
  }, [programsLevel, view, setNodePositions, fitView]);
  // A freshly loaded program is laid out once its nodes have been measured.
  const cleanUpRef = useRef(cleanUp);
  cleanUpRef.current = cleanUp;
  useEffect(() => {
    if (layoutRequest === 0) return;
    const t = setTimeout(() => cleanUpRef.current(), 120);
    return () => clearTimeout(t);
  }, [layoutRequest]);

  const anySelected = !!selectedNodeId || nodes.some((n) => n.selected);

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
            if (programsLevel) setGraphLevel("nodes"); // show the new step
            setMenu(null);
          }}
        />
      )}
      <ReactFlow
        nodes={view.nodes}
        edges={view.edges}
        edgeTypes={edgeTypes}
        onNodesChange={programsLevel ? (changes: NodeChange[]) => {
          // cards: their dragged positions and measured sizes are kept (locally)
          const root = (id: string) => id.slice("program:".length);
          const moved = changes.flatMap((c) => (c.type === "position" && c.position ? [[root(c.id), c.position] as const] : []));
          const sized = changes.flatMap((c) => (c.type === "dimensions" && c.dimensions ? [[root(c.id), c.dimensions] as const] : []));
          if (moved.length) setCardPos((p) => ({ ...p, ...Object.fromEntries(moved) }));
          if (sized.length) setCardSize((p) => ({ ...p, ...Object.fromEntries(sized) }));
        } : (onNodesChange as OnNodesChange)}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        deleteKeyCode={null}
        onNodeClick={(_, node: Node) => {
          // a card shows its program's final part
          if (node.type === "programCard") selectNode((node.data as ProgramCardData).nodeIds.at(-1) ?? null);
          else selectNode(node.id);
        }}
        onNodeDoubleClick={(_, node: Node) => {
          if (node.type === "programCard") focusProgram((node.data as ProgramCardData).root);
        }}
        onPaneClick={() => selectNode(null)}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          openMenuAt(e.clientX, e.clientY);
        }}
        // trackpad: two-finger scroll pans, pinch zooms (a mouse wheel pans too; ctrl+wheel zooms)
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        proOptions={{ hideAttribution: true }}
        fitView
        colorMode={theme}
      >
        <Background color={CHROME[theme].grid} gap={18} />
        {(programsLevel || focused) && (
          <Panel position="top-left">
            <div className="text-[11px] text-gray-400 flex items-center gap-1">
              {programsLevel ? <span>{programs.length} program{programs.length === 1 ? "" : "s"}: double-click one to open its steps</span> : (
                <>
                  <button onClick={() => setGraphLevel("programs")} className="hover:text-gray-100 underline decoration-dotted">
                    Programs
                  </button>
                  <span>›</span>
                  <span className="text-gray-200">{cards.find((c) => c.data.root === focused?.root)?.data.label}</span>
                </>
              )}
            </div>
          </Panel>
        )}
        <Panel position="center-left">
          <div className="flex flex-col gap-1">
            {focused && !programsLevel && (
              <IconButton icon="up" label="Up: every program as one card" onClick={() => setGraphLevel("programs")} />
            )}
            <IconButton icon="undo" label="Undo (Cmd/Ctrl+Z)" onClick={undo} disabled={!canUndo} />
            <IconButton icon="redo" label="Redo (Cmd/Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo} />
            <div className="h-px bg-border my-0.5" />
            <IconButton icon="selectAll" label="Select all (Cmd/Ctrl+A)" onClick={selectAllNodes}
                        disabled={nodes.length === 0 || programsLevel} />
            <IconButton icon="trash" label="Delete selected nodes (Delete)" onClick={deleteSelectedNodes} danger
                        disabled={!anySelected || programsLevel} />
            <IconButton icon="mesh" label="Mesh selected forge_net nodes (LSQR surface reconstruction)"
                        onClick={meshSelectedNodes} disabled={!anySelected || programsLevel} />
            <div className="h-px bg-border my-0.5" />
            <IconButton icon="layout" label="Clean up: arrange the nodes to fit this panel" onClick={cleanUp}
                        disabled={nodes.length === 0} />
            <IconButton icon="fit" label="Fit the view" onClick={() => fitView(FIT)} />
            <IconButton icon="zoomIn" label="Zoom in (or pinch)" onClick={() => zoomIn({ duration: 150 })} />
            <IconButton icon="zoomOut" label="Zoom out (or pinch)" onClick={() => zoomOut({ duration: 150 })} />
            <div className="h-px bg-border my-0.5" />
            <IconButton icon="reset" label="Reset: clear the graph and re-fetch node kinds" onClick={resetGraph} />
            <IconButton icon="purge" label="Clear cache: delete all nodes and purge their cooked meshes" danger
                        onClick={() => {
                          if (window.confirm(
                            "Delete all nodes AND permanently release their cooked mesh data on the server " +
                            "(including SQLite history, if logging is enabled)? This can't be undone.",
                          )) clearCache();
                        }} />
          </div>
        </Panel>
        <Panel position="center-right">
          <div className="flex flex-col gap-1">
            <IconButton icon="programs" side="left" active={programsLevel} disabled={nodes.length === 0}
                        onClick={() => (programsLevel ? focusProgram(null) : setGraphLevel("programs"))}
                        label={programsLevel ? "Back to the steps (every program)" : "Programs: one card per program, to compare them"} />
            <IconButton icon="expand" side="left" active={expandedNodes} onClick={() => setExpandedNodes(!expandedNodes)}
                        label={expandedNodes ? "Collapse node cards" : "Expand nodes: show every param on its card"} />
            {thermalKinds.size > 0 && (
              <IconButton icon="flame" side="left" active={expandHeating} onClick={() => setExpandHeating(!expandHeating)}
                          label={expandHeating ? "Fold heating / dwell steps into the edges"
                                               : "Expand heating actions: show heating / dwell steps as nodes"} />
            )}
          </div>
        </Panel>
        <Panel position="bottom-right">
          <button
            title="Add a node (or right-click / Tab on the canvas)"
            aria-label="Add a node"
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              // open up and to the left of the button, far enough in that both rings fit
              openMenuAt(r.left + r.width / 2 - 190, r.top + r.height / 2 - 190);
            }}
            className="w-10 h-10 rounded-full bg-accent text-white shadow-lg hover:brightness-110 transition flex items-center justify-center"
          >
            <Icon name="plus" className="w-5 h-5" />
          </button>
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
