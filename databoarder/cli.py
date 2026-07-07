"""CLI entry point: `databoarder --logdir runs/exp1 --port 6006`."""

from __future__ import annotations

import argparse
import webbrowser


def main() -> None:
    parser = argparse.ArgumentParser(description="DataBoarder dashboard server")
    parser.add_argument("--logdir", default="runs/default")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--host", default="localhost")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    from databoarder.buffer import DataBuffer
    from databoarder.plugins import PluginRegistry
    from databoarder.server import create_app, serve

    buf = DataBuffer()
    app = create_app(buf, PluginRegistry())
    if not args.no_browser:
        webbrowser.open(f"http://{args.host}:{args.port}")
    serve(app, args.host, args.port)
