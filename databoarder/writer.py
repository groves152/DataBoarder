"""Main user-facing DataBoarder writer."""

from __future__ import annotations

import json
import queue
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import numpy as np

from databoarder.buffer import DataBuffer
from databoarder.converters import to_numpy
from databoarder.plugins import PluginRegistry
from databoarder.server import create_app, serve


class DataBoarder:
    """Log scalars, images, histograms, meshes, and animation frames.

    If a server is already running on the given port, switches to HTTP client
    mode and forwards all calls to the existing server via POST /api/log/batch.

    Parameters
    ----------
    run:
        Name for this run — appears as a tab in the dashboard.
    group:
        Optional group prefix.  ``group="cyl-stock-ppo"`` with ``run="run1"``
        stores the run as ``"cyl-stock-ppo/run1"`` and the dashboard renders it
        under a ``cyl-stock-ppo`` group header in the tab bar.
    logfile:
        Path to a SQLite database file for persistent storage.  History is
        reloaded on server start; new entries are appended.  Ignored in client
        mode (the running server owns its own logfile).
    logdir:
        Directory for on-disk frame caches.
    port:
        FastAPI/WebSocket server port.
    host:
        Bind address.
    max_steps:
        In-memory ring buffer depth per tag.
    auto_open:
        Open browser on start().
    """

    def __init__(
        self,
        run: str = "default",
        group: str | None = None,
        logfile: str | Path | None = None,
        logdir: str | Path = "runs/default",
        port: int = 8765,
        host: str = "localhost",
        max_steps: int = 10_000,
        auto_open: bool = True,
    ) -> None:
        self.run = f"{group}/{run}" if group else run
        self.logdir = Path(logdir)
        self.logdir.mkdir(parents=True, exist_ok=True)
        self.port = port
        self.host = host
        self._auto_open = auto_open
        self._client_mode = False

        self._buffer = DataBuffer(max_steps=max_steps, logfile=logfile)
        self._plugins = PluginRegistry()
        self._app = create_app(self._buffer, self._plugins)
        self._server_thread: threading.Thread | None = None
        self._send_queue: queue.Queue[dict[str, Any]] = queue.Queue()
        self._sender_thread: threading.Thread | None = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> None:
        if self._server_alive():
            self._client_mode = True
            self._sender_thread = threading.Thread(
                target=self._batch_sender, daemon=True
            )
            self._sender_thread.start()
            print(
                f"[DataBoarder] attaching to existing server on "
                f"{self.host}:{self.port}  (run='{self.run}')"
            )
            return

        self._server_thread = threading.Thread(
            target=serve,
            args=(self._app, self.host, self.port),
            daemon=True,
        )
        self._server_thread.start()
        if self._auto_open:
            import webbrowser
            webbrowser.open(f"http://{self.host}:{self.port}")

    def close(self) -> None:
        self._buffer.flush()
        self._buffer.close()

    def __enter__(self) -> "DataBoarder":
        self.start()
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _server_alive(self) -> bool:
        try:
            urllib.request.urlopen(
                f"http://{self.host}:{self.port}/api/runs", timeout=1
            )
            return True
        except Exception:
            return False

    def _batch_sender(self) -> None:
        """Drain the send queue in batches every 100 ms to limit HTTP overhead."""
        url = f"http://{self.host}:{self.port}/api/log/batch"
        while True:
            time.sleep(0.1)
            batch: list[dict[str, Any]] = []
            try:
                while True:
                    batch.append(self._send_queue.get_nowait())
            except queue.Empty:
                pass
            if not batch:
                continue
            body = json.dumps(batch).encode()
            req = urllib.request.Request(
                url, data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                urllib.request.urlopen(req, timeout=5)
            except urllib.error.URLError as e:
                print(f"[DataBoarder] warning: batch send failed ({len(batch)} items): {e}")

    def _push(self, tag: str, dtype: str, payload: dict[str, Any]) -> None:
        if self._client_mode:
            self._send_queue.put({"run": self.run, "tag": tag, "type": dtype, "data": payload})
        else:
            self._buffer.push(self.run, tag, dtype, payload)

    # ------------------------------------------------------------------
    # Logging methods
    # ------------------------------------------------------------------

    def log_scalar(self, tag: str, value: float | Any, step: int) -> None:
        self._push(tag, "scalar", {"step": step, "value": float(to_numpy(value).item())})

    def log_scalars(self, tag: str, values: dict[str, float | Any], step: int) -> None:
        converted = {k: float(to_numpy(v).item()) for k, v in values.items()}
        self._push(tag, "scalars", {"step": step, "values": converted})

    def log_histogram(self, tag: str, values: Any, step: int, bins: int = 64) -> None:
        arr = to_numpy(values).ravel().astype(np.float32)
        counts, edges = np.histogram(arr, bins=bins)
        self._push(tag, "histogram", {
            "step": step,
            "counts": counts.tolist(),
            "edges": edges.tolist(),
        })

    def log_image(self, tag: str, image: Any, step: int, *, dataformats: str = "CHW") -> None:
        arr = to_numpy(image)
        self._push(tag, "image", {
            "step": step,
            "dataformats": dataformats,
            "shape": list(arr.shape),
        })

    def log_images(self, tag: str, images: Any, step: int, *, dataformats: str = "NCHW") -> None:
        arr = to_numpy(images)
        self._push(tag, "images", {
            "step": step,
            "dataformats": dataformats,
            "shape": list(arr.shape),
            "n": arr.shape[0],
        })

    def log_mesh(
        self,
        tag: str,
        vertices: Any,
        faces: Any,
        colors: Any | None = None,
        normals: Any | None = None,
        step: int = 0,
    ) -> None:
        payload: dict[str, Any] = {
            "step": step,
            "vertices": to_numpy(vertices).tolist(),
            "faces": to_numpy(faces).tolist(),
        }
        if colors is not None:
            payload["colors"] = to_numpy(colors).tolist()
        if normals is not None:
            payload["normals"] = to_numpy(normals).tolist()
        self._push(tag, "mesh", payload)

    def log_frame(self, tag: str, frame: Any, frame_idx: int) -> None:
        arr = to_numpy(frame)
        self._push(tag, "animation_frame", {
            "frame_idx": frame_idx,
            "shape": list(arr.shape),
        })
