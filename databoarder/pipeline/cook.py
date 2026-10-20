"""Executes a pipeline `Graph` against a `PipelineRegistry`, node by node in
topological order. Domain-agnostic: knows nothing about meshes, SlabState,
CAD ops, etc. beyond the optional `to_mesh` converter each registered node
kind may supply."""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Callable

from databoarder.pipeline.graph import Graph, GraphEdge
from databoarder.pipeline.registry import PipelineRegistry

logger = logging.getLogger(__name__)


@dataclass
class CookResult:
    values: dict[str, Any] = field(default_factory=dict)
    # Each node's `to_mesh` output: `(vertices, faces)`, or a dict with
    # "vertices"/"faces" plus optional extras (see server._mesh_payload).
    meshes: dict[str, Any] = field(default_factory=dict)
    diagnostics: dict[str, dict[str, Any]] = field(default_factory=dict)
    # Topological execution order -- callers that want to replay every
    # mesh-producing node as an ordered sequence (e.g. a "play the whole
    # cooked chain" viewer) use this instead of recomputing their own order.
    order: list[str] = field(default_factory=list)
    # What was cooked, and with what context (meshes made later -- a node
    # shown, a replay -- come from these and `values`).
    graph: Graph | None = None
    context: dict[str, Any] | None = None
    # Each node's signature: its kind, params and its inputs' signatures. A
    # later cook reuses a node whose signature is unchanged (`cook(prev=...)`).
    signatures: dict[str, str] = field(default_factory=dict)
    reused: int = 0  # how many nodes this cook took from the previous one
    # Each frozen node that kept its held value: whether what's upstream of it
    # has changed since it was frozen ("stale": it would cook differently now).
    frozen: dict[str, dict[str, bool]] = field(default_factory=dict)


@dataclass
class Frozen:
    """A frozen node's held result: what it cooked to when it was frozen."""

    signature: str
    value: Any
    diagnostics: "dict[str, Any] | None" = None
    mesh: Any = None


def primary_edge(graph: Graph, registry: PipelineRegistry) -> Callable[[GraphEdge], bool]:
    """Whether an edge feeds its target's FIRST input (its state: the program
    goes on through it) -- not a side input (a controller's goal)."""
    kinds = {n.id: n.kind for n in graph.nodes}

    def primary(e: GraphEdge) -> bool:
        spec = registry.get(kinds.get(e.target, ""))
        return e.target_input == (spec.inputs[0] if spec is not None and spec.inputs else "state")

    return primary


def programs(graph: Graph, registry: PipelineRegistry) -> list[list[str]]:
    """The graph's programs, joined through first inputs only (`primary_edge`)."""
    return graph.programs(primary_edge(graph, registry))


def ref_params(spec) -> list[str]:
    """The params of a kind that refer to other nodes (`ParamSpec` "node_ref")."""
    return [name for name, p in (spec.params or {}).items() if getattr(p, "type", None) == "node_ref"]


def resolved_params(node, spec, values: dict[str, Any]) -> dict[str, Any]:
    """A node's params with each node reference replaced by that node's value
    (None if it's missing or not cooked)."""
    params = dict(node.params)
    for name in ref_params(spec) if spec is not None else []:
        params[name] = values.get(params.get(name)) if params.get(name) else None
    return params


def ref_edges(graph: Graph, registry: PipelineRegistry) -> list[tuple[str, str]]:
    """(referenced node, referring node) for every node reference in the graph."""
    out = []
    for node in graph.nodes:
        spec = registry.get(node.kind)
        for name in ref_params(spec) if spec is not None else []:
            if node.params.get(name):
                out.append((str(node.params[name]), node.id))
    return out


def node_inputs(graph: Graph, values: dict[str, Any], node_id: str) -> dict[str, Any]:
    """A cooked node's inputs: its upstream nodes' values, by input name."""
    return {e.target_input: values[e.source] for e in graph.edges if e.target == node_id}


def node_frames(result: CookResult, registry: PipelineRegistry, node_id: str, n: int) -> list[Any]:
    """A cooked node's `n` in-between meshes (`NodeSpec.frames`) on the way
    from its input to its output; [] if its kind has none (or they fail)."""
    node = next(x for x in result.graph.nodes if x.id == node_id)
    spec = registry.get(node.kind)
    if spec is None or spec.frames is None or spec.to_mesh is None or n <= 0:
        return []
    try:
        return [spec.to_mesh(v) for v in spec.frames(node_inputs(result.graph, result.values, node_id),
                                                     resolved_params(node, spec, result.values), n)]
    except Exception:
        logger.exception("in-between frames failed for node %r (%s)", node_id, node.kind)
        return []


def _signature(kind: str, params: dict[str, Any], inputs: dict[str, str]) -> str:
    blob = json.dumps([kind, params, sorted(inputs.items())], sort_keys=True, default=str)
    return hashlib.sha1(blob.encode()).hexdigest()


def cook(graph: Graph, registry: PipelineRegistry, context: dict[str, Any] | None = None,
         mesh_nodes: "set[str] | None" = None, prev: "CookResult | None" = None,
         frozen: "dict[str, Frozen] | None" = None) -> CookResult:
    """Every node's value and diagnostics; `to_mesh` for `mesh_nodes` only
    (None: all) -- a long program's meshes are made as they're shown.
    `prev`: the last cook of this graph -- a node whose signature (kind,
    params, upstream) is unchanged keeps its value (and its mesh, and its
    diagnostics if the context is the same), so an edit near the end of a
    long program recomputes only from the edit on. Handlers must be pure.
    `frozen`: held results by node id -- a node marked frozen that has one
    keeps it (and its signature, so nothing after it re-cooks either)."""
    order = graph.topological_order(extra=ref_edges(graph, registry))
    nodes_by_id = {n.id: n for n in graph.nodes}
    incoming_edges: dict[str, list] = {n.id: [] for n in graph.nodes}
    for e in graph.edges:
        incoming_edges[e.target].append(e)

    result = CookResult()
    # The FIRST node's own computed value, generic/opaque to DataBoarder
    # core -- e.g. a graph's root/starting state, useful for a diagnostic
    # that needs an episode-start reference regardless of how deep into
    # the chain the current node is (a before/after delta alone can't
    # express "progress toward this goal since the very beginning").
    # Correct for the common case this UI actually produces (one linear
    # chain); a graph with multiple disconnected root nodes would only
    # get ONE of them here, since `order` has no notion of separate chains.
    root_value: Any = None
    root_id = order[0] if order else None

    for node_id in order:
        node = nodes_by_id[node_id]
        spec = registry.get(node.kind)
        if spec is None:
            raise ValueError(f"unknown node kind {node.kind!r} (node {node_id!r})")

        inputs: dict[str, Any] = {}
        for e in incoming_edges[node_id]:
            # topological_order guarantees e.source was cooked already
            inputs[e.target_input] = result.values[e.source]

        missing = [name for name in spec.inputs if name not in inputs and name not in spec.optional]
        if missing:
            raise ValueError(
                f"node {node_id!r} ({node.kind}) missing required input(s): {missing}"
            )

        refs = {f"@{name}": result.signatures.get(str(node.params.get(name)), "") for name in ref_params(spec)}
        sig = _signature(node.kind, node.params,
                         {**{e.target_input: result.signatures[e.source] for e in incoming_edges[node_id]}, **refs})
        result.signatures[node_id] = sig
        held = (frozen or {}).get(node_id) if node.frozen else None
        same = held is None and prev is not None and prev.signatures.get(node_id) == sig and node_id in prev.values
        if held is not None:  # frozen: its held value, and its signature then (nothing after it re-cooks)
            result.values[node_id] = held.value
            result.signatures[node_id] = held.signature
            result.frozen[node_id] = {"stale": held.signature != sig}
        elif same:
            result.values[node_id] = prev.values[node_id]
            result.reused += 1
        else:
            result.values[node_id] = spec.handler(**inputs, **resolved_params(node, spec, result.values))
        if node_id == root_id:
            root_value = result.values[node_id]

        if spec.to_mesh is not None and (mesh_nodes is None or node_id in mesh_nodes):
            if held is not None and held.mesh is not None:
                result.meshes[node_id] = held.mesh
            elif same and node_id in prev.meshes:
                result.meshes[node_id] = prev.meshes[node_id]
            else:
                result.meshes[node_id] = spec.to_mesh(result.values[node_id])

        # diagnostics read the context (e.g. a goal) and the root: reused only if neither changed
        root_same = prev is not None and root_id is not None and prev.signatures.get(root_id) == result.signatures.get(root_id)
        if held is not None and held.diagnostics is not None:
            result.diagnostics[node_id] = held.diagnostics
        elif same and root_same and prev.context == context and node_id in prev.diagnostics:
            result.diagnostics[node_id] = prev.diagnostics[node_id]
        elif spec.diagnostics is not None:
            # Diagnostics are explicitly optional extra info (see
            # registry.Diagnostics's docstring) -- a broken diagnostics
            # computation (e.g. an optional dependency not installed yet)
            # must not take down mesh/geometry production for the rest of
            # the graph.
            try:
                result.diagnostics[node_id] = spec.diagnostics(
                    result.values[node_id], node.params, inputs, context, root_value
                )
            except Exception as e:
                result.diagnostics[node_id] = {"error": str(e)}
                logger.exception("diagnostics failed for node %r (%s)", node_id, node.kind)

    result.order = order
    result.graph, result.context = graph, context
    return result
