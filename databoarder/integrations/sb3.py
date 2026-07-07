"""Stable-Baselines3 callback for DataBoarder logging.

Usage::

    from databoarder import DataBoarder
    from databoarder.integrations.sb3 import DataBoarderCallback

    db = DataBoarder(run="run1", group="my-experiment",
                     logfile="logs/my-experiment/dashboard.db")
    db.start()

    callback = DataBoarderCallback(db)
    model.learn(total_timesteps=1_000_000, callback=callback)
    db.close()
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from databoarder.writer import DataBoarder

try:
    from stable_baselines3.common.callbacks import BaseCallback
except ImportError as e:
    raise ImportError(
        "stable-baselines3 is required for DataBoarderCallback. "
        "Install it with: pip install stable-baselines3"
    ) from e


class DataBoarderCallback(BaseCallback):
    """Log all SB3 training scalars to a DataBoarder dashboard.

    Drains ``model.logger.name_to_value`` at the end of every rollout and
    forwards each scalar as a ``log_scalar`` call keyed by its SB3 path
    (e.g. ``rollout/ep_rew_mean``, ``train/learning_rate``).

    Parameters
    ----------
    writer:
        A :class:`~databoarder.DataBoarder` instance (already started or not —
        ``start()`` is called automatically if needed).
    tag_prefix:
        Optional prefix prepended to every tag, e.g. ``"ppo"`` →
        ``"ppo/rollout/ep_rew_mean"``.
    verbose:
        Verbosity level (0 = silent).
    """

    def __init__(
        self,
        writer: DataBoarder,
        tag_prefix: str = "",
        verbose: int = 0,
    ) -> None:
        super().__init__(verbose)
        self._db = writer
        self._prefix = tag_prefix

    def _on_step(self) -> bool:
        return True

    def _on_rollout_end(self) -> None:
        step = self.num_timesteps
        for key, value in self.model.logger.name_to_value.items():
            try:
                scalar = float(value)
            except (TypeError, ValueError):
                continue
            tag = f"{self._prefix}/{key}" if self._prefix else key
            self._db.log_scalar(tag, scalar, step=step)

    def _on_training_start(self) -> None:
        if not self._db._client_mode and self._db._server_thread is None:
            self._db.start()
