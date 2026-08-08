"""Standalone ASGI app for `uvicorn --reload` during development.

`uvicorn --reload` re-imports its target module fresh in a new process on
every file change, so it needs a plain importable `module:app` object — it
can't take a `DataBoarder` instance built by hand the way `writer.py`'s
thread-based `serve()` does. This module is that importable target,
configured via env vars since no Python objects can cross the reload
boundary. Not used by the public `DataBoarder`/`writer.py` API at all —
training/eval scripts keep using that as before; this is dev-workflow only,
wired up by `dev.py`.
"""

from __future__ import annotations

import os

from databoarder.buffer import DataBuffer
from databoarder.plugins import PluginRegistry
from databoarder.server import create_app

_logfile = os.environ.get("DATABOARDER_LOGFILE") or None
_max_steps = int(os.environ.get("DATABOARDER_MAX_STEPS", "10000"))

buffer = DataBuffer(max_steps=_max_steps, logfile=_logfile)
plugins = PluginRegistry()
app = create_app(buffer, plugins)
