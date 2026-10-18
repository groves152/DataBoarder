"""Mesh payloads and node categories (synchronous; no server)."""

import json

import numpy as np

from databoarder.converters import jsonable
from databoarder.pipeline import PipelineRegistry
from databoarder.server import _mesh_payload


def _sent(payload):
    """What a client receives (payloads keep numpy arrays until sent)."""
    return json.loads(json.dumps(payload, default=jsonable))


def test_tuple_mesh_payload_is_unchanged():
    p = _sent(_mesh_payload((np.zeros((3, 3)), np.array([[0, 1, 2]])), 4))
    assert p == {"step": 4, "vertices": [[0.0] * 3] * 3, "faces": [[0, 1, 2]]}


def test_dict_mesh_payload_carries_fields_and_tools():
    tool = {"vertices": np.ones((3, 3)), "faces": np.array([[0, 1, 2]]), "role": "coil"}
    p = _sent(_mesh_payload({"vertices": np.zeros((3, 3)), "faces": np.array([[0, 1, 2]]),
                             "fields": {"T_C": np.array([1.0, 2.0, 3.0])}, "field_units": {"T_C": "C"},
                             "tools": [tool]}, 0))
    assert p["fields"] == {"T_C": [1.0, 2.0, 3.0]} and p["field_units"] == {"T_C": "C"}
    assert p["tools"] == [{"vertices": [[1.0] * 3] * 3, "faces": [[0, 1, 2]], "role": "coil"}]


def test_node_category_in_schema():
    reg = PipelineRegistry()
    reg.register("a", lambda: 1)
    reg.register("b", lambda: 1, category="thermal")
    schema = {k["kind"]: k for k in reg.schema()}
    assert "category" not in schema["a"] and schema["b"]["category"] == "thermal"
