"""Custom hatch build hook — builds the React frontend before packaging."""

import subprocess
import sys
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CustomBuildHook(BuildHookInterface):
    def initialize(self, version: str, build_data: dict) -> None:  # type: ignore[override]
        # Editable installs are for development; Vite dev server handles the
        # frontend in that workflow so there's no need to build static files.
        if version == "editable":
            return
        frontend = Path(self.root) / "frontend"
        if not frontend.exists():
            return
        node = subprocess.run(["node", "--version"], capture_output=True)
        if node.returncode != 0:
            print("WARNING: Node.js not found — skipping frontend build.", file=sys.stderr)
            return
        subprocess.run(["npm", "install"], cwd=frontend, check=True)
        subprocess.run(["npm", "run", "build"], cwd=frontend, check=True)
