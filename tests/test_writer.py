import numpy as np
import pytest
from databoarder.buffer import DataBuffer
from databoarder.converters import to_numpy
from databoarder.writer import DataBoarder


def test_to_numpy_ndarray():
    arr = np.array([1.0, 2.0, 3.0])
    assert isinstance(to_numpy(arr), np.ndarray)
    np.testing.assert_array_equal(to_numpy(arr), arr)


def test_to_numpy_list():
    assert isinstance(to_numpy([1, 2, 3]), np.ndarray)


def test_buffer_push_and_get():
    buf = DataBuffer(max_steps=100)
    buf.push("exp1", "loss", "scalar", {"step": 0, "value": 1.5})
    buf.push("exp1", "loss", "scalar", {"step": 1, "value": 1.2})
    entries = buf.get("exp1", "loss")
    assert len(entries) == 2
    assert entries[0]["data"]["value"] == 1.5


def test_buffer_ring():
    buf = DataBuffer(max_steps=3)
    for i in range(5):
        buf.push("r", "x", "scalar", {"step": i, "value": float(i)})
    entries = buf.get("r", "x")
    assert len(entries) == 3
    assert entries[-1]["data"]["step"] == 4


def test_buffer_runs():
    buf = DataBuffer()
    buf.push("run_a", "loss", "scalar", {"step": 0, "value": 1.0})
    buf.push("run_b", "loss", "scalar", {"step": 0, "value": 2.0})
    assert set(buf.runs()) == {"run_a", "run_b"}
    assert buf.tags("run_a") == ["loss"]
    assert buf.get("run_b", "loss")[0]["data"]["value"] == 2.0


def test_writer_log_scalar(tmp_path):
    w = DataBoarder(run="test", logdir=tmp_path, auto_open=False)
    w.log_scalar("train/loss", 0.5, step=1)
    entries = w._buffer.get("test", "train/loss")
    assert len(entries) == 1
    assert entries[0]["data"]["value"] == pytest.approx(0.5)


def test_writer_log_histogram(tmp_path):
    w = DataBoarder(run="test", logdir=tmp_path, auto_open=False)
    arr = np.random.randn(1000).astype(np.float32)
    w.log_histogram("weights", arr, step=0)
    entries = w._buffer.get("test", "weights")
    assert len(entries) == 1
    data = entries[0]["data"]
    assert len(data["counts"]) == 64


def test_writer_tags(tmp_path):
    w = DataBoarder(run="r", logdir=tmp_path, auto_open=False)
    w.log_scalar("a", 1.0, step=0)
    w.log_scalar("b", 2.0, step=0)
    assert set(w._buffer.tags("r")) == {"a", "b"}
