from __future__ import annotations

from typing import Any

from databoarder.plugins.base import Plugin


class HistogramPlugin(Plugin):
    dtype = "histogram"

    def serialize(self, payload: dict[str, Any]) -> dict[str, Any]:
        return payload
