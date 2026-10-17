"""A library of saved graphs: one JSON file per entry in a directory, so saved
work survives page reloads, server restarts and other browsers.

Opaque to DataBoarder: an entry's `content` is whatever the frontend saved
(a graph JSON), its `summary` a small dict the list view shows. The entry
`AUTOSAVE` is the frontend's rolling autosave of the current graph; it is
kept out of the list.

    GET    /api/library              entries, newest first: {id, name, saved_at, summary}
    GET    /api/library/{entry_id}   one entry, content included
    PUT    /api/library/{entry_id}   save {name?, content, summary?}
    DELETE /api/library/{entry_id}
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

AUTOSAVE = "__autosave__"
_ID = re.compile(r"^[A-Za-z0-9_.()-]{1,120}$")


def entry_id(name: str) -> str:
    """A file-safe id for an entry name ("cog t2_2 (pi3)" -> "cog_t2_2_(pi3)")."""
    slug = re.sub(r"[^A-Za-z0-9_.()-]+", "_", name.strip()).strip("_.")
    return slug[:120] or "untitled"


class Library:
    def __init__(self, directory: Path):
        self.dir = Path(directory)
        self.dir.mkdir(parents=True, exist_ok=True)

    def _path(self, eid: str) -> Path:
        if not _ID.match(eid) or eid.startswith("."):
            raise ValueError(f"bad library entry id {eid!r}")
        return self.dir / f"{eid}.json"

    def list(self) -> list[dict[str, Any]]:
        out = []
        for p in self.dir.glob("*.json"):
            if p.stem == AUTOSAVE:
                continue
            try:
                e = json.loads(p.read_text())
            except (OSError, json.JSONDecodeError):
                continue  # a half-written or foreign file: not an entry
            out.append({"id": p.stem, "name": e.get("name", p.stem), "saved_at": e.get("saved_at"),
                        "summary": e.get("summary", {})})
        return sorted(out, key=lambda e: e["saved_at"] or "", reverse=True)

    def get(self, eid: str) -> dict[str, Any] | None:
        p = self._path(eid)
        return {"id": eid, **json.loads(p.read_text())} if p.exists() else None

    def put(self, eid: str, content: Any, name: str | None = None, summary: dict | None = None) -> dict[str, Any]:
        p = self._path(eid)
        entry = {"name": name or eid, "saved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                 "summary": summary or {}, "content": content}
        tmp = p.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(entry))
        os.replace(tmp, p)  # atomic: a reader never sees half an entry
        return {"id": eid, "name": entry["name"], "saved_at": entry["saved_at"], "summary": entry["summary"]}

    def delete(self, eid: str) -> bool:
        p = self._path(eid)
        if not p.exists():
            return False
        p.unlink()
        return True


def register_library_routes(app: FastAPI, library: Library) -> None:
    @app.get("/api/library")
    async def library_list() -> JSONResponse:
        return JSONResponse({"entries": library.list()})

    @app.get("/api/library/{eid}")
    async def library_get(eid: str) -> JSONResponse:
        try:
            entry = library.get(eid)
        except ValueError as e:
            return JSONResponse({"ok": False, "error": str(e)}, status_code=400)
        if entry is None:
            return JSONResponse({"ok": False, "error": f"no library entry {eid!r}"}, status_code=404)
        return JSONResponse({"ok": True, **entry})

    @app.put("/api/library/{eid}")
    async def library_put(eid: str, request: Request) -> JSONResponse:
        body = await request.json()
        if "content" not in body:
            return JSONResponse({"ok": False, "error": "missing 'content'"}, status_code=400)
        try:
            meta = library.put(eid, body["content"], body.get("name"), body.get("summary"))
        except ValueError as e:
            return JSONResponse({"ok": False, "error": str(e)}, status_code=400)
        return JSONResponse({"ok": True, **meta})

    @app.delete("/api/library/{eid}")
    async def library_delete(eid: str) -> JSONResponse:
        try:
            removed = library.delete(eid)
        except ValueError as e:
            return JSONResponse({"ok": False, "error": str(e)}, status_code=400)
        return JSONResponse({"ok": removed}, status_code=200 if removed else 404)
