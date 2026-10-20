"""FastAPI application — REST data routes + WebSocket push hub."""

from __future__ import annotations

import numpy as np
import asyncio
import json
from collections import OrderedDict
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncGenerator, Callable

import uvicorn
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from databoarder.buffer import DataBuffer
from databoarder.converters import jsonable, to_numpy
from databoarder.library import Library, register_library_routes
from databoarder.pipeline import Graph, GeneratorRegistry, PipelineRegistry, TransformRegistry, cook
from databoarder.pipeline.cook import Frozen, node_frames, node_inputs, programs as graph_programs, resolved_params
from databoarder.plugins import PluginRegistry

STATIC_DIR = Path(__file__).parent / "static"


POSITION_DECIMALS = 4  # mesh coordinates sent to 0.1 um (unit: the producer's, mm for forging parts)
FIELD_DIGITS = 5  # per-vertex field values: significant digits, relative to the field's largest


def _positions(a) -> np.ndarray:
    """Coordinates rounded for the wire (full float repr is ~18 characters a
    number, half a mesh payload, for digits no view can show), kept as an
    array -- a buffered mesh as Python lists is ~4x the memory."""
    return np.round(to_numpy(a).astype(np.float64), POSITION_DECIMALS)


def _field(a) -> np.ndarray:
    v = to_numpy(a).astype(np.float64).reshape(-1)
    big = float(np.nanmax(np.abs(v))) if v.size and np.isfinite(v).any() else 0.0
    decimals = max(0, FIELD_DIGITS - 1 - int(np.floor(np.log10(big)))) if big > 0 else FIELD_DIGITS
    return np.round(v, decimals)


def _faces(a) -> np.ndarray:
    return to_numpy(a).astype(np.int32)


class ArrayJSONResponse(JSONResponse):
    """JSON that may hold numpy arrays (buffered mesh payloads)."""

    def render(self, content: Any) -> bytes:
        return json.dumps(content, ensure_ascii=False, allow_nan=False, separators=(",", ":"),
                          default=jsonable).encode("utf-8")


def _mesh_payload(mesh, step: int) -> dict:
    """A node's `to_mesh` output as a mesh entry. A `(vertices, faces)` pair,
    or a dict with "vertices"/"faces" plus optional extras the viewer knows:
      - "fields": {name: per-vertex values} -- scalar fields it can color by
      - "field_units": {name: unit label}
      - "tools": [{"vertices", "faces", "role"?}] -- extra meshes drawn with
        the part (e.g. the tooling acting on it), in the same frame."""
    if isinstance(mesh, dict):
        out = {"step": step, "vertices": _positions(mesh["vertices"]), "faces": _faces(mesh["faces"])}
        if mesh.get("fields"):
            out["fields"] = {k: _field(v) for k, v in mesh["fields"].items()}
        if mesh.get("field_units"):
            out["field_units"] = dict(mesh["field_units"])
        if mesh.get("tools"):
            out["tools"] = [{"vertices": _positions(t["vertices"]), "faces": _faces(t["faces"]),
                             "role": t.get("role", "tool")} for t in mesh["tools"]]
        return out
    vertices, faces = mesh
    return {"step": step, "vertices": _positions(vertices), "faces": _faces(faces)}


def create_app(
    buffer: DataBuffer,
    plugins: PluginRegistry,
    pipeline_registry: PipelineRegistry | None = None,
    generator_registry: GeneratorRegistry | None = None,
    transform_registry: TransformRegistry | None = None,
    extend: Callable[[FastAPI], None] | None = None,
    library_dir: Path | None = None,
) -> FastAPI:
    """`extend(app)` adds a domain package's own routes. It runs after the core
    API and before the built frontend's catch-all route is mounted (Starlette
    matches routes in registration order, and the catch-all matches any path,
    so routes added after `create_app` returns would be unreachable by GET).
    `library_dir`: where saved graphs live (`databoarder.library`); None: no
    library routes."""
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
    # Frozen nodes' held results per (run, tag): node id -> `Frozen` (kept
    # while the node stays frozen; in memory, so a restart re-cooks them once).
    app.state.frozen: dict[tuple[str, str], dict[str, Frozen]] = {}
    # A node's actions replayed so far, for its inspector's action list:
    # (run, tag, node) -> (its signature, the states so far, the rest to come).
    app.state.replays: "OrderedDict[tuple[str, str, str], tuple]" = OrderedDict()
    # Cooks run on a worker thread, so the server keeps answering (job lists,
    # the library, status polls) while one runs -- one at a time, in order.
    cook_lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # REST endpoints
    # ------------------------------------------------------------------

    @app.get("/api/runs")
    async def get_runs() -> JSONResponse:
        return JSONResponse({"runs": buffer.runs()})

    @app.get("/api/tags")
    async def get_tags(run: str = "default") -> JSONResponse:
        return JSONResponse({"run": run, "tags": buffer.tags(run), "types": buffer.tag_types(run)})

    @app.get("/api/data")
    async def get_tag_data(tag: str, run: str = "default", start: int = 0, limit: int | None = None) -> JSONResponse:
        """A tag's entries; `start`/`limit` page them (a long replay's meshes
        are hundreds of MB as one response). `total`: how many there are."""
        entries = buffer.get(run, tag)
        page = entries[start:] if limit is None else entries[start:start + limit]
        return ArrayJSONResponse({"run": run, "tag": tag, "entries": page, "start": start, "total": len(entries)})

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

    def _sequence_tag(tag: str, programs: list, root: str) -> str:
        # One program: "{tag}/__sequence__"; several: one tag each, named by
        # the program's first node, so one program's replay never mixes in
        # another's steps.
        return f"{tag}/__sequence__" if len(programs) == 1 else f"{tag}/__sequence__/{root}"

    def _push_node_meshes(run: str, tag: str, result, node_ids) -> list[str]:
        """Each node's current mesh under its own tag ("{tag}/{node}"; replace:
        a node's tag holds its CURRENT mesh only, never a log of past cooks).
        Made from the cooked value if the cook didn't make it."""
        pushed = []
        for node_id in node_ids:
            if node_id not in result.values:
                continue
            if node_id not in result.meshes:
                node = next(n for n in result.graph.nodes if n.id == node_id)
                spec = pipeline_registry.get(node.kind)
                if spec is None or spec.to_mesh is None:
                    continue
                result.meshes[node_id] = spec.to_mesh(result.values[node_id])
            buffer.push(run, f"{tag}/{node_id}", "mesh", _mesh_payload(result.meshes[node_id], 0), replace=True)
            pushed.append(node_id)
        return pushed

    def _push_sequence(run: str, tag: str, result, ids: list, seq_tag: str, subframes: int,
                       broadcast: bool = True) -> int:
        """A program's replay under `seq_tag`: every mesh-producing node in
        order (step i), each one's in-between frames (`node_frames`) just
        before it at fractional steps. Meshes made here aren't kept: a long
        program's would be hundreds. `broadcast=False`: clients fetch it once
        it's built (streamed, a viewer would redraw for every frame)."""
        order = [i for i in ids if i in result.values and (spec := pipeline_registry.get(
            next(n.kind for n in result.graph.nodes if n.id == i))) is not None and spec.to_mesh is not None]
        n_frames = 0
        for i, node_id in enumerate(order):
            if i > 0 and _has_actions(result, node_id):
                n_frames += _push_actions(run, seq_tag, result, node_id, i, subframes, broadcast)
            elif i > 0 and subframes > 0:
                subs = node_frames(result, pipeline_registry, node_id, subframes)
                for k, mesh in enumerate(subs, start=1):
                    buffer.push(run, seq_tag, "mesh", {**_mesh_payload(mesh, 0), "step": i - 1 + k / (len(subs) + 1),
                                                       "node_id": node_id, "sub": True}, broadcast=broadcast)
                    n_frames += 1
            mesh = result.meshes.get(node_id)
            if mesh is None:
                node = next(n for n in result.graph.nodes if n.id == node_id)
                mesh = pipeline_registry.get(node.kind).to_mesh(result.values[node_id])
            buffer.push(run, seq_tag, "mesh", {**_mesh_payload(mesh, i), "node_id": node_id}, replace=(i == 0),
                        broadcast=broadcast)
            n_frames += 1
        return n_frames

    def _node(result, node_id: str):
        return next(n for n in result.graph.nodes if n.id == node_id)

    def _has_actions(result, node_id: str) -> bool:
        spec = pipeline_registry.get(_node(result, node_id).kind)
        return spec is not None and spec.actions is not None and spec.replay is not None

    def _call(result, node_id: str, hook: str):
        node = _node(result, node_id)
        spec = pipeline_registry.get(node.kind)
        return getattr(spec, hook)(result.values[node_id], resolved_params(node, spec, result.values),
                                   node_inputs(result.graph, result.values, node_id))

    def _push_actions(run: str, seq_tag: str, result, node_id: str, i: int, subframes: int, broadcast: bool) -> int:
        """A node with actions in a replay: the state after each of its actions
        (all but the last: that's the node's own frame, step i) at steps
        i-1 + k/m, each labelled; with `subframes`, an action whose kind has
        in-between frames (a pierce) gets them too."""
        actions = _call(result, node_id, "actions")
        m = len(actions)
        if m <= 1:
            return 0
        to_mesh = pipeline_registry.get(_node(result, node_id).kind).to_mesh
        prev = node_inputs(result.graph, result.values, node_id).get(
            pipeline_registry.get(_node(result, node_id).kind).inputs[0])
        pushed = 0
        for k, (act, state) in enumerate(zip(actions, _call(result, node_id, "replay")), start=1):
            kind = pipeline_registry.get(act["kind"])
            if subframes > 0 and kind is not None and kind.frames is not None and prev is not None:
                try:
                    subs = kind.frames({"state": prev}, act["params"], subframes)
                except Exception:
                    subs = []
                for j, sub in enumerate(subs, start=1):
                    buffer.push(run, seq_tag, "mesh", {**_mesh_payload(to_mesh(sub), 0),
                                                       "step": i - 1 + (k - 1 + j / (len(subs) + 1)) / m,
                                                       "node_id": node_id, "sub": True,
                                                       "label": act.get("label", "")}, broadcast=broadcast)
                    pushed += 1
            if k == m:
                break
            buffer.push(run, seq_tag, "mesh", {**_mesh_payload(to_mesh(state), 0), "step": i - 1 + k / m,
                                               "node_id": node_id, "action": k - 1, "label": act.get("label", "")},
                        broadcast=broadcast)
            pushed += 1
            prev = state
        return pushed

    def _replayed(run: str, tag: str, result, node_id: str, upto: int) -> list:
        """The states after a node's actions 0..`upto`, replayed as far as asked
        (kept: a click further down the list goes on from there)."""
        key = (run, tag, node_id)
        entry = app.state.replays.get(key)
        if entry is None or entry[0] != result.signatures.get(node_id):
            entry = (result.signatures.get(node_id), [], iter(_call(result, node_id, "replay")))
            app.state.replays[key] = entry
            while len(app.state.replays) > 4:
                app.state.replays.popitem(last=False)
        app.state.replays.move_to_end(key)
        _, states, rest = entry
        while len(states) <= upto:
            nxt = next(rest, None)
            if nxt is None:
                break
            states.append(nxt)
        return states

    @app.post("/api/pipeline/{tag}/cook")
    async def cook_pipeline(tag: str, request: Request) -> JSONResponse:
        """Cooks the graph. With `view` (`{"nodes": [...]}`), lazily: every
        node's value and diagnostics, but meshes only for each program's last
        node and `view.nodes` -- the rest as they're shown (`/meshes`); a
        replay is built on request. Without it, every node's mesh and every
        program's replay, as before."""
        body = await request.json()
        run = body.get("run", "default")
        context = body.get("context")  # opaque, optional -- see registry.Diagnostics
        view = body.get("view")
        try:
            graph = Graph.from_json(body["graph"])
            programs = graph_programs(graph, pipeline_registry)
            mesh_nodes = None if view is None else {ids[-1] for ids in programs if ids} | set(view.get("nodes") or [])
            async with cook_lock:
                # the last cook of this graph: unchanged nodes keep their values
                prev = app.state.cook_cache.get((run, tag)) if body.get("incremental", True) else None
                held = app.state.frozen.setdefault((run, tag), {})
                result = await asyncio.to_thread(cook, graph, pipeline_registry, context, mesh_nodes, prev, held)
        except (KeyError, ValueError) as e:
            return JSONResponse({"ok": False, "error": str(e)}, status_code=400)

        app.state.cook_cache[(run, tag)] = result
        # a node just frozen holds what it cooked to now; an unfrozen (or deleted) one lets go
        for n in graph.nodes:
            if n.frozen and n.id not in held:
                held[n.id] = Frozen(result.signatures[n.id], result.values[n.id], result.diagnostics.get(n.id),
                                    result.meshes.get(n.id))
                result.frozen[n.id] = {"stale": False}
        for gone in set(held) - {n.id for n in graph.nodes if n.frozen}:
            del held[gone]
        if view is not None:
            buffer.clear(run, tag_prefix=f"{tag}/")  # meshes from earlier cooks are stale now
        _push_node_meshes(run, tag, result, list(result.meshes))

        listed = []
        for ids in programs:
            seq_tag = _sequence_tag(tag, programs, ids[0])
            if view is None:
                _push_sequence(run, tag, result, ids, seq_tag, int((context or {}).get("subframes") or 0))
            listed.append({"root": ids[0], "node_ids": ids, "sequence_tag": seq_tag})

        return JSONResponse({
            "ok": True,
            "node_ids": list(result.values.keys()),
            "mesh_node_ids": [n for n in result.values if (s_ := pipeline_registry.get(
                next(x.kind for x in graph.nodes if x.id == n))) is not None and s_.to_mesh is not None],
            "meshed": list(result.meshes),  # the node meshes pushed (lazily: ends and the viewed)
            "reused": result.reused,  # nodes unchanged since the last cook, not recomputed
            "diagnostics": result.diagnostics,
            "frozen": result.frozen,  # each frozen node: whether it's stale (upstream changed since)
            "programs": listed,
        })

    @app.post("/api/pipeline/{tag}/meshes")
    async def pipeline_meshes(tag: str, request: Request) -> JSONResponse:
        """Meshes from the last cook's values, pushed like a cook's: `nodes`
        (each under its own tag; ones already made are pushed again), and/or
        `sequence` (a program's root node id) -- its whole replay, with
        `subframes` in-between frames per step that has them (not broadcast:
        fetch it when this returns)."""
        body = await request.json()
        run = body.get("run", "default")
        result = app.state.cook_cache.get((run, tag))
        if result is None or result.graph is None:
            return JSONResponse({"ok": False, "error": "nothing cooked yet"}, status_code=404)
        nodes = [n for n in body.get("nodes") or [] if n in result.values]
        root = body.get("sequence")
        programs = graph_programs(result.graph, pipeline_registry)
        ids = next((p for p in programs if p and p[0] == root), None) if root else None
        if root and ids is None:
            return JSONResponse({"ok": False, "error": f"no program starts at {root!r}"}, status_code=404)

        def work():
            pushed = _push_node_meshes(run, tag, result, nodes)
            frames = _push_sequence(run, tag, result, ids, _sequence_tag(tag, programs, root),
                                    int(body.get("subframes") or 0), broadcast=False) if ids else 0
            return pushed, frames

        async with cook_lock:
            pushed, frames = await asyncio.to_thread(work)
        return JSONResponse({"ok": True, "nodes": pushed, "frames": frames})

    @app.post("/api/pipeline/{tag}/actions")
    async def pipeline_actions(tag: str, request: Request) -> JSONResponse:
        """A cooked node's actions (a controller's hits): `{kind, params, ...}`
        each, in order (see `NodeSpec.actions`)."""
        body = await request.json()
        result = app.state.cook_cache.get((body.get("run", "default"), tag))
        node_id = body.get("node")
        if result is None or node_id not in result.values:
            return JSONResponse({"ok": False, "error": "not cooked"}, status_code=404)
        if not _has_actions(result, node_id):
            return JSONResponse({"ok": True, "actions": []})
        actions = await asyncio.to_thread(_call, result, node_id, "actions")
        return ArrayJSONResponse({"ok": True, "actions": actions})

    @app.post("/api/pipeline/{tag}/action")
    async def pipeline_action(tag: str, request: Request) -> JSONResponse:
        """The part after a node's action `index`, under "{tag}/{node}/@action"
        (replaced each time; not broadcast: fetch it when this returns)."""
        body = await request.json()
        run = body.get("run", "default")
        result = app.state.cook_cache.get((run, tag))
        node_id, index = body.get("node"), int(body.get("index", 0))
        if result is None or node_id not in result.values or not _has_actions(result, node_id):
            return JSONResponse({"ok": False, "error": "no actions (not cooked?)"}, status_code=404)

        def work():
            states = _replayed(run, tag, result, node_id, index)
            if index >= len(states):
                raise IndexError(f"{node_id} has {len(states)} actions")
            mesh = pipeline_registry.get(_node(result, node_id).kind).to_mesh(states[index])
            out_tag = f"{tag}/{node_id}/@action"
            buffer.push(run, out_tag, "mesh", {**_mesh_payload(mesh, index), "node_id": node_id}, replace=True,
                        broadcast=False)
            return out_tag

        try:
            async with cook_lock:
                out_tag = await asyncio.to_thread(work)
        except IndexError as e:
            return JSONResponse({"ok": False, "error": str(e)}, status_code=400)
        return JSONResponse({"ok": True, "tag": out_tag, "index": index})

    @app.post("/api/pipeline/{tag}/bake")
    async def pipeline_bake(tag: str, request: Request) -> JSONResponse:
        """The cooked program from `root` (a linear chain) as a path, each node
        with actions (a controller) baked into them: a program of plain
        steps, for export or to open in the graph. Side inputs (a
        controller's goal) aren't part of it."""
        body = await request.json()
        result = app.state.cook_cache.get((body.get("run", "default"), tag))
        if result is None or result.graph is None:
            return JSONResponse({"ok": False, "error": "nothing cooked yet"}, status_code=404)
        programs = graph_programs(result.graph, pipeline_registry)
        root = body.get("root")
        ids = next((p for p in programs if p and p[0] == root), None) if root else (programs[0] if len(programs) == 1 else None)
        if ids is None:
            return JSONResponse({"ok": False, "error": f"no program starts at {root!r}" if root
                                 else "several programs: say which (root)"}, status_code=400)
        into: dict = {}
        for e in result.graph.edges:
            if e.source in ids and e.target in ids:
                into.setdefault(e.target, []).append(e.source)
        if any(into.get(ids[k]) != [ids[k - 1]] for k in range(1, len(ids))):
            return JSONResponse({"ok": False, "error": "only a linear program can be baked"}, status_code=400)
        missing = [i for i in ids if i not in result.values]
        if missing:
            return JSONResponse({"ok": False, "error": f"not cooked: {missing}"}, status_code=400)

        def work():
            specs, baked = [], []
            for nid in ids:
                node = _node(result, nid)
                if _has_actions(result, nid):
                    specs += [{"kind": a["kind"], "params": a["params"]} for a in _call(result, nid, "actions")]
                    baked.append(nid)
                else:
                    specs.append({"kind": node.kind, "params": dict(node.params)})
            return specs, baked

        specs, baked = await asyncio.to_thread(work)
        return ArrayJSONResponse({"ok": True, "path": {
            "format": "databoarder_path/v1", "name": tag, "root": specs[0], "steps": specs[1:],
            "metadata": {"source": "databoarder:bake", "baked": baked}}})

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

    if library_dir is not None:
        register_library_routes(app, Library(library_dir))

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
