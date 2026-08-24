"""Executes a pipeline `Graph` against a `PipelineRegistry`, node by node in
topological order. Domain-agnostic: knows nothing about meshes, SlabState,
CAD ops, etc. beyond the optional `to_mesh` converter each registered node
kind may supply."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from databoarder.pipeline.graph import Graph
from databoarder.pipeline.registry import PipelineRegistry

logger = logging.getLogger(__name__)


@dataclass
class CookResult:
    values: dict[str, Any] = field(default_factory=dict)
    meshes: dict[str, tuple[Any, Any]] = field(default_factory=dict)
    diagnostics: dict[str, dict[str, Any]] = field(default_factory=dict)
    # Topological execution order -- callers that want to replay every
    # mesh-producing node as an ordered sequence (e.g. a "play the whole
    # cooked chain" viewer) use this instead of recomputing their own order.
    order: list[str] = field(default_factory=list)


def cook(graph: Graph, registry: PipelineRegistry, context: dict[str, Any] | None = None) -> CookResult:
    order = graph.topological_order()
    nodes_by_id = {n.id: n for n in graph.nodes}
    incoming_edges: dict[str, list] = {n.id: [] for n in graph.nodes}
    for e in graph.edges:
        incoming_edges[e.target].append(e)

    result = CookResult()

    for node_id in order:
        node = nodes_by_id[node_id]
        spec = registry.get(node.kind)
        if spec is None:
            raise ValueError(f"unknown node kind {node.kind!r} (node {node_id!r})")

        inputs: dict[str, Any] = {}
        for e in incoming_edges[node_id]:
            # topological_order guarantees e.source was cooked already
            inputs[e.target_input] = result.values[e.source]

        missing = [name for name in spec.inputs if name not in inputs]
        if missing:
            raise ValueError(
                f"node {node_id!r} ({node.kind}) missing required input(s): {missing}"
            )

        result.values[node_id] = spec.handler(**inputs, **node.params)

        if spec.to_mesh is not None:
            result.meshes[node_id] = spec.to_mesh(result.values[node_id])

        if spec.diagnostics is not None:
            # Diagnostics are explicitly optional extra info (see
            # registry.Diagnostics's docstring) -- a broken diagnostics
            # computation (e.g. an optional dependency not installed yet)
            # must not take down mesh/geometry production for the rest of
            # the graph.
            try:
                result.diagnostics[node_id] = spec.diagnostics(
                    result.values[node_id], node.params, inputs, context
                )
            except Exception as e:
                result.diagnostics[node_id] = {"error": str(e)}
                logger.exception("diagnostics failed for node %r (%s)", node_id, node.kind)

    result.order = order
    return result
