"""Pipeline graph spec: nodes + edges, JSON (de)serialization, topological
execution order. This is the persisted/wire format a frontend graph editor
sends to `POST /api/pipeline/{tag}/cook`."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class GraphNode:
    id: str
    kind: str
    params: dict[str, Any] = field(default_factory=dict)


@dataclass
class GraphEdge:
    source: str  # node id
    target: str  # node id
    target_input: str = "state"  # which of target's named inputs this feeds


@dataclass
class Graph:
    nodes: list[GraphNode] = field(default_factory=list)
    edges: list[GraphEdge] = field(default_factory=list)

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "Graph":
        nodes = [GraphNode(**n) for n in data.get("nodes", [])]
        edges = [GraphEdge(**e) for e in data.get("edges", [])]
        return cls(nodes=nodes, edges=edges)

    def to_json(self) -> dict[str, Any]:
        return {
            "nodes": [{"id": n.id, "kind": n.kind, "params": n.params} for n in self.nodes],
            "edges": [
                {"source": e.source, "target": e.target, "target_input": e.target_input}
                for e in self.edges
            ],
        }

    def topological_order(self) -> list[str]:
        """Kahn's algorithm. Raises ValueError on a cycle or an edge
        referencing an unknown node id."""
        node_ids = [n.id for n in self.nodes]
        known = set(node_ids)
        incoming: dict[str, int] = {nid: 0 for nid in node_ids}
        adjacency: dict[str, list[str]] = {nid: [] for nid in node_ids}
        for e in self.edges:
            if e.source not in known or e.target not in known:
                raise ValueError(
                    f"edge references unknown node id: {e.source!r} -> {e.target!r}"
                )
            adjacency[e.source].append(e.target)
            incoming[e.target] += 1

        ready = [nid for nid in node_ids if incoming[nid] == 0]
        order: list[str] = []
        while ready:
            nid = ready.pop(0)
            order.append(nid)
            for nxt in adjacency[nid]:
                incoming[nxt] -= 1
                if incoming[nxt] == 0:
                    ready.append(nxt)

        if len(order) != len(node_ids):
            raise ValueError("cycle detected in pipeline graph")
        return order

    def programs(self) -> list[list[str]]:
        """The connected components ("programs": a stock and the steps that
        follow it), each in topological order, ordered by where each starts
        in the whole graph's topological order."""
        order = self.topological_order()
        parent = {nid: nid for nid in order}

        def find(a: str) -> str:
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a

        for e in self.edges:
            parent[find(e.source)] = find(e.target)
        groups: dict[str, list[str]] = {}
        for nid in order:
            groups.setdefault(find(nid), []).append(nid)
        return list(groups.values())
