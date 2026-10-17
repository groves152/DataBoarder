"""Node-kind registry for the pipeline/graph engine.

Domain-agnostic on purpose, mirroring `plugins.PluginRegistry`'s "map a
string key to registered behavior" pattern -- but for executable graph
nodes instead of display plugins. This package never registers any node
kinds itself; domain packages (e.g. forge_genie's forging/CAD nodes)
register their own handlers into an instance of this at runtime.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Literal

NodeHandler = Callable[..., Any]
MeshExporter = Callable[[Any], tuple[Any, Any]]  # value -> (vertices, faces)
# Given a node's own output value, its resolved params, its resolved
# upstream inputs (e.g. {"state": <value BEFORE this node ran>} -- needed
# for any diagnostic that compares before/after), an opaque per-cook
# `context` dict (round-tripped from the cook request body, e.g. "which
# goal is selected in the frontend" -- same "carry it, never inspect it"
# pattern as ParamSpec.options_meta), and the graph's ROOT node's own
# computed value (e.g. the starting state before any of the chain ran --
# needed for a diagnostic expressing "progress since the very beginning,"
# which a before/after delta alone can't), returns an arbitrary JSON-safe
# dict of extra info about that cook -- e.g. "here's what was actually
# achieved vs. what was requested." Domain-agnostic: `cook()` just
# collects and forwards whatever's returned, never inspects it.
Diagnostics = Callable[[Any, dict[str, Any], dict[str, Any], "dict[str, Any] | None", Any], dict[str, Any]]


@dataclass
class ParamSpec:
    """Describes one editable node parameter -- enough for a generic
    frontend to render the right control (slider, dropdown, checkbox...)
    with sensible bounds, without hardcoding any domain-specific knowledge."""

    type: Literal["float", "int", "select", "bool"]
    default: Any
    min: float | None = None
    max: float | None = None
    step: float | None = None
    options: list[str] | None = None  # for type == "select"
    label: str | None = None
    # Hover/tooltip text -- e.g. explaining what a toggle actually does
    # physically, not just its name.
    description: str | None = None
    # Arbitrary per-option metadata (only meaningful for type == "select"),
    # e.g. {"real_flat_die": {"shape": "box", "half_width": 6.7, ...}}.
    # DataBoarder itself never looks inside these dicts -- purely a
    # pass-through so a domain package (like forge_genie's press-geometry
    # dimensions) can attach display hints to select options without this
    # module knowing what any of the keys mean.
    options_meta: dict[str, dict[str, Any]] | None = None
    # A continuous param a gradient optimizer may tune (the frontend shows an
    # "optimize" toggle next to it). Purely a hint; DataBoarder runs nothing.
    optimizable: bool = False

    def to_json(self) -> dict[str, Any]:
        d: dict[str, Any] = {"type": self.type, "default": self.default}
        if self.min is not None:
            d["min"] = self.min
        if self.max is not None:
            d["max"] = self.max
        if self.step is not None:
            d["step"] = self.step
        if self.options is not None:
            d["options"] = self.options
        if self.label is not None:
            d["label"] = self.label
        if self.description is not None:
            d["description"] = self.description
        if self.options_meta is not None:
            d["options_meta"] = self.options_meta
        if self.optimizable:
            d["optimizable"] = True
        return d


@dataclass
class NodeSpec:
    kind: str
    handler: NodeHandler
    # Names of upstream inputs this handler requires, e.g. a strike node
    # that transforms an upstream billet declares inputs=("state",).
    inputs: tuple[str, ...] = ()
    # Optional: converts this node kind's output value to a (vertices,
    # faces) mesh preview. `cook()` uses this to auto-push a mesh for any
    # node whose kind declares one -- kept optional since not every node
    # kind necessarily produces a renderable mesh.
    to_mesh: MeshExporter | None = None
    # Editable params, name -> spec. Drives the frontend's node inspector.
    params: dict[str, ParamSpec] = field(default_factory=dict)
    # Optional: extra per-cook info about this node's output (e.g. "was
    # this param's request capped by a physical limit"), surfaced to the
    # frontend in the cook response.
    diagnostics: Diagnostics | None = None
    # Optional free-form grouping the frontend may use for display (e.g.
    # "thermal": a step that only changes temperature/time, which the graph
    # can fold into the edge between its neighbours).
    category: str | None = None

    def to_json(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "kind": self.kind,
            "inputs": list(self.inputs),
            "params": {name: spec.to_json() for name, spec in self.params.items()},
        }
        if self.category is not None:
            d["category"] = self.category
        return d


class PipelineRegistry:
    def __init__(self) -> None:
        self._nodes: dict[str, NodeSpec] = {}

    def register(
        self,
        kind: str,
        handler: NodeHandler,
        inputs: tuple[str, ...] = (),
        to_mesh: MeshExporter | None = None,
        params: dict[str, ParamSpec] | None = None,
        diagnostics: Diagnostics | None = None,
        category: str | None = None,
    ) -> None:
        self._nodes[kind] = NodeSpec(
            kind=kind, handler=handler, inputs=inputs, to_mesh=to_mesh, params=params or {},
            diagnostics=diagnostics, category=category,
        )

    def get(self, kind: str) -> NodeSpec | None:
        return self._nodes.get(kind)

    def set_category(self, kind: str, category: str | None) -> None:
        """Group an already-registered kind (see `NodeSpec.category`)."""
        self._nodes[kind].category = category

    def kinds(self) -> list[str]:
        return list(self._nodes.keys())

    def schema(self) -> list[dict[str, Any]]:
        return [spec.to_json() for spec in self._nodes.values()]
