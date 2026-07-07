"""Phase 2 — 3D mesh plugin (vertices, faces, vertex colors, normals)."""

from __future__ import annotations

from typing import Any

from databoarder.plugins.base import Plugin


class MeshPlugin(Plugin):
    dtype = "mesh"

    def serialize(self, payload: dict[str, Any]) -> dict[str, Any]:
        # Vertices and faces are already plain Python lists at this point
        # (converted by writer.log_mesh via to_numpy().tolist()).
        return payload
