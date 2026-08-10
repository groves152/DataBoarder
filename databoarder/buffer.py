"""In-memory ring buffer organised by run and tag, with optional SQLite persistence
and WebSocket push."""

from __future__ import annotations

import asyncio
import json
import sqlite3
import threading
from collections import deque
from pathlib import Path
from typing import Any

_WS_CLIENTS: set[Any] = set()


class DataBuffer:
    """Thread-safe per-run/per-tag ring buffer with optional SQLite backing store.

    Parameters
    ----------
    max_steps:
        Maximum entries kept *in memory* per (run, tag) pair.  Older entries are
        evicted from the deque but remain in the SQLite file (if one is configured).
    logfile:
        Path to a SQLite database file.  If given the buffer persists every push to
        disk and reloads history on construction.  Pass ``None`` (default) for
        in-memory-only mode.
    """

    def __init__(self, max_steps: int = 10_000, logfile: str | Path | None = None) -> None:
        self._max_steps = max_steps
        self._store: dict[str, dict[str, deque[dict[str, Any]]]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        self._lock = threading.RLock()

        self._conn: sqlite3.Connection | None = None
        if logfile is not None:
            path = Path(logfile)
            path.parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(str(path), check_same_thread=False)
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("""
                CREATE TABLE IF NOT EXISTS entries (
                    id    INTEGER PRIMARY KEY AUTOINCREMENT,
                    run   TEXT    NOT NULL,
                    tag   TEXT    NOT NULL,
                    type  TEXT    NOT NULL,
                    step  INTEGER NOT NULL DEFAULT 0,
                    data  TEXT    NOT NULL
                )
            """)
            self._conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_run_tag ON entries(run, tag)"
            )
            self._conn.commit()
            self._load_from_db()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def push(self, run: str, tag: str, dtype: str, payload: dict[str, Any], replace: bool = False) -> None:
        """`replace=True` clears any existing entries for this (run, tag)
        first, in memory AND in the SQLite backing store (if any) -- for a
        producer where a tag holds a single CURRENT value (e.g. a pipeline
        node's latest cooked mesh) rather than an accumulating history log
        (the default, used by scalar/histogram/image telemetry and
        anything else meant to be scrubbed/played back as real frames).
        Without this, re-cooking the same node id repeatedly (e.g. on every
        param edit) piles up one stale mesh per cook under the same tag
        forever, which a naive "show every entry ever logged" viewer would
        wrongly render as an animation of the node's edit history instead
        of its current state."""
        with self._lock:
            if replace:
                self._store.get(run, {}).get(tag, deque()).clear()
                if self._conn is not None:
                    self._conn.execute("DELETE FROM entries WHERE run = ? AND tag = ?", (run, tag))
            self._push_memory(run, tag, dtype, payload)
            if self._conn is not None:
                self._conn.execute(
                    "INSERT INTO entries (run, tag, type, step, data) VALUES (?, ?, ?, ?, ?)",
                    (run, tag, dtype, payload.get("step", 0), json.dumps(payload)),
                )
                self._conn.commit()
        self._broadcast(run, tag, dtype, payload)

    def get(self, run: str, tag: str) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._store.get(run, {}).get(tag, []))

    def tags(self, run: str) -> list[str]:
        with self._lock:
            return list(self._store.get(run, {}).keys())

    def runs(self) -> list[str]:
        with self._lock:
            return list(self._store.keys())

    def flush(self) -> None:
        if self._conn is not None:
            with self._lock:
                self._conn.commit()

    def close(self) -> None:
        if self._conn is not None:
            with self._lock:
                self._conn.commit()
                self._conn.close()
                self._conn = None

    # ------------------------------------------------------------------
    # WebSocket hub
    # ------------------------------------------------------------------

    def set_event_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def add_ws_client(self, ws: Any) -> None:
        _WS_CLIENTS.add(ws)

    def remove_ws_client(self, ws: Any) -> None:
        _WS_CLIENTS.discard(ws)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _push_memory(self, run: str, tag: str, dtype: str, payload: dict[str, Any]) -> None:
        if run not in self._store:
            self._store[run] = {}
        if tag not in self._store[run]:
            self._store[run][tag] = deque(maxlen=self._max_steps)
        self._store[run][tag].append({"type": dtype, "data": payload})

    def _load_from_db(self) -> None:
        assert self._conn is not None
        cur = self._conn.execute(
            "SELECT run, tag, type, data FROM entries ORDER BY id"
        )
        for run, tag, dtype, data_str in cur:
            try:
                payload = json.loads(data_str)
                self._push_memory(run, tag, dtype, payload)
            except (json.JSONDecodeError, KeyError):
                pass  # skip corrupt rows

    def _broadcast(self, run: str, tag: str, dtype: str, payload: dict[str, Any]) -> None:
        if not _WS_CLIENTS or self._loop is None:
            return
        msg = json.dumps({"run": run, "tag": tag, "type": dtype, "data": payload})
        asyncio.run_coroutine_threadsafe(_push_all(msg), self._loop)


async def _push_all(msg: str) -> None:
    dead = set()
    for ws in list(_WS_CLIENTS):
        try:
            await ws.send_text(msg)
        except Exception:
            dead.add(ws)
    _WS_CLIENTS.difference_update(dead)
