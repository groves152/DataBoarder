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
export interface MeshData {
  step: number;
  vertices: number[][];
  faces: number[][];
  colors?: number[][];
  normals?: number[][];
  // Only set on a pipeline's "{tag}/__sequence__" tag -- which graph node
  // this step's mesh came from.
  node_id?: string;
}
export interface AnimationFrameData { frame_idx: number; png_b64?: string; shape: number[] }

export interface WsMessage {
  run: string;
  tag: string;
  type: DataType;
  data: TagEntry["data"];
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
