// Programs: the graph's connected components (a stock and the steps that
// follow it), joined through first inputs (callers pass `primaryEdges`).
// Mirrors `databoarder/pipeline/graph.py::Graph.programs`, so a
// program's root (its first node in topological order) names the same
// sequence tag the server pushes for it.
import { topologicalOrder } from "./graphOrder";

export interface Program {
  root: string;
  nodeIds: string[]; // topological order
}

/** The edges that carry a program on: into a node's FIRST input (its state),
 *  not a side input (a controller's goal) -- `databoarder.pipeline.cook.primary_edge`. */
export function primaryEdges<E extends { target: string; targetHandle?: string | null }>(
  nodes: { id: string; data: { kind: string } }[], edges: E[], kinds: { kind: string; inputs: string[] }[],
): E[] {
  const first = new Map(kinds.map((k) => [k.kind, k.inputs[0] ?? "state"]));
  const kindOf = new Map(nodes.map((n) => [n.id, n.data.kind]));
  return edges.filter((e) => !e.targetHandle || e.targetHandle === (first.get(kindOf.get(e.target) ?? "") ?? "state"));
}

/** Programs, joined through first inputs only (see primaryEdges). */
export function programsOf(nodes: { id: string }[], edges: { source: string; target: string }[]): Program[] {
  const order = topologicalOrder(nodes, edges);
  if (!order) return [];
  const parent = new Map(order.map((id) => [id, id]));
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
  for (const id of order) groups.set(find(id), [...(groups.get(find(id)) ?? []), id]);
  return [...groups.values()].map((ids) => ({ root: ids[0], nodeIds: ids }));
}

/** The replay tag the server pushes for `program` (see server.py's cook). */
export function sequenceTag(tag: string, programs: Program[], program: Program | undefined): string {
  return programs.length <= 1 || !program ? `${tag}/__sequence__` : `${tag}/__sequence__/${program.root}`;
}

/** A program's name: its stock's label (search/challenge programs carry one), else its position. */
export function programLabel(program: Program, index: number, labelOf: (id: string) => string | undefined): string {
  const label = labelOf(program.root);
  return label ? label.replace(/\s+stock$/, "") : `Program ${index + 1}`;
}
