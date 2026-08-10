"""Path-generator registry: name -> a handler that DETERMINISTICALLY builds
a whole path (a stock/root node plus a linear chain of step nodes) from a
handful of params, in one shot -- as opposed to `PipelineRegistry`'s node
kinds, which each produce one node's worth of output and get wired into an
arbitrary graph by hand.

Domain-agnostic on purpose, same "map a string key to registered behavior"
pattern as `PluginRegistry`/`PipelineRegistry`: this package never
registers any generators itself, domain packages (e.g. forge_genie's
`cogging_cyl_to_rect`) register their own at runtime. A generator's return
value is a "path" dict shaped like `{"root": {"kind", "params"}, "steps":
[{"kind", "params"}, ...], "metadata": {...}}` -- the same shape the
frontend's Import/Export path JSON uses, so whatever a generator produces
round-trips through that format for free.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from databoarder.pipeline.registry import ParamSpec

# params (by name, per its own ParamSpec) -> a path dict:
# {"root": {"kind": str, "params": dict}, "steps": [{"kind": str, "params": dict}, ...],
#  "metadata": dict (optional)}
GeneratorHandler = Callable[..., dict[str, Any]]


@dataclass
class GeneratorSpec:
    name: str
    handler: GeneratorHandler
    params: dict[str, ParamSpec] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "params": {name: spec.to_json() for name, spec in self.params.items()},
        }


class GeneratorRegistry:
    def __init__(self) -> None:
        self._generators: dict[str, GeneratorSpec] = {}

    def register(
        self,
        name: str,
        handler: GeneratorHandler,
        params: dict[str, ParamSpec] | None = None,
    ) -> None:
        self._generators[name] = GeneratorSpec(name=name, handler=handler, params=params or {})

    def get(self, name: str) -> GeneratorSpec | None:
        return self._generators.get(name)

    def names(self) -> list[str]:
        return list(self._generators.keys())

    def schema(self) -> list[dict[str, Any]]:
        return [spec.to_json() for spec in self._generators.values()]
