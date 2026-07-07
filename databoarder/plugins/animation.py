"""Phase 2 — animation frame cache plugin."""

from __future__ import annotations

from typing import Any

from databoarder.plugins.base import Plugin


class AnimationPlugin(Plugin):
    dtype = "animation_frame"

    def serialize(self, payload: dict[str, Any]) -> dict[str, Any]:
        # Phase 2: encode frame tensor as base64 PNG and store to disk cache.
        return payload
