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
import type { NodeKindSchema, PipelineNodeData, CookResponse } from "@/types/pipeline";

const AUTO_COOK_DEBOUNCE_MS = 500;

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

interface PipelineStore {
  nodeKinds: NodeKindSchema[];
  nodes: Node<PipelineNodeData>[];
  edges: Edge[];
  selectedNodeId: string | null;
  run: string;
  tag: string;
  cooking: boolean;
  cookError: string | null;

  setRun: (run: string) => void;
  setTag: (tag: string) => void;
  fetchNodeKinds: () => Promise<void>;
  addNode: (kind: string, position?: { x: number; y: number }) => void;
  deleteNode: (id: string) => void;
  selectNode: (id: string | null) => void;
  updateNodeParam: (id: string, paramName: string, value: number | string) => void;

  onNodesChange: OnNodesChange<Node<PipelineNodeData>>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;

  cook: () => Promise<void>;
  scheduleAutoCook: () => void;
  resetGraph: () => void;
}

function markAllStale(nodes: Node<PipelineNodeData>[]): Node<PipelineNodeData>[] {
  return nodes.map((n) => (n.data.cooked ? { ...n, data: { ...n.data, cooked: false } } : n));
}

export const usePipelineStore = create<PipelineStore>((set, get) => ({
  nodeKinds: [],
  nodes: [],
  edges: [],
  selectedNodeId: null,
  run: "default",
  tag: "graph",
  cooking: false,
  cookError: null,

  setRun: (run) => set({ run }),
  setTag: (tag) => set({ tag }),

  fetchNodeKinds: async () => {
    const res = await fetch("/api/pipeline/node_kinds");
    const data: { kinds: NodeKindSchema[] } = await res.json();
    set({ nodeKinds: data.kinds });
  },

  addNode: (kind, position) => {
    const schema = get().nodeKinds.find((k) => k.kind === kind);
    if (!schema) return;
    const params: Record<string, number | string> = {};
    for (const [name, spec] of Object.entries(schema.params)) {
      params[name] = spec.default;
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

  selectNode: (id) => set({ selectedNodeId: id }),

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
    try {
      const res = await fetch(`/api/pipeline/${encodeURIComponent(tag)}/cook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run, graph }),
      });
      const data: CookResponse = await res.json();
      if (!data.ok) {
        set({ cookError: data.error ?? "cook failed", cooking: false });
        return;
      }
      const cookedIds = new Set(data.node_ids ?? []);
      set((s) => ({
        nodes: s.nodes.map((n) =>
          cookedIds.has(n.id) ? { ...n, data: { ...n.data, cooked: true } } : n,
        ),
        cooking: false,
      }));
    } catch (e) {
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
    set({ nodes: [], edges: [], selectedNodeId: null, cookError: null, cooking: false });
    get().fetchNodeKinds();
  },
}));
