// Types for the node-graph pipeline editor. Mirrors the JSON shapes
// `databoarder/pipeline/{registry,graph}.py` produce/consume.

export type ParamType = "float" | "int" | "select";

export interface ParamSpec {
  type: ParamType;
  default: number | string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  label?: string;
}

export interface NodeKindSchema {
  kind: string;
  inputs: string[];
  params: Record<string, ParamSpec>;
}

export interface PipelineNodeData extends Record<string, unknown> {
  kind: string;
  params: Record<string, number | string>;
  // Set after a successful cook; cleared (stale) on any param/topology edit.
  cooked: boolean;
}

export interface PipelineEdgeSpec {
  source: string;
  target: string;
  target_input: string;
}

export interface CookResponse {
  ok: boolean;
  node_ids?: string[];
  mesh_node_ids?: string[];
  error?: string;
}
