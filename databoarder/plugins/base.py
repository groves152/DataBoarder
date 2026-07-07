"""Abstract base class for DataBoarder plugins."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class Plugin(ABC):
    """A plugin converts a raw payload dict into the canonical wire format.

    Subclasses must declare a `dtype` class attribute (e.g. "scalar") that
    matches the type string used in DataBuffer.push().
    """

    dtype: str

    @abstractmethod
    def serialize(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Return a JSON-serialisable dict ready for the frontend."""
