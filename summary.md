# DataBoarder — Development Summary

## What it is

DataBoarder is a Python-first live-monitoring dashboard for RL/ML experiments, built as a drop-in replacement for TensorBoard with direct 3-D mesh support and more control over layout.  It lives at `databoarder/` inside the forgeRL repo.

---

## Architecture overview

```
databoarder/
├── databoarder/          # Python package
│   ├── writer.py         # DataBoarder — user-facing API
│   ├── buffer.py         # DataBuffer — in-memory ring + SQLite persistence
│   ├── server.py         # FastAPI REST + WebSocket server
│   ├── converters.py     # JAX/NumPy/PyTorch tensor normalisation
│   ├── cli.py
│   ├── plugins/          # scalar, scalars, histogram, image, mesh, animation
│   └── integrations/
│       ├── sb3.py        # Stable-Baselines3 callback
│       └── mesh_utils.py # profile_to_mesh — slab model → triangulated mesh
├── frontend/             # React + Vite SPA
│   └── src/
│       ├── stores/       # dataStore (Zustand), layoutStore
│       ├── hooks/        # useWebSocket, useTagData
│       ├── components/   # Dashboard, ScalarPanel, MeshPanel, MultiPanel, …
│       └── types/        # TypeScript interfaces
├── dev.py                # Combined dev launcher (backend + Vite)
└── tests/
```

### Backend

| Layer | Technology |
|---|---|
| API server | FastAPI + uvicorn |
| Real-time push | WebSocket (`/ws`) |
| Persistence | SQLite (WAL mode), optional |
| Threading | `threading.RLock` for all buffer writes |

Key endpoints:
- `GET /api/runs` — list all run names
- `GET /api/tags?run=` — list tags for a run
- `GET /api/data?tag=&run=` — fetch all entries for a tag
- `POST /api/log/batch` — batch ingest (used by client mode)
- `WS  /ws` — live push to connected browsers

### Frontend

| Technology | Purpose |
|---|---|
| React + TypeScript + Vite | SPA |
| Zustand | `dataStore` (tag data), `layoutStore` (panel positions) |
| react-grid-layout | Draggable / resizable panel grid |
| Plotly (via react-plotly.js) | Scalar line charts, histograms |
| Three.js + @react-three/fiber | 3-D mesh viewer |
| @react-three/drei | `OrbitControls`, `Center`, `GizmoHelper` |

---

## Python API

```python
from databoarder import DataBoarder

db = DataBoarder(
    run="train",          # sub-run name
    group="cyl-stock-ppo",# optional group — stored as "cyl-stock-ppo/train"
    logfile="logs/run/dashboard.db",  # omit for in-memory only
    port=8765,
    auto_open=True,
)
db.start()

db.log_scalar("rollout/reward", value, step=t)
db.log_scalars("eval/rewards", {"ep0": 1.2, "ep1": 0.9}, step=t)
db.log_histogram("weights/layer0", tensor, step=t)
db.log_image("obs/frame", img_array, step=t)
db.log_mesh("eval/best_mesh", vertices, faces, step=t)

db.close()
```

### Two operating modes

| Mode | When | Behaviour |
|---|---|---|
| **Server mode** | No existing process on the port | Spins up FastAPI + uvicorn in a daemon thread; owns its SQLite DB |
| **Client mode** | Port already bound | Queues entries and batches them via `POST /api/log/batch` every 100 ms |

---

## Data flow

1. `DataBoarder.log_*` → `DataBuffer.push(run, tag, dtype, payload)`
2. Buffer writes to in-memory `deque[maxlen=10_000]` and to SQLite (if configured)
3. Buffer broadcasts to all open WebSocket connections via `asyncio.run_coroutine_threadsafe`
4. Frontend's `useWebSocket` hook receives the JSON message and calls `appendEntry` on the Zustand store
5. Panel components subscribe to the store via `useTagData(run, tag)`; they re-render whenever new entries arrive
6. On page load / WebSocket reconnect, `bootstrapRun()` fetches all existing tags + entries from the REST API to populate historical data

---

## Run grouping

The run name supports a `/` separator.  Setting `group="cyl-stock-ppo"` and `run="train"` stores the full name `"cyl-stock-ppo/train"`.  The dashboard tab bar renders this as:

```
cyl-stock-ppo:  [train]  [eval]
```

---

## SQLite persistence

Schema (`buffer.py`):
```sql
CREATE TABLE entries (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    run   TEXT    NOT NULL,
    tag   TEXT    NOT NULL,
    type  TEXT    NOT NULL,
    step  INTEGER NOT NULL DEFAULT 0,
    data  TEXT    NOT NULL           -- JSON payload
);
CREATE INDEX idx_run_tag ON entries(run, tag);
```

WAL mode is enabled for safe concurrent reads.  The buffer loads the full history at construction time (`_load_from_db`).

**Workflow — reviewing a completed run:**
```bash
# Start dev server pointing at the saved DB
python databoarder/dev.py --logfile logs/cyl-stock-slab-ppo-optuna-omega_long/dashboard.db
# Open http://localhost:5173 (or whatever Vite prints)
```

**Workflow — live monitoring:**
```bash
# Terminal 1
python databoarder/dev.py --logfile logs/run/dashboard.db
# Terminal 2
python main_slab.py   # or test_slab_agent.py
```

---

## Stable-Baselines3 integration

`databoarder/integrations/sb3.py` provides `DataBoarderCallback(BaseCallback)`.

```python
from databoarder.integrations.sb3 import DataBoarderCallback

db_callback = DataBoarderCallback(db, verbose=0)
# Drains model.logger.name_to_value on every rollout end.
# Tags mirror SB3 paths: "rollout/ep_rew_mean", "train/learning_rate", …
model.learn(total_timesteps=1_000_000, callback=CallbackList([..., db_callback]))
```

---

## 3-D mesh support

### `profile_to_mesh` — `databoarder/integrations/mesh_utils.py`

Converts a slab-model `(z_coords, radii)` profile to a closed triangulated mesh.  Mirrors the coordinate convention of `billet_to_pv` in the JAX-FORGE codebase:

- Billet axis → **X**
- Cross-section → **YZ** plane
- `radii` shape → `(S, T)` — S slabs × T angular samples

```python
from databoarder.integrations.mesh_utils import profile_to_mesh

# z   — (S,)   axial positions
# r   — (S, T) radii (forge_model.radii.numpy()[batch_idx])
verts, faces = profile_to_mesh(z, r)
db.log_mesh("eval/best_mesh", verts, faces, step=step_i)
```

Generates `S*T + 2` vertices (ring vertices + two end-cap centres) and `2*(S-1)*T + 2*T` triangles.

### `MeshPanel` — `frontend/src/components/MeshPanel.tsx`

Three.js viewer with:
- **Timeline scrubber** — drag to any keyframe; step counter shows `frame / total · step N`
- **Play / Pause** — interval-based playback at user-set FPS (1–30)
- **Overlay mode** — renders up to 20 sampled frames simultaneously with blue→orange gradient and increasing opacity; frames sit in their **natural coordinate space** (no centering) so the fixed anvil end stays aligned across all frames
- **Single-frame mode** — uses `<Center>` to auto-frame the current billet
- **Orbit controls + axis gizmo** — full 3-D navigation

Frame tracking is done by **step number** (not array index) so new frames arriving live via WebSocket never disrupt the scrubber position or playback.

---

## Dashboard UI features

| Feature | How |
|---|---|
| Add panel | Click tag in sidebar → panel spawns on grid |
| Remove panel | Click ✕ in panel title bar |
| Move / resize | Drag title bar / corner handles; `compactType=null` (no auto-pack) |
| Merge panels | Ctrl+click two scalar panels → combined Plotly trace overlay |
| Legend isolate | Plotly `uirevision` preserves trace visibility across updates |
| Axes rescale on resize | `onResizeStop` dispatches `window.resize` event |
| Refresh stale data | "↺ Refresh" button re-fetches all tags + data for the active run |

---

## Integration in forgeRL

### Training — `main_slab.py`

```python
from databoarder import DataBoarder
from databoarder.integrations.sb3 import DataBoarderCallback

db = DataBoarder(run="train", group=run_name,
                 logfile=run_folder / "dashboard.db", auto_open=False)
db.start()
db_callback = DataBoarderCallback(db, verbose=0)
agent.learn(..., callback=CallbackList([..., db_callback]))
db.close()
```

### Evaluation — `test_slab_agent.py`

Attaches to the same `dashboard.db` as training via a second `DataBoarder` instance (client mode if the server is already running, or server mode if reviewing after the fact).  Logs:
- `eval/total_reward` — per-episode total
- `eval/step_reward` — per-step rewards for all episodes (multi-line via `log_scalars`)
- `eval/total_reward_mean`, `eval/total_reward_std` — summary stats
- `eval/best_mesh` — keyframed 3-D mesh for the best episode (one entry per sim step)

---

## Known issues / gotchas

- **Stale server processes** — if a 405 error appears on `/api/log/batch`, a stale server from a previous session is running.  Kill it: `lsof -ti :8765 | xargs kill -9`.
- **Client mode ignores `logfile`** — the running server owns its DB; the client just sends entries over HTTP.  Always start the server with `--logfile` before running training/eval scripts if persistence is needed.
- **Mesh size in SQLite** — each `eval/best_mesh` keyframe is serialised as a JSON blob (all vertex floats).  100 frames of a 100-slab × 32-theta mesh ≈ a few MB — acceptable, but avoid logging thousands of high-resolution frames.
