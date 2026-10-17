"""The saved-graph library routes (synchronous TestClient)."""

from fastapi.testclient import TestClient

from databoarder.buffer import DataBuffer
from databoarder.library import AUTOSAVE, entry_id
from databoarder.plugins import PluginRegistry
from databoarder.server import create_app


def _client(tmp_path):
    return TestClient(create_app(DataBuffer(max_steps=10), PluginRegistry(), library_dir=tmp_path))


def test_save_list_open_delete(tmp_path):
    c = _client(tmp_path)
    graph = {"nodes": [{"id": "a", "kind": "stock", "params": {}}], "edges": []}
    r = c.put("/api/library/cog_A", json={"name": "cog A", "content": graph, "summary": {"nodes": 1}}).json()
    assert r["ok"] and r["name"] == "cog A"
    c.put(f"/api/library/{AUTOSAVE}", json={"content": graph})
    entries = c.get("/api/library").json()["entries"]
    assert [e["id"] for e in entries] == ["cog_A"]  # the autosave isn't listed
    assert c.get("/api/library/cog_A").json()["content"] == graph
    assert c.get(f"/api/library/{AUTOSAVE}").json()["content"] == graph
    assert c.delete("/api/library/cog_A").json()["ok"]
    assert c.get("/api/library/cog_A").status_code == 404


def test_ids_stay_inside_the_library(tmp_path):
    c = _client(tmp_path)
    assert entry_id("cog t2_2 (pi3) / ../x") == "cog_t2_2_(pi3)_.._x"
    assert c.put("/api/library/..%2Fescape", json={"content": {}}).status_code >= 400  # never routed
    assert not (tmp_path.parent / "escape.json").exists()
    assert c.get("/api/library/.hidden").status_code == 400
    assert c.put("/api/library/ok", json={}).status_code == 400  # no content
