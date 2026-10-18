// Mesh entries arrive as JSON -- nested number arrays, ~50 bytes a vertex in
// the JS heap. They're kept instead as flat typed arrays (12 bytes a vertex),
// converted once on arrival (`dataStore`), and a triangle list that repeats
// -- every frame of a replay whose topology doesn't change -- is shared, not
// copied. A long program's replay (hundreds of frames) then fits.
import type { MeshData, MeshTool } from "@/types";

const FACE_CACHE = 48; // recent distinct triangle lists kept for sharing
const faceCache: Uint32Array[] = [];

function same(a: Uint32Array, b: Uint32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** `f`, or an equal triangle list already held (newest first). */
function shared(f: Uint32Array): Uint32Array {
  for (let i = faceCache.length - 1; i >= 0; i--) if (same(faceCache[i], f)) return faceCache[i];
  faceCache.push(f);
  if (faceCache.length > FACE_CACHE) faceCache.shift();
  return f;
}

/** Nested rows (`[[x, y, z], ...]`) or a flat list, as one flat typed array. */
function flat<T extends Float32Array | Uint32Array>(a: unknown, make: (n: number) => T): { arr: T; width: number } {
  if (a instanceof Float32Array || a instanceof Uint32Array) return { arr: a as T, width: 3 };
  const rows = (a ?? []) as number[][] | number[];
  if (rows.length === 0) return { arr: make(0), width: 3 };
  if (!Array.isArray(rows[0])) {
    const out = make(rows.length);
    (rows as number[]).forEach((x, i) => { out[i] = x; });
    return { arr: out, width: 1 };
  }
  const width = (rows[0] as number[]).length;
  const out = make(rows.length * width);
  let k = 0;
  for (const row of rows as number[][]) for (let j = 0; j < width; j++) out[k++] = row[j];
  return { arr: out, width };
}

const f32 = (n: number) => new Float32Array(n);
const u32 = (n: number) => new Uint32Array(n);

function compactTool(t: { vertices: unknown; faces: unknown; role?: string }): MeshTool {
  return { vertices: flat(t.vertices, f32).arr, faces: shared(flat(t.faces, u32).arr), role: t.role };
}

/** A mesh entry's data as `MeshData` (flat typed arrays); already compact data passes through. */
export function compactMesh(raw: Record<string, unknown>): MeshData {
  if (raw.vertices instanceof Float32Array) return raw as unknown as MeshData;
  const colors = raw.colors ? flat(raw.colors, f32) : null;
  const fields = raw.fields as Record<string, number[]> | undefined;
  return {
    ...(raw as object),
    step: raw.step as number,
    vertices: flat(raw.vertices, f32).arr,
    faces: shared(flat(raw.faces, u32).arr),
    colors: colors?.arr,
    colorSize: colors?.width,
    normals: raw.normals ? flat(raw.normals, f32).arr : undefined,
    fields: fields ? Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, Float32Array.from(v)])) : undefined,
    tools: (raw.tools as { vertices: unknown; faces: unknown; role?: string }[] | undefined)?.map(compactTool),
  } as MeshData;
}

/** A mesh entry made compact; any other entry as is. */
export function compactEntry<E extends { type: string; data: unknown }>(e: E): E {
  return e.type === "mesh" ? { ...e, data: compactMesh(e.data as Record<string, unknown>) } : e;
}

/** Vertex count of a compact mesh. */
export const vertexCount = (m: MeshData) => m.vertices.length / 3;
