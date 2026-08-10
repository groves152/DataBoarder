// Kahn's algorithm, mirroring `databoarder/pipeline/graph.py::Graph.
// topological_order` client-side -- used to drive sequence playback (each
// node selected once, in an order consistent with the graph's actual data
// flow) without a round trip to the backend.
export function topologicalOrder(
  nodes: { id: string }[],
  edges: { source: string; target: string }[],
): string[] | null {
  const ids = nodes.map((n) => n.id);
  const known = new Set(ids);
  const incoming = new Map<string, number>(ids.map((id) => [id, 0]));
  const adjacency = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) {
    if (!known.has(e.source) || !known.has(e.target)) continue;
    adjacency.get(e.source)!.push(e.target);
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
  }

  const ready = ids.filter((id) => incoming.get(id) === 0);
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const next of adjacency.get(id) ?? []) {
      incoming.set(next, (incoming.get(next) ?? 0) - 1);
      if (incoming.get(next) === 0) ready.push(next);
    }
  }
  return order.length === ids.length ? order : null; // null on cycle
}
