"""FastAPI application — REST data routes + WebSocket push hub."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

import uvicorn
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from databoarder.buffer import DataBuffer
from databoarder.plugins import PluginRegistry

STATIC_DIR = Path(__file__).parent / "static"


def create_app(buffer: DataBuffer, plugins: PluginRegistry) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        buffer.set_event_loop(asyncio.get_event_loop())
        yield

    app = FastAPI(title="DataBoarder", version="0.1.0", lifespan=lifespan)

    # ------------------------------------------------------------------
    # REST endpoints
    # ------------------------------------------------------------------

    @app.get("/api/runs")
    async def get_runs() -> JSONResponse:
        return JSONResponse({"runs": buffer.runs()})

    @app.get("/api/tags")
    async def get_tags(run: str = "default") -> JSONResponse:
        return JSONResponse({"run": run, "tags": buffer.tags(run)})

    @app.get("/api/data")
    async def get_tag_data(tag: str, run: str = "default") -> JSONResponse:
        return JSONResponse({"run": run, "tag": tag, "entries": buffer.get(run, tag)})

    @app.post("/api/log")
    async def log_entry(request: Request) -> JSONResponse:
        body = await request.json()
        run = body.get("run", "default")
        buffer.push(run, body["tag"], body["type"], body["data"])
        return JSONResponse({"ok": True})

    @app.post("/api/log/batch")
    async def log_batch(request: Request) -> JSONResponse:
        entries = await request.json()
        for body in entries:
            buffer.push(body.get("run", "default"), body["tag"], body["type"], body["data"])
        return JSONResponse({"ok": True, "count": len(entries)})

    # ------------------------------------------------------------------
    # WebSocket hub
    # ------------------------------------------------------------------

    @app.websocket("/ws")
    async def ws_endpoint(websocket: WebSocket) -> None:
        await websocket.accept()
        buffer.add_ws_client(websocket)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            buffer.remove_ws_client(websocket)

    # ------------------------------------------------------------------
    # Serve built frontend — mount /assets for JS/CSS, catch-all for SPA
    # ------------------------------------------------------------------

    if STATIC_DIR.exists():
        assets_dir = STATIC_DIR / "assets"
        if assets_dir.exists():
            app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def serve_spa(full_path: str) -> FileResponse:
            return FileResponse(STATIC_DIR / "index.html")

    return app


def serve(app: FastAPI, host: str, port: int) -> None:
    uvicorn.run(app, host=host, port=port, log_level="warning")
