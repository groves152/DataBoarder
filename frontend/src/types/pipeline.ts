// Types for the node-graph pipeline editor. Mirrors the JSON shapes
// `databoarder/pipeline/{registry,graph}.py` produce/consume.

export type ParamType = "float" | "int" | "select" | "bool";
export type ParamValue = number | string | boolean;

export interface ParamSpec {
  type: ParamType;
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  label?: string;
  // Hover/tooltip text -- e.g. explaining what a toggle actually does
  // physically, not just its name.
  description?: string;
  // Per-select-option metadata, opaque to the store -- e.g. real press-tool
  // dimensions, used by PressPreview to draw the live strike overlay.
  options_meta?: Record<string, Record<string, number | string>>;
}

export interface NodeKindSchema {
  kind: string;
  inputs: string[];
  params: Record<string, ParamSpec>;
}

export interface PipelineNodeData extends Record<string, unknown> {
  kind: string;
  params: Record<string, ParamValue>;
  // Set after a successful cook; cleared (stale) on any param/topology edit.
  cooked: boolean;
}

export interface PipelineEdgeSpec {
  source: string;
  target: string;
  target_input: string;
}

// Arbitrary per-node extra info from the last cook (e.g. "was this param
// capped by a physical limit") -- opaque here, each node kind's frontend
// consumer (e.g. NodeInspector's capped-warning) knows what keys to expect.
export type NodeDiagnostics = Record<string, unknown>;

export interface CookResponse {
  ok: boolean;
  node_ids?: string[];
  mesh_node_ids?: string[];
  diagnostics?: Record<string, NodeDiagnostics>;
  error?: string;
}

// A "path": a root node (no inputs) plus a linear chain of step nodes,
// each consuming the previous one's output. Same {kind, params} shape
// pipeline graph nodes use, so a path maps 1:1 onto a graph with no
// branching -- this is the shared import/export/generate JSON format
// (see databoarder/pipeline/generators.py's module docstring).
export interface PathNodeSpec {
  kind: string;
  params: Record<string, ParamValue>;
}

// Snapshot of the global render/press-config toggles (ViewportSidebar) at
// export time -- NOT per-node data, so it lives alongside a path/graph
// rather than inside any one node's params. Every field optional: an
// older export (or a hand-written/generator-produced one) simply omits
// this, and import falls back to whatever the session's current settings
// already are, key by key -- a partial settings block still restores what
// it has instead of being rejected wholesale.
export interface AppSettingsSnapshot {
  goalName?: string | null;
  goalVisible?: boolean;
  goalOpacity?: number;
  billetOpacity?: number;
  showPressPreview?: boolean;
  defaultTool?: string | null;
  forceCorrectClosure?: boolean;
  phiSymmetry?: string;
  expandedNodes?: boolean;
  // Tuning (beta/plastic_decay_*/plastic_kernel_power) is PER-CHAIN now,
  // not a single session-global value -- it's fully recoverable from each
  // slab_strike node's own params (which already round-trip through
  // path/graph export/import), so there's nothing session-global left to
  // snapshot here.
}

export interface PathJson {
  format: string;
  name: string;
  root: PathNodeSpec;
  steps: PathNodeSpec[];
  metadata?: Record<string, unknown>;
  app_settings?: AppSettingsSnapshot;
}

export interface GeneratorSchema {
  name: string;
  params: Record<string, ParamSpec>;
}

export interface GenerateResponse {
  ok: boolean;
  path?: PathJson;
  error?: string;
}

// Raw graph persistence format -- arbitrary topology (branches/merges
// allowed), the exact shape `databoarder/pipeline/graph.py::Graph`
// consumes/produces (and what `cook()` POSTs already). Broader than
// `PathJson`: a path is always exportable as a graph, not vice versa.
export interface GraphNodeJson {
  id: string;
  kind: string;
  params: Record<string, ParamValue>;
}

export interface GraphJson {
  nodes: GraphNodeJson[];
  edges: PipelineEdgeSpec[];
  app_settings?: AppSettingsSnapshot;
}

// Panel sizes as a map of Panel id -> percentage (0..100), the exact shape
// react-resizable-panels' `Group.getLayout()`/`setLayout()` produce/accept
// (its own `Layout` type) -- redeclared here rather than importing that
// package's type into a shared types file with no other UI-library
// dependency.
export type PanelLayout = Record<string, number>;

// "Similar to how VSCode works" -- a separate export from the path/graph
// JSON above: this captures UI/session state (render toggles, panel
// drag-resize positions), never node/edge topology, so importing one never
// touches the other and the two can be combined freely (e.g. import a
// path, then separately restore a saved workspace layout on top of it).
export interface WorkspaceJson {
  format: "databoarder_workspace/v1";
  app_settings?: AppSettingsSnapshot;
  layouts?: {
    outer?: PanelLayout;
    meshRow?: PanelLayout;
    graphRow?: PanelLayout;
  };
}

// One entry from GET /api/forge/tuning_profiles (forge_genie's own route,
// not part of DataBoarder's generic API -- see ui_nodes/tuning_profiles.py).
export interface TuningProfile {
  name: string;
  label: string;
  beta: number;
  plastic_decay_ahead_mm: number;
  plastic_decay_behind_mm: number;
  plastic_kernel_power: number;
}
