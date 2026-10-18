export type DataType =
  | "scalar" | "scalars" | "histogram"
  | "image"  | "images"  | "mesh" | "animation_frame";

export interface TagEntry {
  type: DataType;
  data: ScalarData | ScalarsData | HistogramData | ImageData | MeshData | AnimationFrameData;
}

export interface ScalarData      { step: number; value: number }
export interface ScalarsData     { step: number; values: Record<string, number> }
export interface HistogramData   { step: number; counts: number[]; edges: number[] }
export interface ImageData       { step: number; png_b64: string; shape: number[]; dataformats: string }
// As kept by the store (`utils/meshData.compactMesh`: the JSON's nested
// arrays made flat typed arrays on arrival).
export interface MeshData {
  step: number;
  vertices: Float32Array; // x, y, z per vertex
  faces: Uint32Array; // three vertex numbers per triangle; empty: a point cloud
  colors?: Float32Array; // `colorSize` (3 or 4) per vertex
  colorSize?: number;
  normals?: Float32Array;
  // Optional per-vertex scalar fields the viewer can color by (e.g. surface
  // temperature), with unit labels.
  fields?: Record<string, Float32Array>;
  field_units?: Record<string, string>;
  // Optional extra meshes drawn with this one in the same frame -- e.g. the
  // tooling acting on the part at this step (dies, punch, induction coil).
  tools?: MeshTool[];
  // Only set on a pipeline's "{tag}/__sequence__" tag -- which graph node
  // this step's mesh came from.
  node_id?: string;
}
export interface MeshTool {
  vertices: Float32Array;
  faces: Uint32Array;
  role?: string;
}
export interface AnimationFrameData { frame_idx: number; png_b64?: string; shape: number[] }

export interface WsMessage {
  run: string;
  tag: string;
  type: DataType;
  data: TagEntry["data"];
  replace?: boolean; // the tag's earlier entries were cleared on the server: drop them here too
}

/** A single data source feeding a panel. */
export interface DataSource {
  run: string;
  tag: string;
  type: DataType;
}

/**
 * How a multi-source panel renders its data.
 * overlay  — all scalar traces on one chart (same-type scalars)
 * split    — each source in its own horizontal stripe
 * sidebyside — two Plotly subplots sharing the x-axis (scalars only)
 */
export type MergeMode = "overlay" | "split" | "sidebyside";

export interface PanelLayout {
  i: string;
  x: number; y: number; w: number; h: number;
  sources: DataSource[];
  mergeMode: MergeMode;
}
