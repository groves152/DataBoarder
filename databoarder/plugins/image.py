from __future__ import annotations

import base64
import io
from typing import Any

import numpy as np
from PIL import Image

from databoarder.plugins.base import Plugin


class ImagePlugin(Plugin):
    dtype = "image"

    def serialize(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Encode a raw numpy array as a base64 PNG string."""
        arr: np.ndarray = payload.get("array")
        if arr is None:
            return payload
        if arr.dtype in (np.float32, np.float64):
            arr = (arr.clip(0, 1) * 255).astype(np.uint8)
        img = Image.fromarray(arr)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()
        return {**payload, "png_b64": b64}
