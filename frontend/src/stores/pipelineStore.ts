import { create } from "zustand";
import {
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from "@xyflow/react";
import type {
  NodeKindSchema, PipelineNodeData, CookResponse, NodeDiagnostics, ParamValue,
  PathJson, PathNodeSpec, GeneratorSchema, GraphJson,
} from "@/types/pipeline";

const AUTO_COOK_DEBOUNCE_MS = 500;

// Must match forge_search.ui_nodes.targets.TARGETS_RUN/TARGETS_TAG_PREFIX.
// Exported so components building a goal mesh's (run, tag) pair (e.g.
// GoalOverlay via PipelineView) share this one definition.
export const TARGETS_RUN = "_targets";
export const TARGETS_TAG_PREFIX = "targets/";

let nodeIdCounter = 0;
function nextNodeId(kind: string): string {
  nodeIdCounter += 1;
  return `${kind}_${nodeIdCounter}`;
}

// All current node kinds take at most one upstream input, always named
// "state" (see forge_genie's slab_nodes.py) -- so every edge implicitly
// targets that input. Revisit if/when a multi-input node kind exists.
const DEFAULT_TARGET_INPUT = "state";

let autoCookTimer: ReturnType<typeof setTimeout> | null = null;
// Guards against an out-of-order network response: e.g. an auto-cook from
// a prior param edit is still in flight when the user immediately triggers
// a second cook (picking a goal calls cook() right away, see setGoalName)
// -- if the FIRST (now-stale) response happened to arrive AFTER the
// second, it would silently overwrite the fresh diagnostics with the old,
// goal-less ones. Each cook() call claims the next id; a response is only
// applied if its id still matches the most recent call when it resolves.
let cookRequestId = 0;

interface PipelineStore {
  nodeKinds: NodeKindSchema[];
  generatorSchemas: GeneratorSchema[];
  nodes: Node<PipelineNodeData>[];
  edges: Edge[];
  selectedNodeId: string | null;
  run: string;
  tag: string;
  cooking: boolean;
  cookError: string | null;
  // node id -> extra info from its last cook (e.g. "was a param capped").
  diagnostics: Record<string, NodeDiagnostics>;
  // Whether the viewport shows the whole cooked chain's step-indexed
  // "{tag}/__sequence__" history (scrub/play via MeshPanel's own frame
  // mechanism) instead of the currently-selected node's single mesh.
  viewSequence: boolean;

  // Target/goal mesh overlay -- selection lives here (not local component
  // state) because Feature 3's reward diagnostics also need to know which
  // goal is selected, via `cook()`'s `context` payload below.
  goalName: string | null;
  goalVisible: boolean;
  goalOpacity: number;
  availableGoals: string[];

  // Billet opacity -- global, applies to whichever mesh is currently
  // shown regardless of which node is selected/playing (unlike an
  // earlier version that lived as a per-slab_stock-node param: that
  // reset to fully opaque the moment you selected a DIFFERENT node,
  // since only the stock kind had the param at all). Same "lives outside
  // any one node, applies everywhere" pattern as goalOpacity above.
  billetOpacity: number;

  // Whether to render the press-die overlay for the selected strike node.
  // Lives here (not local component state) now that it's controlled from
  // ViewportSidebar rather than PipelineView directly.
  showPressPreview: boolean;

  // Default `tool` value for NEWLY created nodes only -- deliberately NOT
  // retroactive (unlike forceCorrectClosure below), matching the ask to
  // set a default while still letting any individual node override it via
  // its own NodeInspector param. null until fetchNodeKinds resolves and
  // seeds it from whichever node kind's schema has a "tool" param.
  defaultTool: string | null;

  // Physical press limit -- GLOBAL, unlike defaultTool: toggling this
  // rewrites every existing node's own "force_correct_closure" param (not
  // just future ones), matching the ask that ON caps every action's
  // achievable closure and OFF allows arbitrary closures everywhere, with
  // no per-node override left in NodeInspector.
  forceCorrectClosure: boolean;

  setRun: (run: string) => void;
  setTag: (tag: string) => void;
  fetchNodeKinds: () => Promise<void>;
  fetchGeneratorSchemas: () => Promise<void>;
  addNode: (kind: string, position?: { x: number; y: number }) => void;
  deleteNode: (id: string) => void;
  selectNode: (id: string | null) => void;
  updateNodeParam: (id: string, paramName: string, value: ParamValue) => void;
  setViewSequence: (v: boolean) => void;

  setGoalName: (name: string | null) => void;
  setGoalVisible: (v: boolean) => void;
  setGoalOpacity: (v: number) => void;
  fetchAvailableGoals: () => Promise<void>;
  setBilletOpacity: (v: number) => void;
  setShowPressPreview: (v: boolean) => void;
  setDefaultTool: (v: string) => void;
  setForceCorrectClosure: (v: boolean) => void;

  onNodesChange: OnNodesChange<Node<PipelineNodeData>>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;

  cook: () => Promise<void>;
  scheduleAutoCook: () => void;
  resetGraph: () => void;
  // Clears BOTH the local graph (nodes/edges/selection, via resetGraph)
  // AND the server's cooked-mesh buffer for this run/tag prefix -- unlike
  // resetGraph alone, which only ever touched local state (see its own
  // docstring), this actually releases cooked mesh data server-side.
  clearCache: () => Promise<void>;

  // Replaces the whole graph with a root node + linear step chain built
  // from a path JSON (import, or a just-generated path) and cooks it.
  loadPath: (path: PathJson) => void;
  // Walks the current graph as a linear chain (one root with no incoming
  // edges, then each node feeding exactly the next) and emits it as a
  // path JSON. Returns null if the graph branches/merges/is empty --
  // paths are a strictly linear subset of what the graph editor allows.
  exportPath: () => PathJson | null;

  // Replaces the whole graph with an arbitrary-topology graph JSON
  // (nodes+edges) -- ids are remapped to fresh session-local ids so an
  // import never collides with anything already on the canvas.
  importGraph: (graph: GraphJson) => void;
  // Dumps the current graph (or, if `onlySelected`, just the nodes with
  // `.selected` set -- react-flow's native multi-select, box-drag or
  // ctrl/cmd+click -- plus the edges between them) as raw graph JSON.
  // Unlike `exportPath`, arbitrary topology is fine here. Returns null if
  // the chosen node set is empty.
  exportGraph: (onlySelected: boolean) => GraphJson | null;
}

function markAllStale(nodes: Node<PipelineNodeData>[]): Node<PipelineNodeData>[] {
  return nodes.map((n) => (n.data.cooked ? { ...n, data: { ...n.data, cooked: false } } : n));
}

export const usePipelineStore = create<PipelineStore>((set, get) => ({
  nodeKinds: [],
  generatorSchemas: [],
  nodes: [],
  edges: [],
  selectedNodeId: null,
  run: "default",
  tag: "graph",
  cooking: false,
  cookError: null,
  diagnostics: {},
  viewSequence: false,

  goalName: null,
  goalVisible: true,
  goalOpacity: 0.35,
  billetOpacity: 1.0,
  availableGoals: [],
  showPressPreview: true,
  defaultTool: null,
  forceCorrectClosure: true,

  setRun: (run) => set({ run }),
  setTag: (tag) => set({ tag }),
  setViewSequence: (v) => set({ viewSequence: v }),

  setGoalName: (name) => {
    set({ goalName: name });
    // Reward diagnostics (if any goal-aware node kind is registered)
    // depend on which goal is selected -- refresh immediately rather than
    // waiting for the next unrelated debounced edit, so switching goals
    // doesn't leave a stale reward displayed.
    get().cook();
  },
  setGoalVisible: (v) => set({ goalVisible: v }),
  setGoalOpacity: (v) => set({ goalOpacity: v }),
  setBilletOpacity: (v) => set({ billetOpacity: v }),
  setShowPressPreview: (v) => set({ showPressPreview: v }),
  setDefaultTool: (v) => set({ defaultTool: v }),

  // Rewrites EVERY existing node's own "force_correct_closure" param (any
  // kind that happens to have one, detected by presence not by hardcoding
  // "slab_strike") to match, then re-cooks immediately -- unlike a
  // per-node param edit, this is a global physical-capability switch, so
  // every already-placed strike should reflect it right away, not just
  // future ones.
  setForceCorrectClosure: (v) => {
    set((s) => ({
      forceCorrectClosure: v,
      nodes: s.nodes.map((n) =>
        "force_correct_closure" in n.data.params
          ? { ...n, data: { ...n.data, params: { ...n.data.params, force_correct_closure: v }, cooked: false } }
          : n,
      ),
    }));
    get().cook();
  },

  fetchAvailableGoals: async () => {
    const res = await fetch(`/api/tags?run=${encodeURIComponent(TARGETS_RUN)}`);
    const data: { tags: string[] } = await res.json();
    set({
      availableGoals: data.tags
        .filter((t) => t.startsWith(TARGETS_TAG_PREFIX))
        .map((t) => t.slice(TARGETS_TAG_PREFIX.length))
        .sort(),
    });
  },

  fetchNodeKinds: async () => {
    const res = await fetch("/api/pipeline/node_kinds");
    const data: { kinds: NodeKindSchema[] } = await res.json();
    set((s) => {
      // Seed defaultTool from whichever node kind's schema has a "tool"
      // param, ONLY if nothing's been chosen yet -- a user's own pick (or
      // a re-fetch after a server restart) should never be silently
      // clobbered back to the schema default.
      if (s.defaultTool !== null) return { nodeKinds: data.kinds };
      const toolSpec = data.kinds.find((k) => k.params.tool)?.params.tool;
      return { nodeKinds: data.kinds, defaultTool: toolSpec ? String(toolSpec.default) : null };
    });
  },

  fetchGeneratorSchemas: async () => {
    const res = await fetch("/api/pipeline/generators");
    const data: { generators: GeneratorSchema[] } = await res.json();
    set({ generatorSchemas: data.generators });
  },

  addNode: (kind, position) => {
    const schema = get().nodeKinds.find((k) => k.kind === kind);
    if (!schema) return;
    const params: Record<string, ParamValue> = {};
    for (const [name, spec] of Object.entries(schema.params)) {
      params[name] = spec.default;
    }
    // Global overrides for these two specific, deliberately-named params
    // (not "any param a global setting happens to exist for") -- avoids
    // surprising a future node kind that reuses a param name for
    // something unrelated. defaultTool only affects NEW nodes (existing
    // ones keep whatever they have); forceCorrectClosure's retroactive
    // rewrite of EXISTING nodes lives in setForceCorrectClosure instead.
    const { defaultTool, forceCorrectClosure } = get();
    if (defaultTool !== null && "tool" in params) params["tool"] = defaultTool;
    if ("force_correct_closure" in params) params["force_correct_closure"] = forceCorrectClosure;
    // Every new node otherwise starts at the exact same default params --
    // fine for the first of a kind, but chaining several strike nodes
    // without hand-editing each one makes every strike land on the same
    // spot (reported directly: "always hitting in the center"). Nudge the
    // position/angle params (if this kind has them) so a naive chain
    // spreads out instead. Named-param special case, not fully generic --
    // deliberate, since blindly spreading an arbitrary "first float param"
    // could just as easily hit something like radius instead.
    const sameKindCount = get().nodes.filter((n) => n.data.kind === kind).length;
    if (sameKindCount > 0) {
      const zSpec = schema.params["z"];
      if (zSpec && zSpec.min !== undefined && zSpec.max !== undefined) {
        const span = zSpec.max - zSpec.min;
        const positions = 4;
        params["z"] = zSpec.min + span * (0.2 + 0.6 * ((sameKindCount % positions) / (positions - 1)));
      }
      const phiSpec = schema.params["phi"];
      if (phiSpec && phiSpec.min !== undefined && phiSpec.max !== undefined) {
        params["phi"] = sameKindCount % 2 === 0 ? phiSpec.min : (phiSpec.min + phiSpec.max) / 2;
      }
    }
    const id = nextNodeId(kind);
    const node: Node<PipelineNodeData> = {
      id,
      type: "pipelineNode",
      position: position ?? { x: 80 + (get().nodes.length % 5) * 220, y: 80 + Math.floor(get().nodes.length / 5) * 160 },
      data: { kind, params, cooked: false },
    };
    set((s) => ({ nodes: [...s.nodes, node], selectedNodeId: id }));
  },

  deleteNode: (id) => {
    set((s) => ({
      nodes: markAllStale(s.nodes.filter((n) => n.id !== id)),
      edges: s.edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
    }));
    get().scheduleAutoCook();
  },

  // Selecting an ACTUAL node (not deselecting via a pane click, which
  // passes null) exits sequence view -- otherwise the viewport silently
  // stays pinned to "{tag}/__sequence__" after trying "▶ Sequence" once,
  // which also suppresses the press-preview overlay (see PipelineView's
  // previewOverlay) with no obvious indicator why. Matches the original
  // pre-sequence-view behavior: clicking a node always shows THAT node's
  // own state.
  selectNode: (id) => set((s) => ({ selectedNodeId: id, viewSequence: id !== null ? false : s.viewSequence })),

  updateNodeParam: (id, paramName, value) => {
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, params: { ...n.data.params, [paramName]: value }, cooked: false } }
          : n,
      ),
    }));
    get().scheduleAutoCook();
  },

  onNodesChange: (changes) => set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) })),

  onEdgesChange: (changes) => set((s) => ({ edges: applyEdgeChanges(changes, s.edges) })),

  onConnect: (connection) => {
    set((s) => ({ edges: addEdge(connection, s.edges), nodes: markAllStale(s.nodes) }));
    get().scheduleAutoCook();
  },

  cook: async () => {
    if (autoCookTimer) {
      clearTimeout(autoCookTimer);
      autoCookTimer = null;
    }
    const { nodes, edges, run, tag } = get();
    if (nodes.length === 0) return;
    set({ cooking: true, cookError: null });
    const graph = {
      nodes: nodes.map((n) => ({ id: n.id, kind: n.data.kind, params: n.data.params })),
      edges: edges.map((e) => ({
        source: e.source,
        target: e.target,
        target_input: DEFAULT_TARGET_INPUT,
      })),
    };
    const goalName = get().goalName;
    const myRequestId = ++cookRequestId;
    try {
      const res = await fetch(`/api/pipeline/${encodeURIComponent(tag)}/cook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run, graph, context: goalName ? { goal: goalName } : undefined }),
      });
      const data: CookResponse = await res.json();
      // A newer cook() call was made while this one was in flight (e.g.
      // picking a goal re-cooks immediately, superseding a param-edit
      // auto-cook that was still pending) -- applying this now-stale
      // response would silently overwrite the newer one's diagnostics.
      if (myRequestId !== cookRequestId) return;
      if (!data.ok) {
        set({ cookError: data.error ?? "cook failed", cooking: false });
        return;
      }
      const cookedIds = new Set(data.node_ids ?? []);
      set((s) => ({
        nodes: s.nodes.map((n) =>
          cookedIds.has(n.id) ? { ...n, data: { ...n.data, cooked: true } } : n,
        ),
        diagnostics: { ...s.diagnostics, ...(data.diagnostics ?? {}) },
        cooking: false,
      }));
    } catch (e) {
      if (myRequestId !== cookRequestId) return;
      set({ cookError: String(e), cooking: false });
    }
  },

  scheduleAutoCook: () => {
    if (autoCookTimer) clearTimeout(autoCookTimer);
    autoCookTimer = setTimeout(() => {
      get().cook();
    }, AUTO_COOK_DEBOUNCE_MS);
  },

  // "reinstantiate objects if they get messed up" -- clears the local
  // graph (nodes/edges/selection) and re-fetches node kind schemas from
  // the backend, in case the two drifted out of sync (e.g. the server was
  // restarted with different registered nodes). Does NOT touch anything
  // already-cooked/logged on the backend -- those meshes remain
  // browsable in the Dashboard tab.
  resetGraph: () => {
    if (autoCookTimer) {
      clearTimeout(autoCookTimer);
      autoCookTimer = null;
    }
    set({
      nodes: [], edges: [], selectedNodeId: null, cookError: null, cooking: false, diagnostics: {},
      viewSequence: false,
    });
    get().fetchNodeKinds();
  },

  // Unlike resetGraph alone (local-only, see its own docstring), this ALSO
  // purges the server's cooked-mesh buffer for this run/tag -- every
  // per-node mesh tag AND the "{tag}/__sequence__" history -- so cooked
  // slab-model state actually gets released, not just hidden from the
  // current browser session.
  clearCache: async () => {
    const { run, tag } = get();
    get().resetGraph();
    try {
      await fetch(`/api/pipeline/${encodeURIComponent(tag)}/cache?run=${encodeURIComponent(run)}`, {
        method: "DELETE",
      });
    } catch (e) {
      console.error("Failed to clear server-side pipeline cache:", e);
    }
  },

  loadPath: (path) => {
    if (autoCookTimer) {
      clearTimeout(autoCookTimer);
      autoCookTimer = null;
    }
    const specs: PathNodeSpec[] = [path.root, ...path.steps];
    const ids = specs.map((s) => nextNodeId(s.kind));
    const newNodes: Node<PipelineNodeData>[] = specs.map((spec, i) => ({
      id: ids[i],
      type: "pipelineNode",
      position: { x: 80 + (i % 6) * 220, y: 80 + Math.floor(i / 6) * 160 },
      data: { kind: spec.kind, params: { ...spec.params }, cooked: false },
    }));
    const newEdges: Edge[] = ids.slice(1).map((id, i) => ({
      id: `${ids[i]}->${id}`,
      source: ids[i],
      target: id,
    }));
    set({
      nodes: newNodes,
      edges: newEdges,
      selectedNodeId: ids[0] ?? null,
      cookError: null,
      diagnostics: {},
      viewSequence: false,
    });
    get().cook();
  },

  exportPath: () => {
    const { nodes, edges, tag } = get();
    if (nodes.length === 0) return null;

    const incoming = new Map<string, number>();
    const outgoingTarget = new Map<string, string>();
    for (const n of nodes) incoming.set(n.id, 0);
    for (const e of edges) {
      if (!incoming.has(e.source) || !incoming.has(e.target)) return null;
      incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
      // A node feeding more than one other node isn't a linear chain.
      if (outgoingTarget.has(e.source)) return null;
      outgoingTarget.set(e.source, e.target);
    }

    const roots = nodes.filter((n) => (incoming.get(n.id) ?? 0) === 0);
    if (roots.length !== 1) return null;
    if (nodes.some((n) => (incoming.get(n.id) ?? 0) > 1)) return null;

    const chainIds: string[] = [roots[0].id];
    const visited = new Set(chainIds);
    let cur = roots[0].id;
    while (outgoingTarget.has(cur)) {
      const next = outgoingTarget.get(cur)!;
      if (visited.has(next)) return null; // cycle
      chainIds.push(next);
      visited.add(next);
      cur = next;
    }
    if (chainIds.length !== nodes.length) return null; // disconnected node(s)

    const byId = new Map(nodes.map((n) => [n.id, n]));
    const toSpec = (id: string): PathNodeSpec => {
      const n = byId.get(id)!;
      return { kind: n.data.kind, params: { ...n.data.params } };
    };
    return {
      format: "databoarder_path/v1",
      name: tag,
      root: toSpec(chainIds[0]),
      steps: chainIds.slice(1).map(toSpec),
      metadata: { source: "databoarder:export", exported_at: new Date().toISOString() },
    };
  },

  importGraph: (graph) => {
    if (autoCookTimer) {
      clearTimeout(autoCookTimer);
      autoCookTimer = null;
    }
    const idMap = new Map<string, string>();
    const newNodes: Node<PipelineNodeData>[] = graph.nodes.map((n, i) => {
      const id = nextNodeId(n.kind);
      idMap.set(n.id, id);
      return {
        id,
        type: "pipelineNode",
        position: { x: 80 + (i % 6) * 220, y: 80 + Math.floor(i / 6) * 160 },
        data: { kind: n.kind, params: { ...n.params }, cooked: false },
      };
    });
    const newEdges: Edge[] = graph.edges
      .filter((e) => idMap.has(e.source) && idMap.has(e.target))
      .map((e) => ({
        id: `${idMap.get(e.source)}->${idMap.get(e.target)}`,
        source: idMap.get(e.source)!,
        target: idMap.get(e.target)!,
      }));
    set({
      nodes: newNodes,
      edges: newEdges,
      selectedNodeId: newNodes[0]?.id ?? null,
      cookError: null,
      diagnostics: {},
      viewSequence: false,
    });
    get().cook();
  },

  exportGraph: (onlySelected) => {
    const { nodes, edges } = get();
    const chosenNodes = onlySelected ? nodes.filter((n) => n.selected) : nodes;
    if (chosenNodes.length === 0) return null;
    const chosenIds = new Set(chosenNodes.map((n) => n.id));
    const chosenEdges = edges.filter((e) => chosenIds.has(e.source) && chosenIds.has(e.target));
    return {
      nodes: chosenNodes.map((n) => ({ id: n.id, kind: n.data.kind, params: { ...n.data.params } })),
      edges: chosenEdges.map((e) => ({
        source: e.source,
        target: e.target,
        target_input: DEFAULT_TARGET_INPUT,
      })),
    };
  },
}));
