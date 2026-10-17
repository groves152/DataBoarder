"""FastAPI application — REST data routes + WebSocket push hub."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator, Callable

import uvicorn
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from databoarder.buffer import DataBuffer
from databoarder.converters import to_numpy
from databoarder.pipeline import Graph, GeneratorRegistry, PipelineRegistry, TransformRegistry, cook
from databoarder.plugins import PluginRegistry

STATIC_DIR = Path(__file__).parent / "static"


def _mesh_payload(mesh, step: int) -> dict:
    """A node's `to_mesh` output as a mesh entry. A `(vertices, faces)` pair,
    or a dict with "vertices"/"faces" plus optional extras the viewer knows:
      - "fields": {name: per-vertex values} -- scalar fields it can color by
      - "field_units": {name: unit label}
      - "tools": [{"vertices", "faces", "role"?}] -- extra meshes drawn with
        the part (e.g. the tooling acting on it), in the same frame."""
    if isinstance(mesh, dict):
        out = {"step": step, "vertices": to_numpy(mesh["vertices"]).tolist(),
               "faces": to_numpy(mesh["faces"]).tolist()}
        if mesh.get("fields"):
            out["fields"] = {k: to_numpy(v).reshape(-1).tolist() for k, v in mesh["fields"].items()}
        if mesh.get("field_units"):
            out["field_units"] = dict(mesh["field_units"])
        if mesh.get("tools"):
            out["tools"] = [{"vertices": to_numpy(t["vertices"]).tolist(), "faces": to_numpy(t["faces"]).tolist(),
                             "role": t.get("role", "tool")} for t in mesh["tools"]]
        return out
    vertices, faces = mesh
    return {"step": step, "vertices": to_numpy(vertices).tolist(), "faces": to_numpy(faces).tolist()}


def create_app(
    buffer: DataBuffer,
    plugins: PluginRegistry,
    pipeline_registry: PipelineRegistry | None = None,
    generator_registry: GeneratorRegistry | None = None,
    transform_registry: TransformRegistry | None = None,
    extend: Callable[[FastAPI], None] | None = None,
) -> FastAPI:
    """`extend(app)` adds a domain package's own routes. It runs after the core
    API and before the built frontend's catch-all route is mounted (Starlette
    matches routes in registration order, and the catch-all matches any path,
    so routes added after `create_app` returns would be unreachable by GET)."""
    pipeline_registry = pipeline_registry if pipeline_registry is not None else PipelineRegistry()
    generator_registry = generator_registry if generator_registry is not None else GeneratorRegistry()
    transform_registry = transform_registry if transform_registry is not None else TransformRegistry()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        buffer.set_event_loop(asyncio.get_event_loop())
        yield

    app = FastAPI(title="DataBoarder", version="0.1.0", lifespan=lifespan)

    # Last cook's full CookResult per (run, tag) -- generic, opaque cache
    # (core knows nothing about what a node's computed VALUE actually is).
    # cook_pipeline only ever serializes .meshes/.diagnostics into its JSON
    # response; a domain package that needs a node's raw computed value
    # after the fact (e.g. forge_genie's "mesh selected nodes" action,
    # which needs a forge-net node's tracked point cloud + its sampling
    # provenance, not just the mesh preview) reads it from here via
    # app.state rather than DataBoarder inventing a domain-specific route
    # for it.
    app.state.cook_cache: dict[tuple[str, str], object] = {}

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
    # Pipeline control plane — cook a node graph, push resulting mesh
    # previews through the existing telemetry buffer/WS path so they show
    # up in the existing MeshPanel with zero frontend changes.
    # ------------------------------------------------------------------

    @app.get("/api/pipeline/node_kinds")
    async def get_node_kinds() -> JSONResponse:
        return JSONResponse({"kinds": pipeline_registry.schema()})

    @app.post("/api/pipeline/{tag}/cook")
    async def cook_pipeline(tag: str, request: Request) -> JSONResponse:
        body = await request.json()
        run = body.get("run", "default")
        context = body.get("context")  # opaque, optional -- see registry.Diagnostics
        try:
            graph = Graph.from_json(body["graph"])
            result = cook(graph, pipeline_registry, context=context)
        except (KeyError, ValueError) as e:
            return JSONResponse({"ok": False, "error": str(e)}, status_code=400)

        app.state.cook_cache[(run, tag)] = result

        payloads = {node_id: _mesh_payload(mesh, 0) for node_id, mesh in result.meshes.items()}
        for node_id, payload in payloads.items():
            node_tag = f"{tag}/{node_id}"
            # replace=True: a node's tag holds its CURRENT cooked mesh only,
            # not a growing log of every cook it's ever participated in
            # (see `DataBuffer.push`'s docstring) -- otherwise editing an
            # upstream hit and re-cooking leaves every downstream node's
            # preview mixing stale pre-edit geometry in with the new state.
            buffer.push(run, node_tag, "mesh", payload, replace=True)

        # Also push a step-indexed running history of every mesh-producing
        # node in topological order, per program (connected component: one
        # stock and its steps), under one dedicated tag each -- lets a
        # frontend "play the whole cooked sequence" view scrub/play through
        # ALL the hits with MeshPanel's existing frame mechanism, instead of
        # re-selecting a different node's single-mesh tag every tick (which
        # forces a remount + fresh fetch + camera re-fit per hit -- the
        # direct cause of "flashing back to stock/unrelated hits" during
        # playback). replace=True only on the FIRST push of this cook
        # clears the previous cook's sequence exactly once; the rest append.
        # One program: "{tag}/__sequence__"; several: one tag each, named by
        # the program's first node ("{tag}/__sequence__/{root}"), so one
        # program's replay never mixes in another's steps.
        programs = graph.programs()
        listed = []
        for ids in programs:
            seq_tag = f"{tag}/__sequence__" if len(programs) == 1 else f"{tag}/__sequence__/{ids[0]}"
            mesh_order = [node_id for node_id in ids if node_id in result.meshes]
            for i, node_id in enumerate(mesh_order):
                buffer.push(run, seq_tag, "mesh", {**payloads[node_id], "step": i, "node_id": node_id},
                            replace=(i == 0))
            listed.append({"root": ids[0], "node_ids": ids, "sequence_tag": seq_tag})

        return JSONResponse({
            "ok": True,
            "node_ids": list(result.values.keys()),
            "mesh_node_ids": list(result.meshes.keys()),
            "diagnostics": result.diagnostics,
            "programs": listed,
        })

    @app.delete("/api/pipeline/{tag}/cache")
    async def clear_pipeline_cache(tag: str, run: str = "default") -> JSONResponse:
        # Scoped to "{tag}/" -- sweeps every per-node mesh tag AND the
        # "{tag}/__sequence__" tag above for free (same prefix), but can
        # never touch the target-mesh library (a separate run="_targets"
        # namespace entirely, see ui_nodes/targets.py), so "clear cache"
        # never risks nuking shared reference goal meshes.
        removed = buffer.clear(run, tag_prefix=f"{tag}/")
        return JSONResponse({"ok": True, "removed_tags": removed})

    # ------------------------------------------------------------------
    # Path generators — deterministically build a whole path (root node +
    # linear step chain) from a handful of params in one shot, in the SAME
    # {root, steps, metadata} shape the frontend's Import/Export path JSON
    # uses (see `pipeline/generators.py`), so a generated path is a real
    # example of that shared format, not a special case of it.
    # ------------------------------------------------------------------

    @app.get("/api/pipeline/generators")
    async def get_generators() -> JSONResponse:
        return JSONResponse({"generators": generator_registry.schema()})

    @app.post("/api/pipeline/generators/{name}")
    async def run_generator(name: str, request: Request) -> JSONResponse:
        spec = generator_registry.get(name)
        if spec is None:
            return JSONResponse({"ok": False, "error": f"unknown generator {name!r}"}, status_code=404)
        params = await request.json() if await request.body() else {}
        try:
            path = spec.handler(**params)
        except (TypeError, ValueError) as e:
            return JSONResponse({"ok": False, "error": str(e)}, status_code=400)
        path.setdefault("format", "databoarder_path/v1")
        path.setdefault("name", name)
        return JSONResponse({"ok": True, "path": path})

    # Path transforms -- rewrite the CURRENT path (same JSON shape), e.g. a
    # domain package inserting steps the designer left out.
    @app.get("/api/pipeline/transforms")
    async def get_transforms() -> JSONResponse:
        return JSONResponse({"transforms": transform_registry.schema()})

    @app.post("/api/pipeline/transforms/{name}")
    async def run_transform(name: str, request: Request) -> JSONResponse:
        spec = transform_registry.get(name)
        if spec is None:
            return JSONResponse({"ok": False, "error": f"unknown transform {name!r}"}, status_code=404)
        body = await request.json()
        try:
            result = await asyncio.to_thread(spec.handler, body["path"], **body.get("params", {}))
        except (KeyError, TypeError, ValueError) as e:
            return JSONResponse({"ok": False, "error": str(e)}, status_code=400)
        path = result["path"]
        path.setdefault("format", "databoarder_path/v1")
        return JSONResponse({"ok": True, "path": path, "report": result.get("report", [])})

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

    if extend is not None:
        extend(app)

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
