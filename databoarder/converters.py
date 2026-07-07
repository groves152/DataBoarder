"""Convert arbitrary array-like objects to numpy for uniform handling."""

from __future__ import annotations

from typing import Any

import numpy as np


def to_numpy(x: Any) -> np.ndarray:
    """Convert jax.Array / torch.Tensor / list / scalar → np.ndarray."""
    if isinstance(x, np.ndarray):
        return x

    # JAX
    try:
        import jax.numpy as jnp  # type: ignore[import]
        if isinstance(x, jnp.ndarray):
            return np.asarray(x)
    except ImportError:
        pass

    # PyTorch
    try:
        import torch  # type: ignore[import]
        if isinstance(x, torch.Tensor):
            return x.detach().cpu().numpy()
    except ImportError:
        pass

    # pandas Series / DataFrame
    try:
        import pandas as pd  # type: ignore[import]
        if isinstance(x, (pd.Series, pd.DataFrame)):
            return x.to_numpy()
    except ImportError:
        pass

    return np.asarray(x)
