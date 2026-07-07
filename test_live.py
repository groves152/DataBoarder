"""Stream random data to a running DataBoarder server.

Usage:
    python test_live.py              # streams two runs indefinitely
    python test_live.py --steps 200  # log N steps then exit
"""

import argparse
import time
import numpy as np
from databoarder import DataBoarder

def _make_noisy_sphere(rng, seed=0, n_lat=20, n_lon=20):
    """Generate a UV-sphere with a bit of random vertex noise."""
    verts = []
    for i in range(n_lat + 1):
        lat = np.pi * i / n_lat - np.pi / 2
        for j in range(n_lon):
            lon = 2 * np.pi * j / n_lon
            noise = 1.0 + 0.05 * rng.standard_normal()
            x = np.cos(lat) * np.cos(lon) * noise
            y = np.cos(lat) * np.sin(lon) * noise
            z = np.sin(lat) * noise
            verts.append([x, y, z])
    verts = np.array(verts, dtype=np.float32)
    faces = []
    for i in range(n_lat):
        for j in range(n_lon):
            a = i * n_lon + j
            b = i * n_lon + (j + 1) % n_lon
            c = (i + 1) * n_lon + j
            d = (i + 1) * n_lon + (j + 1) % n_lon
            faces += [[a, b, c], [b, d, c]]
    return np.array(verts, dtype=np.float32), np.array(faces, dtype=np.int32)


parser = argparse.ArgumentParser()
parser.add_argument("--steps", type=int, default=0)
parser.add_argument("--port", type=int, default=8765)
parser.add_argument("--interval", type=float, default=0.5)  # 2 steps/sec — safe for live viewing
args = parser.parse_args()

rng = np.random.default_rng(42)

# Two separate runs — appear as separate tabs in the dashboard
run1 = DataBoarder(run="experiment-1", port=args.port, auto_open=False)
run2 = DataBoarder(run="experiment-2", port=args.port, auto_open=False)
run1.start()
run2.start()

# Simulated training state for both runs
s1 = dict(loss=2.5, acc=0.10, val_loss=2.8, val_acc=0.08)
s2 = dict(loss=3.0, acc=0.05, val_loss=3.2, val_acc=0.04)

print(f"Streaming to http://localhost:{args.port}  (Ctrl-C to stop)")

step = 0
try:
    while True:
        for s, w in [(s1, run1), (s2, run2)]:
            s["loss"]     = s["loss"]     * 0.997 + rng.normal(0, 0.02)
            s["val_loss"] = s["val_loss"] * 0.996 + rng.normal(0, 0.04)
            s["acc"]      = min(0.99, s["acc"]     + rng.normal(0.003, 0.008))
            s["val_acc"]  = min(0.99, s["val_acc"] + rng.normal(0.0025, 0.012))
            grad_norm     = abs(rng.normal(1.0, 0.5)) * np.exp(-step / 2000)

            w.log_scalar("train/loss", s["loss"], step=step)
            w.log_scalar("train/acc",  s["acc"],  step=step)
            w.log_scalars("loss/comparison", {"train": s["loss"], "val": s["val_loss"]}, step=step)
            w.log_scalars("acc/comparison",  {"train": s["acc"],  "val": s["val_acc"]},  step=step)
            w.log_scalar("train/grad_norm", grad_norm, step=step)

        # Log a mesh every 50 steps (low frequency — 3D data is large)
        if step % 50 == 0:
            verts, faces = _make_noisy_sphere(rng, step)
            run1.log_mesh("mesh/sphere", verts, faces, step=step)

        step += 1
        if args.steps and step >= args.steps:
            break
        time.sleep(args.interval)

except KeyboardInterrupt:
    pass
finally:
    run1.close()
    run2.close()
    print(f"Done — logged {step} steps.")
