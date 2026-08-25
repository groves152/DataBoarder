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
  PathJson, PathNodeSpec, GeneratorSchema, GraphJson, AppSettingsSnapshot, TuningProfile,
} from "@/types/pipeline";

const MATERIAL_PARAM_KEYS = [
  "beta", "plastic_decay_ahead_mm", "plastic_decay_behind_mm", "plastic_kernel_power",
] as const;
type MaterialParamKey = (typeof MATERIAL_PARAM_KEYS)[number];

const AUTO_COOK_DEBOUNCE_MS = 500;

// Must match forge_search.ui_nodes.targets.TARGETS_RUN/TARGETS_TAG_PREFIX.
// Exported so components building a goal mesh's (run, tag) pair (e.g.
// GoalOverlay via PipelineView) share this one definition.
export const TARGETS_RUN = "_targets";
export const TARGETS_TAG_PREFIX = "targets/";

// Must match forge_search.ui_nodes.tools.TOOLS_RUN/TOOLS_TAG_PREFIX.
export const TOOLS_RUN = "_tools";
export const TOOLS_TAG_PREFIX = "tools/";

// Strike-angle symmetry presets. Each strike is already TWO-sided
// (hit.phi and hit.phi + pi, see slab_nodes.py's slab_strike_handler
// docstring), so covering an N-sided regular polygon cross-section only
// needs N/2 distinct commanded phi values, evenly spaced by 360/N degrees
// starting at 0 -- e.g. a square (4 faces) needs just [0, 90]. Purely a
// frontend UI convenience (constrains which angles are offered/cycled
// through, doesn't touch the backend's ParamSpec) -- "free" preserves the
// original continuous-slider behavior exactly.
export type PhiSymmetry = "free" | "square" | "hex" | "octagon";
export const PHI_SYMMETRY_PRESETS: Record<PhiSymmetry, { label: string; anglesDeg: number[] | null }> = {
  free: { label: "Free (continuous)", anglesDeg: null },
  square: { label: "Square (4 faces)", anglesDeg: [0, 90] },
  hex: { label: "Hexagon (6 faces)", anglesDeg: [0, 60, 120] },
  octagon: { label: "Octagon (8 faces)", anglesDeg: [0, 45, 90, 135] },
};

let nodeIdCounter = 0;
function nextNodeId(kind: string): string {
  nodeIdCounter += 1;
  return `${kind}_${nodeIdCounter}`;
}

// Walks forward from `nodeId` (source -> target) to whichever node has no
// further outgoing edge -- "the last node in the currently selected flow."
// Shared by addNode's auto-wire (new nodes always attach to the END of a
// chain, not to whichever node happens to be selected mid-chain) and the
// double-click-nearest-handle connect. Cycle-guarded (returns early if a
// cycle is somehow already present) even though the graph is normally a DAG.
function chainTerminus(nodeId: string, edges: Edge[]): string {
  let current = nodeId;
  const visited = new Set([current]);
  for (;;) {
    const next = edges.find((e) => e.source === current)?.target;
    if (!next || visited.has(next)) return current;
    current = next;
    visited.add(current);
  }
}

// All ancestors of `nodeId` (walking target -> source), used to reject a
// double-click-connect target that would close a cycle.
function ancestorsOf(nodeId: string, edges: Edge[]): Set<string> {
  const result = new Set<string>();
  const stack = [nodeId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const e of edges) {
      if (e.target === cur && !result.has(e.source)) {
        result.add(e.source);
        stack.push(e.source);
      }
    }
  }
  return result;
}

// Fills in the material/smoothing keys (beta, plastic_decay_ahead_mm,
// plastic_decay_behind_mm, plastic_kernel_power) a loaded/imported node is
// MISSING, using `materialDefaults` -- an older export (or one hand-built
// before these became real params) simply won't have them in its own
// per-step `params`, and without this, `cook()` sends the node verbatim
// with no beta/decay/power keys at all, so the backend silently falls
// back to `slab_strike_handler`'s OWN Python kwarg defaults (the
// "gaussian" tuning profile's fitted values) -- completely ignoring
// whatever `tuningProfileName`/`materialParams` the same file's own
// `app_settings` says should apply. Never overwrites a key the node's
// own params DO already specify -- an explicit per-node value in the
// source JSON is respected, only a genuinely absent one is filled in.
function fillMissingMaterialParams(
  params: Record<string, ParamValue>,
  kind: string,
  materialDefaults: Record<MaterialParamKey, number>,
  nodeKinds: NodeKindSchema[],
): Record<string, ParamValue> {
  const schema = nodeKinds.find((k) => k.kind === kind)?.params;
  if (!schema) return params;
  const filled = { ...params };
  for (const key of MATERIAL_PARAM_KEYS) {
    if (!(key in filled) && key in schema) filled[key] = materialDefaults[key];
  }
  return filled;
}

// Captures every global render/press-config toggle (ViewportSidebar) into
// the shape a path/graph export embeds -- "make it easier to continue from
// where we left off" means restoring the WHOLE session, not just node
// topology/params. `s` is typed loosely (not `PipelineStore`, which isn't
// declared yet at this point in the file) since only these specific fields
// are read.
function buildAppSettingsSnapshot(s: {
  goalName: string | null; goalVisible: boolean; goalOpacity: number; billetOpacity: number;
  showPressPreview: boolean; defaultTool: string | null; forceCorrectClosure: boolean;
  phiSymmetry: PhiSymmetry; expandedNodes: boolean;
  materialParams: { beta: number; plastic_decay_ahead_mm: number; plastic_decay_behind_mm: number; plastic_kernel_power: number };
  tuningProfileName: string;
}): AppSettingsSnapshot {
  return {
    goalName: s.goalName,
    goalVisible: s.goalVisible,
    goalOpacity: s.goalOpacity,
    billetOpacity: s.billetOpacity,
    showPressPreview: s.showPressPreview,
    defaultTool: s.defaultTool,
    forceCorrectClosure: s.forceCorrectClosure,
    phiSymmetry: s.phiSymmetry,
    expandedNodes: s.expandedNodes,
    materialParams: s.materialParams,
    tuningProfileName: s.tuningProfileName,
  };
}

// Inverse of the above, for import -- applied key-by-key (not
// wholesale-or-nothing) so a PARTIAL settings block (an older export, or a
// hand-edited one) still restores what it has instead of being rejected;
// any omitted key just leaves the session's current value untouched.
// Deliberately a plain field merge, not routed through setGoalName/
// setForceCorrectClosure's own side-effecting versions (auto-cook,
// rewriting every node's own param) -- the imported nodes already carry
// their own correct per-node values, and loadPath/importGraph already
// cook once at the end regardless.
function appSettingsUpdate(settings: AppSettingsSnapshot | undefined): Record<string, unknown> {
  if (!settings) return {};
  const update: Record<string, unknown> = {};
  for (const key of [
    "goalName", "goalVisible", "goalOpacity", "billetOpacity", "showPressPreview",
    "defaultTool", "forceCorrectClosure", "phiSymmetry", "expandedNodes",
    "materialParams", "tuningProfileName",
  ] as const) {
    if (settings[key] !== undefined) update[key] = settings[key];
  }
  return update;
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

  // Which discrete-angle preset new/cycled strike nodes' phi snaps to --
  // see PHI_SYMMETRY_PRESETS. "free" (default) is a no-op, preserving the
  // original continuous behavior.
  phiSymmetry: PhiSymmetry;

  // Material/smoothing model -- GLOBAL, same pattern as
  // forceCorrectClosure: picking a profile (or hand-adjusting one slider)
  // rewrites every slab_strike node's own beta/plastic_decay_ahead_mm/
  // plastic_decay_behind_mm/plastic_kernel_power together, so a whole
  // chain always uses ONE consistent material model. `tuningProfileName`
  // is "custom" after any hand-adjustment that no longer matches a known
  // profile's exact values, else the matching profile's own `name`.
  materialParams: {
    beta: number; plastic_decay_ahead_mm: number; plastic_decay_behind_mm: number; plastic_kernel_power: number;
  };
  tuningProfileName: string;
  availableTuningProfiles: TuningProfile[];

  // Clipboard for node(s) -- copy the current selection (single or multi),
  // paste either applies the params onto a currently-selected target (if
  // one exists) or, pasting into empty space (nothing selected), CREATES
  // new node(s) cloned from the clipboard, chained sequentially. See
  // `paste`'s own docstring for the full behavior split.
  copiedNodes: { kind: string; params: Record<string, ParamValue> }[] | null;

  // Whether every graph node shows its own current param values inline on
  // the card (vs. just kind name + cooked-status dot) -- a single global
  // toggle, not per-node.
  expandedNodes: boolean;

  setRun: (run: string) => void;
  setTag: (tag: string) => void;
  fetchNodeKinds: () => Promise<void>;
  fetchGeneratorSchemas: () => Promise<void>;
  // `paramOverrides`, when given, is used VERBATIM instead of the schema's
  // defaults (an exact clone, e.g. from paste) -- skips the "spread z/phi
  // so successive same-kind nodes don't overlap" heuristic, which would
  // corrupt an intentional exact copy. Auto-wires onto the currently
  // selected node's chain TERMINUS (see chainTerminus) if one is selected.
  addNode: (kind: string, position?: { x: number; y: number }, paramOverrides?: Record<string, ParamValue>) => void;
  deleteNode: (id: string) => void;
  // Deletes every multi-selected node if any, else just selectedNodeId --
  // same "multi-select falls back to single" pattern as pasteNodeParams
  // used to (now paste, see below).
  deleteSelectedNodes: () => void;
  selectNode: (id: string | null) => void;
  // Connects `sourceId`'s output to the nearest (by canvas distance) OTHER
  // node that (a) accepts an input, (b) doesn't already have one, and (c)
  // wouldn't close a cycle. No-op if no valid target exists.
  connectNearestTarget: (sourceId: string) => void;
  setExpandedNodes: (v: boolean) => void;
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
  setPhiSymmetry: (v: PhiSymmetry) => void;
  fetchTuningProfiles: () => Promise<void>;
  // Applies a KNOWN profile's values wholesale (by name, from
  // availableTuningProfiles) to materialParams + every slab_strike node.
  setTuningProfile: (name: string) => void;
  // Hand-adjusts ONE material param -- sets tuningProfileName to "custom"
  // (no known profile matches anymore) and rewrites every node's own copy
  // of just that key, debounced like updateNodeParam (this fires on every
  // slider-drag tick, not just on release).
  setMaterialParam: (key: MaterialParamKey, value: number) => void;
  // Copies the current selection (every multi-selected node, or just
  // selectedNodeId) into the clipboard.
  copyNodes: () => void;
  // If a node is currently selected (single or multi), applies the FIRST
  // copied node's params onto every selected target (the original "copy
  // settings from hit to hit" behavior). If NOTHING is selected (paste
  // into empty space), instead CREATES a new node for every clipboard
  // entry, chained sequentially via addNode's own auto-wire.
  paste: () => void;

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

  // Thin public wrappers around the same buildAppSettingsSnapshot/
  // appSettingsUpdate helpers exportPath/exportGraph/loadPath/importGraph
  // already use internally -- exposed directly for the workspace-layout
  // export/import (PipelineView's "Export workspace" menu), which has no
  // node/edge data of its own to piggyback the settings onto.
  snapshotAppSettings: () => AppSettingsSnapshot;
  applyAppSettings: (settings: AppSettingsSnapshot) => void;
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
  phiSymmetry: "free",
  copiedNodes: null,
  expandedNodes: false,
  // Placeholder ("no tune/default" values) until fetchNodeKinds seeds it
  // from slab_strike's own schema defaults -- tuningProfileName === ""
  // is the "not yet seeded" sentinel (distinct from "custom", which means
  // "seeded, but hand-adjusted away from any known profile").
  materialParams: { beta: 0.3, plastic_decay_ahead_mm: 0, plastic_decay_behind_mm: 0, plastic_kernel_power: 2.0 },
  tuningProfileName: "",
  availableTuningProfiles: [],

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
  // No cook() here -- unlike forceCorrectClosure, this doesn't rewrite any
  // existing node's params (only shapes future addNode calls, and
  // NodeInspector's phi control reads it live), so there's nothing new to
  // re-cook.
  setPhiSymmetry: (v) => set({ phiSymmetry: v }),
  setExpandedNodes: (v) => set({ expandedNodes: v }),

  fetchTuningProfiles: async () => {
    const res = await fetch("/api/forge/tuning_profiles");
    const data: { profiles: TuningProfile[] } = await res.json();
    set((s) => {
      const update: Partial<PipelineStore> = { availableTuningProfiles: data.profiles };
      if (s.tuningProfileName === "") {
        const match = data.profiles.find((p) =>
          MATERIAL_PARAM_KEYS.every((k) => Math.abs(p[k] - s.materialParams[k]) < 1e-9),
        );
        update.tuningProfileName = match ? match.name : "custom";
      }
      return update;
    });
  },

  // Rewrites EVERY slab_strike node's own material params to match a
  // KNOWN profile (by name) -- same "global toggle rewrites every node"
  // pattern as setForceCorrectClosure, so a whole chain always uses one
  // consistent material model, not a mix.
  setTuningProfile: (name) => {
    const profile = get().availableTuningProfiles.find((p) => p.name === name);
    if (!profile) return;
    const params = {
      beta: profile.beta,
      plastic_decay_ahead_mm: profile.plastic_decay_ahead_mm,
      plastic_decay_behind_mm: profile.plastic_decay_behind_mm,
      plastic_kernel_power: profile.plastic_kernel_power,
    };
    set((s) => ({
      materialParams: params,
      tuningProfileName: name,
      nodes: s.nodes.map((n) =>
        "beta" in n.data.params
          ? { ...n, data: { ...n.data, params: { ...n.data.params, ...params }, cooked: false } }
          : n,
      ),
    }));
    get().cook();
  },

  // Hand-adjusts ONE material param (a Tuning-tab slider drag) -- debounced
  // like updateNodeParam, since this fires on every tick while dragging.
  setMaterialParam: (key, value) => {
    set((s) => ({
      materialParams: { ...s.materialParams, [key]: value },
      tuningProfileName: "custom",
      nodes: s.nodes.map((n) =>
        key in n.data.params
          ? { ...n, data: { ...n.data, params: { ...n.data.params, [key]: value }, cooked: false } }
          : n,
      ),
    }));
    get().scheduleAutoCook();
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
      const update: Partial<PipelineStore> = { nodeKinds: data.kinds };
      // Seed defaultTool from whichever node kind's schema has a "tool"
      // param, ONLY if nothing's been chosen yet -- a user's own pick (or
      // a re-fetch after a server restart) should never be silently
      // clobbered back to the schema default.
      if (s.defaultTool === null) {
        const toolSpec = data.kinds.find((k) => k.params.tool)?.params.tool;
        update.defaultTool = toolSpec ? String(toolSpec.default) : null;
      }
      // Same idea for the material/smoothing params -- seed from
      // whichever kind has a "beta" param (currently slab_strike), only
      // if not seeded yet (tuningProfileName === "" sentinel).
      if (s.tuningProfileName === "") {
        const betaSchema = data.kinds.find((k) => k.params.beta)?.params;
        if (betaSchema) {
          update.materialParams = {
            beta: Number(betaSchema.beta.default),
            plastic_decay_ahead_mm: Number(betaSchema.plastic_decay_ahead_mm.default),
            plastic_decay_behind_mm: Number(betaSchema.plastic_decay_behind_mm.default),
            plastic_kernel_power: Number(betaSchema.plastic_kernel_power.default),
          };
          // Left un-matched to a specific profile NAME here (that needs
          // availableTuningProfiles too, which may not be loaded yet) --
          // fetchTuningProfiles finishes the job by matching these values
          // against the fetched list once both are available.
        }
      }
      return update;
    });
  },

  fetchGeneratorSchemas: async () => {
    const res = await fetch("/api/pipeline/generators");
    const data: { generators: GeneratorSchema[] } = await res.json();
    set({ generatorSchemas: data.generators });
  },

  addNode: (kind, position, paramOverrides) => {
    const schema = get().nodeKinds.find((k) => k.kind === kind);
    if (!schema) return;
    const params: Record<string, ParamValue> = {};
    for (const [name, spec] of Object.entries(schema.params)) {
      params[name] = spec.default;
    }
    if (paramOverrides) {
      // Exact clone (e.g. from paste) -- use the copied values verbatim,
      // skip every heuristic below that exists only to keep DEFAULT-valued
      // successive nodes from landing on top of each other; that logic
      // would corrupt an intentionally-identical copy.
      Object.assign(params, paramOverrides);
    } else {
      // Global overrides for these deliberately-named params (not "any
      // param a global setting happens to exist for") -- avoids surprising
      // a future node kind that reuses a param name for something
      // unrelated. defaultTool only affects NEW nodes (existing ones keep
      // whatever they have); forceCorrectClosure's retroactive rewrite of
      // EXISTING nodes lives in setForceCorrectClosure instead.
      const { defaultTool, forceCorrectClosure, materialParams } = get();
      if (defaultTool !== null && "tool" in params) params["tool"] = defaultTool;
      if ("force_correct_closure" in params) params["force_correct_closure"] = forceCorrectClosure;
      // Without this, a newly-added node would fall back to the SCHEMA's
      // own static default (the "gaussian" tuning profile's fitted
      // values, baked into slab_strike_handler's kwarg defaults) even if
      // a DIFFERENT tuning profile (or a hand-adjusted "custom" one) is
      // currently active -- silently contradicting whatever's selected in
      // the Tuning tab. Same "global toggle, only future nodes for the
      // non-retroactive half" pattern as defaultTool above; existing
      // nodes are kept in sync separately by setTuningProfile/
      // setMaterialParam's own retroactive rewrite.
      for (const key of MATERIAL_PARAM_KEYS) {
        if (key in params) params[key] = materialParams[key];
      }
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
      }
      // phi cycling is OUTSIDE the sameKindCount>0 gate (unlike z above) so
      // a symmetry preset's angle list is respected starting from the very
      // FIRST node too -- harmless when sameKindCount==0 since every
      // preset's first angle is 0deg anyway, same as the old default.
      const phiSpec = schema.params["phi"];
      if (phiSpec) {
        const preset = PHI_SYMMETRY_PRESETS[get().phiSymmetry];
        if (preset.anglesDeg) {
          const anglesRad = preset.anglesDeg.map((d) => (d * Math.PI) / 180);
          params["phi"] = anglesRad[sameKindCount % anglesRad.length];
        } else if (sameKindCount > 0 && phiSpec.min !== undefined && phiSpec.max !== undefined) {
          // "free" mode -- original alternating-between-two-values heuristic.
          params["phi"] = sameKindCount % 2 === 0 ? phiSpec.min : (phiSpec.min + phiSpec.max) / 2;
        }
      }
    }
    const id = nextNodeId(kind);
    // Auto-wire onto whatever's currently selected -- but always onto that
    // chain's TERMINUS (its last node with no outgoing edge yet), never
    // directly onto the selected node itself if it's mid-chain, so new
    // strikes always append to the end of a sequence rather than branching
    // off partway through. No anchor selected -> no auto-wire (an
    // intentionally standalone node, e.g. a fresh second chain).
    const anchorId = get().selectedNodeId;
    const newEdges: Edge[] = [];
    if (anchorId && get().nodes.some((n) => n.id === anchorId)) {
      const terminus = chainTerminus(anchorId, get().edges);
      if (terminus !== id) newEdges.push({ id: `${terminus}->${id}`, source: terminus, target: id });
    }
    const node: Node<PipelineNodeData> = {
      id,
      type: "pipelineNode",
      position: position ?? { x: 80 + (get().nodes.length % 5) * 220, y: 80 + Math.floor(get().nodes.length / 5) * 160 },
      data: { kind, params, cooked: false },
    };
    set((s) => ({ nodes: [...s.nodes, node], edges: [...s.edges, ...newEdges], selectedNodeId: id }));
    if (newEdges.length > 0) get().scheduleAutoCook();
  },

  deleteNode: (id) => {
    set((s) => ({
      nodes: markAllStale(s.nodes.filter((n) => n.id !== id)),
      edges: s.edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
    }));
    get().scheduleAutoCook();
  },

  deleteSelectedNodes: () => {
    const { nodes, selectedNodeId } = get();
    const multiSelected = nodes.filter((n) => n.selected).map((n) => n.id);
    const ids = new Set(multiSelected.length > 0 ? multiSelected : selectedNodeId ? [selectedNodeId] : []);
    if (ids.size === 0) return;
    set((s) => ({
      nodes: markAllStale(s.nodes.filter((n) => !ids.has(n.id))),
      edges: s.edges.filter((e) => !ids.has(e.source) && !ids.has(e.target)),
      selectedNodeId: s.selectedNodeId && ids.has(s.selectedNodeId) ? null : s.selectedNodeId,
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

  copyNodes: () => {
    const { nodes, selectedNodeId } = get();
    const multiSelected = nodes.filter((n) => n.selected);
    const source = multiSelected.length > 0 ? multiSelected : nodes.filter((n) => n.id === selectedNodeId);
    if (source.length === 0) return;
    set({ copiedNodes: source.map((n) => ({ kind: n.data.kind, params: { ...n.data.params } })) });
  },

  paste: () => {
    const { nodes, selectedNodeId, copiedNodes } = get();
    if (!copiedNodes || copiedNodes.length === 0) return;
    const multiSelected = nodes.filter((n) => n.selected).map((n) => n.id);
    const targetIds = multiSelected.length > 0 ? multiSelected : selectedNodeId ? [selectedNodeId] : [];

    if (targetIds.length > 0) {
      // A target is selected -- apply the FIRST copied node's params onto
      // every selected target (the original "copy settings from hit to
      // hit" behavior; multiple copied nodes pasted onto an existing
      // selection would have no clear per-target correspondence, so this
      // stays single-source, matching what shipped before).
      const src = copiedNodes[0].params;
      const targetSet = new Set(targetIds);
      set((s) => ({
        nodes: s.nodes.map((n) => {
          if (!targetSet.has(n.id)) return n;
          // Only overwrite keys the TARGET's own params dict already has --
          // e.g. pasting a slab_strike's clipboard onto a slab_stock node
          // matches zero keys (disjoint param sets) and is a harmless
          // no-op, rather than injecting a foreign key the target's
          // handler doesn't accept.
          const merged = { ...n.data.params };
          for (const key of Object.keys(n.data.params)) {
            if (key in src) merged[key] = src[key];
          }
          return { ...n, data: { ...n.data, params: merged, cooked: false } };
        }),
      }));
      get().scheduleAutoCook();
    } else {
      // Nothing selected (paste into empty space) -- CREATE a new node per
      // clipboard entry instead. Calling addNode in sequence (not a single
      // bulk set()) is deliberate: each call re-selects the node it just
      // created, so the NEXT iteration's addNode auto-wires onto it via
      // the exact same chain-terminus logic a manually-clicked "+" uses --
      // multi-node paste comes out as one continuous chain, not N
      // independent floating nodes.
      for (const c of copiedNodes) {
        get().addNode(c.kind, undefined, c.params);
      }
    }
  },

  connectNearestTarget: (sourceId) => {
    const { nodes, edges, nodeKinds } = get();
    const source = nodes.find((n) => n.id === sourceId);
    if (!source) return;
    const targetsWithIncoming = new Set(edges.map((e) => e.target));
    const ancestors = ancestorsOf(sourceId, edges);
    let best: string | null = null;
    let bestDist = Infinity;
    for (const n of nodes) {
      if (n.id === sourceId) continue;
      if (targetsWithIncoming.has(n.id)) continue; // already has an input
      if (ancestors.has(n.id)) continue; // would close a cycle
      const kindSchema = nodeKinds.find((k) => k.kind === n.data.kind);
      if (!kindSchema || kindSchema.inputs.length === 0) continue; // no input handle at all (e.g. slab_stock)
      const dist = Math.hypot(n.position.x - source.position.x, n.position.y - source.position.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = n.id;
      }
    }
    if (!best) return;
    set((s) => ({
      edges: [...s.edges, { id: `${sourceId}->${best}`, source: sourceId, target: best }],
      nodes: markAllStale(s.nodes),
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
    // The file's OWN app_settings.materialParams if it has one (a fresh
    // export always does), else fall back to whatever's already active in
    // this session -- either way, every loaded node ends up with a real
    // beta/decay/power of its own, not silently missing them.
    const materialDefaults = path.app_settings?.materialParams ?? get().materialParams;
    const { nodeKinds } = get();
    const newNodes: Node<PipelineNodeData>[] = specs.map((spec, i) => ({
      id: ids[i],
      type: "pipelineNode",
      position: { x: 80 + (i % 6) * 220, y: 80 + Math.floor(i / 6) * 160 },
      data: {
        kind: spec.kind,
        params: fillMissingMaterialParams({ ...spec.params }, spec.kind, materialDefaults, nodeKinds),
        cooked: false,
      },
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
      ...appSettingsUpdate(path.app_settings),
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
      app_settings: buildAppSettingsSnapshot(get()),
    };
  },

  importGraph: (graph) => {
    if (autoCookTimer) {
      clearTimeout(autoCookTimer);
      autoCookTimer = null;
    }
    const materialDefaults = graph.app_settings?.materialParams ?? get().materialParams;
    const { nodeKinds } = get();
    const idMap = new Map<string, string>();
    const newNodes: Node<PipelineNodeData>[] = graph.nodes.map((n, i) => {
      const id = nextNodeId(n.kind);
      idMap.set(n.id, id);
      return {
        id,
        type: "pipelineNode",
        position: { x: 80 + (i % 6) * 220, y: 80 + Math.floor(i / 6) * 160 },
        data: {
          kind: n.kind,
          params: fillMissingMaterialParams({ ...n.params }, n.kind, materialDefaults, nodeKinds),
          cooked: false,
        },
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
      ...appSettingsUpdate(graph.app_settings),
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
      app_settings: buildAppSettingsSnapshot(get()),
      edges: chosenEdges.map((e) => ({
        source: e.source,
        target: e.target,
        target_input: DEFAULT_TARGET_INPUT,
      })),
    };
  },

  snapshotAppSettings: () => buildAppSettingsSnapshot(get()),
  applyAppSettings: (settings) => set(appSettingsUpdate(settings)),
}));
