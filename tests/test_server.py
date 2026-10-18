import pytest
import numpy as np
from httpx import AsyncClient, ASGITransport

from databoarder.buffer import DataBuffer
from databoarder.plugins import PluginRegistry
from databoarder.server import create_app


@pytest.fixture
def buf():
    return DataBuffer(max_steps=100)


@pytest.fixture
def app(buf):
    return create_app(buf, PluginRegistry())


@pytest.mark.asyncio
async def test_runs_empty(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/runs")
    assert r.status_code == 200
    assert r.json() == {"runs": []}


@pytest.mark.asyncio
async def test_tags_empty(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/tags?run=default")
    assert r.json() == {"run": "default", "tags": [], "types": {}}


@pytest.mark.asyncio
async def test_log_and_retrieve(app, buf):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/api/log", json={
            "run": "exp1", "tag": "loss", "type": "scalar",
            "data": {"step": 0, "value": 0.9},
        })
        assert r.status_code == 200
        assert r.json() == {"ok": True}

        r = await c.get("/api/runs")
        assert "exp1" in r.json()["runs"]

        r = await c.get("/api/tags?run=exp1")
        assert "loss" in r.json()["tags"]

        r = await c.get("/api/data?tag=loss&run=exp1")
        entries = r.json()["entries"]
        assert len(entries) == 1
        assert entries[0]["data"]["value"] == pytest.approx(0.9)


@pytest.mark.asyncio
async def test_multiple_runs_isolated(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        await c.post("/api/log", json={"run": "a", "tag": "x", "type": "scalar", "data": {"step": 0, "value": 1.0}})
        await c.post("/api/log", json={"run": "b", "tag": "x", "type": "scalar", "data": {"step": 0, "value": 2.0}})

        ra = await c.get("/api/data?tag=x&run=a")
        rb = await c.get("/api/data?tag=x&run=b")
        assert ra.json()["entries"][0]["data"]["value"] == pytest.approx(1.0)
        assert rb.json()["entries"][0]["data"]["value"] == pytest.approx(2.0)


@pytest.mark.asyncio
async def test_unknown_tag_returns_empty(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/data?tag=nonexistent&run=default")
    assert r.json()["entries"] == []


@pytest.mark.asyncio
async def test_extend_routes_precede_the_frontend_catch_all(buf):
    # A domain package's GET routes must not be swallowed by the built
    # frontend's catch-all (it matches any path; Starlette matches in order).
    def extend(app):
        @app.get("/api/domain/ping")
        async def ping() -> dict:
            return {"pong": True}

    app = create_app(buf, PluginRegistry(), extend=extend)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/domain/ping")
    assert r.status_code == 200
    assert r.json() == {"pong": True}


@pytest.mark.asyncio
async def test_each_program_cooks_its_own_sequence(buf):
    # Two disconnected chains (programs) in one graph: each gets its own
    # sequence tag, in its own order, never mixing in the other's steps.
    from databoarder.pipeline import PipelineRegistry

    reg = PipelineRegistry()
    tri = lambda v: (np.full((3, 3), float(v)), np.array([[0, 1, 2]]))  # noqa: E731
    reg.register("stock", lambda: 0, to_mesh=tri)
    reg.register("add", lambda state: state + 1, inputs=("state",), to_mesh=tri)
    graph = {"nodes": [{"id": i, "kind": k, "params": {}} for i, k in
                       [("a0", "stock"), ("b0", "stock"), ("a1", "add"), ("b1", "add"), ("b2", "add")]],
             "edges": [{"source": s, "target": t} for s, t in [("a0", "a1"), ("b0", "b1"), ("b1", "b2")]]}
    app = create_app(buf, PluginRegistry(), reg)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = (await c.post("/api/pipeline/g/cook", json={"graph": graph})).json()
        programs = {p["root"]: p for p in r["programs"]}
        assert programs["a0"]["node_ids"] == ["a0", "a1"] and programs["b0"]["node_ids"] == ["b0", "b1", "b2"]
        seq = (await c.get("/api/data", params={"tag": programs["b0"]["sequence_tag"], "run": "default"})).json()
        assert [e["data"]["node_id"] for e in seq["entries"]] == ["b0", "b1", "b2"]
        # a single program keeps the plain sequence tag
        one = {"nodes": graph["nodes"][:1], "edges": []}
        r = (await c.post("/api/pipeline/g/cook", json={"graph": one})).json()
        assert r["programs"] == [{"root": "a0", "node_ids": ["a0"], "sequence_tag": "g/__sequence__"}]


@pytest.mark.asyncio
async def test_in_between_frames_go_between_their_node_and_the_one_before(buf):
    # A kind with `frames`: asked for (context.subframes), its in-between
    # meshes come just before its own, at fractional steps; not asked, none.
    from databoarder.pipeline import PipelineRegistry

    reg = PipelineRegistry()
    tri = lambda v: (np.full((3, 3), float(v)), np.array([[0, 1, 2]]))  # noqa: E731
    reg.register("stock", lambda: 0, to_mesh=tri)
    reg.register("add", lambda state, by=1.0: state + by, inputs=("state",), to_mesh=tri,
                 frames=lambda inputs, params, n: [inputs["state"] + params.get("by", 1.0) * k / (n + 1)
                                                   for k in range(1, n + 1)])
    graph = {"nodes": [{"id": "s", "kind": "stock", "params": {}}, {"id": "a", "kind": "add", "params": {"by": 3.0}}],
             "edges": [{"source": "s", "target": "a"}]}
    app = create_app(buf, PluginRegistry(), reg)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        await c.post("/api/pipeline/g/cook", json={"graph": graph, "context": {"subframes": 2}})
        seq = (await c.get("/api/data", params={"tag": "g/__sequence__", "run": "default"})).json()["entries"]
        assert [e["data"]["step"] for e in seq] == pytest.approx([0, 1 / 3, 2 / 3, 1])
        assert [e["data"]["vertices"][0][0] for e in seq] == pytest.approx([0.0, 1.0, 2.0, 3.0])
        assert [e["data"]["node_id"] for e in seq] == ["s", "a", "a", "a"]
        await c.post("/api/pipeline/g/cook", json={"graph": graph})
        seq = (await c.get("/api/data", params={"tag": "g/__sequence__", "run": "default"})).json()["entries"]
        assert [e["data"]["step"] for e in seq] == [0, 1]


@pytest.mark.asyncio
async def test_tags_come_with_their_types(app, buf):
    # a client lists a tag (and how to show it) without fetching its entries
    buf.push("r", "loss", "scalar", {"step": 0, "value": 1.0})
    buf.push("r", "part", "mesh", {"step": 0, "vertices": [[0, 0, 0]], "faces": []})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = (await c.get("/api/tags", params={"run": "r"})).json()
    assert r["types"] == {"loss": "scalar", "part": "mesh"}


@pytest.mark.asyncio
async def test_a_lazy_cook_meshes_what_is_shown_and_the_rest_on_request(buf):
    # `view`: every node cooks, but only each program's end and the viewed
    # nodes are meshed; others (and the replay) come from /meshes, off the
    # cooked values; a re-cook drops the node meshes it made stale.
    from databoarder.pipeline import PipelineRegistry

    reg = PipelineRegistry()
    tri = lambda v: (np.full((3, 3), float(v)), np.array([[0, 1, 2]]))  # noqa: E731
    reg.register("stock", lambda: 0, to_mesh=tri)
    reg.register("add", lambda state, by=1.0: state + by, inputs=("state",), to_mesh=tri,
                 frames=lambda inputs, params, n: [inputs["state"] + params.get("by", 1.0) * k / (n + 1)
                                                   for k in range(1, n + 1)])
    ids = ["s", "a", "b", "c"]
    graph = {"nodes": [{"id": "s", "kind": "stock", "params": {}}]
             + [{"id": i, "kind": "add", "params": {}} for i in ids[1:]],
             "edges": [{"source": x, "target": y} for x, y in zip(ids, ids[1:])]}
    app = create_app(buf, PluginRegistry(), reg)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = (await c.post("/api/pipeline/g/cook", json={"graph": graph, "view": {"nodes": ["a"]}})).json()
        assert r["ok"] and r["node_ids"] == ids and set(r["mesh_node_ids"]) == set(ids)
        assert set(buf.tags("default")) == {"g/a", "g/c"}  # the end and the viewed node only; no replay
        r = (await c.post("/api/pipeline/g/meshes", json={"nodes": ["b"], "sequence": "s", "subframes": 1})).json()
        assert r["nodes"] == ["b"] and r["frames"] == 4 + 3
        seq = (await c.get("/api/data", params={"tag": "g/__sequence__", "run": "default"})).json()["entries"]
        assert [e["data"]["step"] for e in seq] == pytest.approx([0, 0.5, 1, 1.5, 2, 2.5, 3])
        assert [e["data"]["vertices"][0][0] for e in seq] == pytest.approx([0, 0.5, 1, 1.5, 2, 2.5, 3])
        await c.post("/api/pipeline/g/cook", json={"graph": graph, "view": {"nodes": []}})
        assert set(buf.tags("default")) == {"g/c"}  # the others were stale
        assert (await c.post("/api/pipeline/g/meshes", json={"sequence": "nope"})).status_code == 404
        assert (await c.post("/api/pipeline/other/meshes", json={"nodes": ["a"]})).status_code == 404


@pytest.mark.asyncio
async def test_a_recook_recomputes_only_from_the_first_changed_node(buf):
    # node signatures (kind, params, upstream): unchanged nodes keep their
    # values; diagnostics are redone when the context changes
    from databoarder.pipeline import PipelineRegistry

    calls, diag_calls = [], []
    reg = PipelineRegistry()
    tri = lambda v: (np.full((3, 3), float(v)), np.array([[0, 1, 2]]))  # noqa: E731

    def add(state, by=1.0, name=""):
        calls.append(name)
        return state + by

    def diag(value, params, inputs, context, root):
        diag_calls.append(params.get("name"))
        return {"v": float(value), "goal": (context or {}).get("goal")}

    reg.register("stock", lambda: 0, to_mesh=tri)
    reg.register("add", add, inputs=("state",), to_mesh=tri, diagnostics=diag)
    ids = ["s", "a", "b", "c"]

    def graph(by_b):
        return {"nodes": [{"id": "s", "kind": "stock", "params": {}}]
                + [{"id": i, "kind": "add", "params": {"name": i, **({"by": by_b} if i == "b" else {})}} for i in ids[1:]],
                "edges": [{"source": x, "target": y} for x, y in zip(ids, ids[1:])]}

    app = create_app(buf, PluginRegistry(), reg)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = (await c.post("/api/pipeline/g/cook", json={"graph": graph(1.0), "view": {"nodes": []}})).json()
        assert calls == ["a", "b", "c"] and r["reused"] == 0
        calls.clear()
        r = (await c.post("/api/pipeline/g/cook", json={"graph": graph(5.0), "view": {"nodes": []}})).json()
        assert calls == ["b", "c"] and r["reused"] == 2 and r["diagnostics"]["c"]["v"] == 7.0
        calls.clear()
        diag_calls.clear()
        r = (await c.post("/api/pipeline/g/cook", json={"graph": graph(5.0), "view": {"nodes": []},
                                                        "context": {"goal": "x"}})).json()
        assert calls == [] and r["reused"] == 4  # nothing changed but the goal: values kept,
        assert diag_calls == ["a", "b", "c"] and r["diagnostics"]["a"]["goal"] == "x"  # diagnostics redone


@pytest.mark.asyncio
async def test_a_node_ref_param_hands_over_the_referenced_nodes_value(buf):
    from databoarder.pipeline import ParamSpec, PipelineRegistry

    calls = []
    reg = PipelineRegistry()
    tri = lambda v: (np.full((3, 3), float(v)), np.array([[0, 1, 2]]))  # noqa: E731
    reg.register("stock", lambda: 0, to_mesh=tri)
    reg.register("target", lambda value=0.0: value, to_mesh=tri,
                 params={"value": ParamSpec(type="float", default=0.0)})

    def toward(state, goal=None, gain=0.5):
        calls.append(goal)
        return state + gain * ((goal or 0.0) - state)

    reg.register("toward", toward, inputs=("state",), to_mesh=tri,
                 params={"goal": ParamSpec(type="node_ref", default="", ref_kind="target"),
                         "gain": ParamSpec(type="float", default=0.5)})
    assert reg.get("toward").params["goal"].to_json()["ref_kind"] == "target"

    def graph(v):  # the target listed last, and joined by no edge
        return {"nodes": [{"id": "s", "kind": "stock", "params": {}},
                          {"id": "c", "kind": "toward", "params": {"goal": "t"}},
                          {"id": "t", "kind": "target", "params": {"value": v}}],
                "edges": [{"source": "s", "target": "c"}]}

    app = create_app(buf, PluginRegistry(), reg)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = (await c.post("/api/pipeline/g/cook", json={"graph": graph(10.0), "view": {"nodes": ["c"]}})).json()
        assert r["ok"] and calls == [10.0]
        mesh = (await c.get("/api/data", params={"tag": "g/c", "run": "default"})).json()["entries"][0]["data"]
        assert mesh["vertices"][0][0] == pytest.approx(5.0)
        r = (await c.post("/api/pipeline/g/cook", json={"graph": graph(10.0), "view": {"nodes": []}})).json()
        assert calls == [10.0] and r["reused"] == 3  # nothing changed
        r = (await c.post("/api/pipeline/g/cook", json={"graph": graph(20.0), "view": {"nodes": []}})).json()
        assert calls == [10.0, 20.0]  # its goal changed: it cooks again
        # programs stay the edge-joined chains (a reference isn't an edge)
        assert sorted(map(tuple, (p["node_ids"] for p in r["programs"]))) == [("s", "c"), ("t",)]
