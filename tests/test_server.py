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
    assert r.json() == {"run": "default", "tags": []}


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
