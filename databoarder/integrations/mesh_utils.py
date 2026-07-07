"""Mesh construction utilities for the ForgeRL / slab-model domain.

Mirrors the convention used by ``fwc.utils.billet_io.billet_to_pv``:
  - billet axis  → X
  - cross-section → YZ plane
  - radii shape  → ``(S, T)``  (S slabs, T angular samples)
"""

from __future__ import annotations

import numpy as np


def profile_to_mesh(
    z_coords: np.ndarray,
    radii: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Convert a slab-model (z, r) profile to a closed triangulated mesh.

    Matches the vertex layout of ``billet_to_pv`` so the DataBoarder viewer
    shows the same shape as the PyVista GIFs.

    Parameters
    ----------
    z_coords:
        1-D array of axial slab positions, shape ``(S,)``.
    radii:
        2-D array of radii ``(S, T)`` — one radius per slab per angular
        sample — **or** 1-D ``(S,)`` for a circular cross-section.
        This is exactly what ``forge_model.radii.numpy()[batch_idx]`` returns.

    Returns
    -------
    vertices : float32 ndarray, shape ``(S*T + 2, 3)``
        Lateral surface vertices plus two end-cap centre points.
    faces : int32 ndarray, shape ``(2*(S-1)*T + 2*T, 3)``
        Triangles for lateral surface and both flat end caps.
    """
    z_coords = np.asarray(z_coords, dtype=np.float32).ravel()
    radii    = np.asarray(radii,    dtype=np.float32)

    if radii.ndim == 1:
        # Circular cross-section fallback
        T      = 32
        thetas = np.linspace(0.0, 2.0 * np.pi, T, endpoint=False, dtype=np.float32)
        radii  = np.outer(radii, np.ones(T, dtype=np.float32))  # (S, T)
    elif radii.ndim != 2:
        raise ValueError(f"radii must be 1-D or 2-D, got shape {radii.shape}")

    S, T = radii.shape
    thetas = np.linspace(0.0, 2.0 * np.pi, T, endpoint=False, dtype=np.float32)

    # ── Vertices ──────────────────────────────────────────────────────────────
    # Lateral ring vertices: S*T points
    # End cap centres: 2 extra points at x = z[0] and x = z[-1]
    verts = np.empty((S * T + 2, 3), dtype=np.float32)
    verts[: S * T, 0] = np.repeat(z_coords, T)              # x = axial
    verts[: S * T, 1] = (radii * np.cos(thetas)).ravel()    # y
    verts[: S * T, 2] = (radii * np.sin(thetas)).ravel()    # z (cross-section)
    verts[S * T]      = [z_coords[0],  0.0, 0.0]            # cap0 centre
    verts[S * T + 1]  = [z_coords[-1], 0.0, 0.0]            # cap1 centre

    # ── Lateral faces (vectorised) ────────────────────────────────────────────
    ii, jj = np.meshgrid(np.arange(S - 1), np.arange(T), indexing="ij")
    j1 = (jj + 1) % T
    a  = ii * T + jj
    b  = ii * T + j1
    c  = (ii + 1) * T + j1
    d  = (ii + 1) * T + jj
    lateral = np.empty(((S - 1) * T * 2, 3), dtype=np.int32)
    lateral[0::2] = np.stack([a, b, c], axis=-1).reshape(-1, 3)
    lateral[1::2] = np.stack([a, c, d], axis=-1).reshape(-1, 3)

    # ── End-cap faces ─────────────────────────────────────────────────────────
    j      = np.arange(T)
    j1     = (j + 1) % T
    cap0   = S * T
    cap1   = S * T + 1
    base_l = (S - 1) * T
    cap0_tris = np.stack([np.full(T, cap0), j1, j],                axis=1)
    cap1_tris = np.stack([np.full(T, cap1), base_l + j, base_l + j1], axis=1)

    faces = np.concatenate([lateral, cap0_tris, cap1_tris]).astype(np.int32)
    return verts, faces
