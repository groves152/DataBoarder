"""Plugin registry — maps data type strings to plugin instances."""

from __future__ import annotations

from databoarder.plugins.base import Plugin
from databoarder.plugins.scalar import ScalarPlugin
from databoarder.plugins.histogram import HistogramPlugin
from databoarder.plugins.image import ImagePlugin


class PluginRegistry:
    def __init__(self) -> None:
        self._plugins: dict[str, Plugin] = {}
        for p in [ScalarPlugin(), HistogramPlugin(), ImagePlugin()]:
            self._plugins[p.dtype] = p

    def get(self, dtype: str) -> Plugin | None:
        return self._plugins.get(dtype)

    def register(self, plugin: Plugin) -> None:
        self._plugins[plugin.dtype] = plugin
