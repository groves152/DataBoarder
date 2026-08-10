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

export interface PathJson {
  format: string;
  name: string;
  root: PathNodeSpec;
  steps: PathNodeSpec[];
  metadata?: Record<string, unknown>;
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
}
