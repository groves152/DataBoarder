# DataBoarder

A Python-first data visualization library with a live web dashboard. Designed for ML/RL researchers who need more control than TensorBoard — custom layouts, mesh rendering, frame-cached animations, and first-class JAX/NumPy/PyTorch tensor support.

---

## Design Goals

| Goal | Notes |
|---|---|
| Drop-in logging | `writer.log_scalar(...)`, `writer.log_mesh(...)` — minimal boilerplate |
| Live streaming | WebSocket push from Python → browser, no page refresh needed |
| Tensor-native | Accepts `jax.Array`, `np.ndarray`, `torch.Tensor`, `pd.DataFrame` transparently |
| Mesh support | Render vertices + faces in 3D using Three.js / React Three Fiber |
| Animation playback | Cache frames server-side; scrub or play back in browser |
| Extensible plugins | Each viz type is a self-contained plugin; add custom ones |
| Embeddable | Can run inside a Jupyter notebook via `iframe` or as a standalone server |

---

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│  User Python Code                           │
│  writer = DataBoarder(port=6006)            │
│  writer.log_scalar("loss", value, step)     │
│  writer.log_mesh("mesh", verts, faces)      │
└─────────────────┬───────────────────────────┘
                  │ in-process call
┌─────────────────▼───────────────────────────┐
│  Python Backend  (FastAPI)                  │
│  ┌────────────┐  ┌──────────────────────┐   │
│  │ DataBuffer │  │ Plugin Registry      │   │
│  │ (per tag)  │  │ scalars / images /   │   │
│  │ ring buffer│  │ meshes / animations  │   │
│  └────────────┘  └──────────────────────┘   │
│  REST   /api/data/{tag}                     │
│  WS     /ws  (push on new data)             │
└─────────────────┬───────────────────────────┘
                  │ HTTP / WebSocket
┌─────────────────▼───────────────────────────┐
│  Browser Frontend  (React + TypeScript)     │
│  ┌──────────┐ ┌──────────┐ ┌─────────────┐ │
│  │ScalarPlot│ │MeshViewer│ │AnimPlayer   │ │
│  │(Plotly)  │ │(Three.js)│ │(frame cache)│ │
│  └──────────┘ └──────────┘ └─────────────┘ │
│  Layout engine — drag/resize panels         │
└─────────────────────────────────────────────┘
```

---

## Planned Plugin Types

| Plugin | Status | Description |
|---|---|---|
| `scalar` | Phase 1 | Line/scatter plots, multi-run overlays |
| `histogram` | Phase 1 | Value distributions over training steps |
| `image` | Phase 1 | Grid of images (CHW or HWC tensors) |
| `text` | Phase 1 | Markdown / plain text logs |
| `mesh` | Phase 2 | 3D mesh viewer (vertices, faces, normals, vertex colors) |
| `point_cloud` | Phase 2 | Unstructured point clouds |
| `animation` | Phase 2 | Frame-sequence player (any of the above as frames) |
| `heatmap` | Phase 2 | 2D scalar field / attention maps |
| `custom` | Phase 3 | User-supplied React component + Python serializer |

---

## Python API Sketch

```python
from databoarder import DataBoarder

writer = DataBoarder(logdir="runs/exp1", port=6006, host="localhost")
writer.start()  # launches background server + opens browser

# Scalars
writer.log_scalar("train/loss", loss, step=i)
writer.log_scalars("metrics", {"acc": acc, "f1": f1}, step=i)

# Images  (accepts np/jax/torch, CHW or HWC, float 0-1 or uint8)
writer.log_image("input_obs", obs_tensor, step=i)

# Histogram
writer.log_histogram("weights/layer1", param_array, step=i)

# Mesh  (phase 2)
writer.log_mesh("terrain", vertices, faces, colors=vc, step=i)

# Animation — log frames, play later
writer.log_frame("rollout", frame_tensor, frame_idx=t)

writer.close()
```

---

## Tech Stack

### Python package
- **FastAPI** — async REST + WebSocket server
- **uvicorn** — ASGI runner (launched in a daemon thread)
- **numpy** — canonical internal array format
- **msgpack** — compact binary serialization over WebSocket
- **h5py** (optional) — on-disk frame cache for large animations

### Frontend
- **Vite** — build tool (fast HMR, small bundles)
- **React 18 + TypeScript** — component framework
- **Plotly.js** — 2D charts (scalars, histograms, heatmaps)
- **Three.js + @react-three/fiber** — 3D mesh / point cloud rendering
- **Zustand** — lightweight global state (panel layout, data store)
- **react-grid-layout** — draggable/resizable panel grid
- **TailwindCSS** — styling

---

## Directory Layout

```
databoarder/
├── pyproject.toml              # Python package metadata & build config
├── README.md
├── databoarder/                # Python source
│   ├── __init__.py             # Public API surface
│   ├── writer.py               # DataBoarder class (main entry point)
│   ├── server.py               # FastAPI app, REST routes, WebSocket hub
│   ├── buffer.py               # Per-tag ring buffers, on-disk overflow
│   ├── converters.py           # jax/torch/np → canonical dict payload
│   └── plugins/
│       ├── __init__.py
│       ├── base.py             # Plugin ABC
│       ├── scalar.py
│       ├── image.py
│       ├── histogram.py
│       ├── mesh.py             # Phase 2
│       └── animation.py        # Phase 2
├── frontend/                   # React/TS source (built → databoarder/static/)
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/
│       │   ├── Dashboard.tsx
│       │   ├── PanelGrid.tsx
│       │   ├── ScalarPanel.tsx
│       │   ├── ImagePanel.tsx
│       │   ├── HistogramPanel.tsx
│       │   ├── MeshPanel.tsx       # Phase 2
│       │   └── AnimationPanel.tsx  # Phase 2
│       ├── hooks/
│       │   ├── useWebSocket.ts
│       │   └── useTagData.ts
│       ├── stores/
│       │   ├── dataStore.ts
│       │   └── layoutStore.ts
│       └── types/
│           └── index.ts
└── tests/
    ├── test_writer.py
    ├── test_buffer.py
    ├── test_converters.py
    └── test_server.py
```

---

## Phased Delivery

### Phase 1 — Core infrastructure + scalar/image/histogram
- Python writer API + FastAPI server
- WebSocket push to browser
- Scalar line plots, image grids, histograms
- Draggable panel layout

### Phase 2 — Mesh + animation
- `log_mesh` / `log_point_cloud` with Three.js viewer
- Frame cache + animation player (scrub bar, play/pause/loop)

### Phase 3 — Polish + ecosystem
- Jupyter widget embed
- Multi-run comparison (overlay runs on same plot)
- Plugin SDK for custom visualizations
- Export (PNG, SVG, HDF5 snapshots)
