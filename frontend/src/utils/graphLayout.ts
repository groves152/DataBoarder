// "Clean up" layout for the graph view: node positions that fit the panel.
// Each connected program is laid out on its own and the programs are stacked
// top to bottom. A plain chain (every node one in, one out) reads left to
// right and wraps into rows, with as many columns as make its block about as
// wide-for-its-height as the panel; a branching graph is laid out in layers
// (column = longest path from a root).
import type { Edge, Node } from "@xyflow/react";

const DEFAULT_W = 190;
const DEFAULT_H = 70;
const GAP_X = 50;
const GAP_Y = 40;
const GAP_PROGRAMS = 70;

type XY = { x: number; y: number };

function components(ids: string[], edges: Edge[]): string[][] {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (a: string): string => {
    while (parent.get(a) !== a) {
      parent.set(a, parent.get(parent.get(a)!)!);
      a = parent.get(a)!;
    }
    return a;
  };
  for (const e of edges) {
    if (parent.has(e.source) && parent.has(e.target)) parent.set(find(e.source), find(e.target));
  }
  const groups = new Map<string, string[]>();
  for (const id of ids) groups.set(find(id), [...(groups.get(find(id)) ?? []), id]);
  return [...groups.values()]; // in first-node order
}

function chainOrder(ids: string[], edges: Edge[]): string[] | null {
  const inDeg = new Map(ids.map((id) => [id, 0]));
  const next = new Map<string, string>();
  for (const e of edges) {
    if (!inDeg.has(e.source) || !inDeg.has(e.target)) continue;
    if (next.has(e.source)) return null; // branches
    next.set(e.source, e.target);
    inDeg.set(e.target, inDeg.get(e.target)! + 1);
  }
  const roots = ids.filter((id) => inDeg.get(id) === 0);
  if (roots.length !== 1 || [...inDeg.values()].some((d) => d > 1)) return null;
  const order = [roots[0]];
  while (next.has(order[order.length - 1]) && order.length <= ids.length) order.push(next.get(order[order.length - 1])!);
  return order.length === ids.length ? order : null;
}

function layers(ids: string[], edges: Edge[]): Map<string, number> {
  const depth = new Map(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass++) { // longest path, Bellman-Ford style (DAGs are small)
    let changed = false;
    for (const e of edges) {
      if (!depth.has(e.source) || !depth.has(e.target)) continue;
      const d = depth.get(e.source)! + 1;
      if (d > depth.get(e.target)!) {
        depth.set(e.target, d);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return depth;
}

/** Positions for `nodes` (the visible ones) that fit a `width` x `height` panel. */
export function layoutGraph(nodes: Node[], edges: Edge[], width: number, height: number): Map<string, XY> {
  const size = (n: Node) => ({ w: n.measured?.width ?? DEFAULT_W, h: n.measured?.height ?? DEFAULT_H });
  const cellW = Math.max(...nodes.map((n) => size(n).w), DEFAULT_W) + GAP_X;
  const cellH = Math.max(...nodes.map((n) => size(n).h), DEFAULT_H) + GAP_Y;
  const aspect = Math.max(width, 1) / Math.max(height, 1);
  const out = new Map<string, XY>();
  let top = 0;
  for (const ids of components(nodes.map((n) => n.id), edges)) {
    const chain = chainOrder(ids, edges);
    let rows = 1;
    if (chain) {
      // cols * cellW : rows * cellH ~ the panel's aspect, rows = ceil(n / cols)
      const cols = Math.max(1, Math.min(chain.length, Math.round(Math.sqrt((chain.length * aspect * cellH) / cellW))));
      chain.forEach((id, i) => out.set(id, { x: (i % cols) * cellW, y: top + Math.floor(i / cols) * cellH }));
      rows = Math.ceil(chain.length / cols);
    } else {
      const depth = layers(ids, edges);
      const perLayer = new Map<number, number>();
      for (const id of ids) {
        const d = depth.get(id)!;
        const k = perLayer.get(d) ?? 0;
        perLayer.set(d, k + 1);
        out.set(id, { x: d * cellW, y: top + k * cellH });
      }
      rows = Math.max(...perLayer.values());
    }
    top += rows * cellH + GAP_PROGRAMS;
  }
  return out;
}
