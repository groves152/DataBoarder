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


@dataclass
class ParamSpec:
    """Describes one editable node parameter -- enough for a generic
    frontend to render the right control (slider, dropdown, ...) with
    sensible bounds, without hardcoding any domain-specific knowledge."""

    type: Literal["float", "int", "select"]
    default: Any
    min: float | None = None
    max: float | None = None
    step: float | None = None
    options: list[str] | None = None  # for type == "select"
    label: str | None = None

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

    def to_json(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "inputs": list(self.inputs),
            "params": {name: spec.to_json() for name, spec in self.params.items()},
        }


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
    ) -> None:
        self._nodes[kind] = NodeSpec(
            kind=kind, handler=handler, inputs=inputs, to_mesh=to_mesh, params=params or {}
        )

    def get(self, kind: str) -> NodeSpec | None:
        return self._nodes.get(kind)

    def kinds(self) -> list[str]:
        return list(self._nodes.keys())

    def schema(self) -> list[dict[str, Any]]:
        return [spec.to_json() for spec in self._nodes.values()]
