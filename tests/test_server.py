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
