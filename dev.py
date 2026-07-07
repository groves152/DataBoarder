"""Development entrypoint — starts the FastAPI backend and the Vite dev server.

Usage:
    python dev.py
    python dev.py --port 8765 --no-browser
"""

import argparse
import os
import re
import signal
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

FRONTEND_DIR = Path(__file__).parent / "frontend"


def free_port(start: int) -> int:
    """Return the first port >= start that is not bound."""
    for port in range(start, start + 100):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError(f"No free port found starting from {start}")


def stream(proc: subprocess.Popen, prefix: str, on_line=None) -> None:
    assert proc.stdout is not None
    for line in proc.stdout:
        print(f"{prefix} {line}", end="", flush=True)
        if on_line:
            on_line(line)


def main() -> None:
    parser = argparse.ArgumentParser(description="DataBoarder dev server")
    parser.add_argument("--port", type=int, default=8765, help="Python backend port")
    parser.add_argument("--logfile", type=str, default=None,
                        help="SQLite DB to load/persist (e.g. logs/run/dashboard.db)")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    backend_port = free_port(args.port)
    if backend_port != args.port:
        print(f"[dev] port {args.port} in use, using {backend_port} instead")

    procs: list[subprocess.Popen] = []

    def shutdown(sig=None, frame=None) -> None:
        print("\n[dev] shutting down...", flush=True)
        for p in procs:
            try:
                os.killpg(os.getpgid(p.pid), signal.SIGTERM)
            except ProcessLookupError:
                pass
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    # --- Python backend ---
    logfile_arg = f', logfile="{args.logfile}"' if args.logfile else ""
    backend = subprocess.Popen(
        [
            sys.executable, "-c",
            f"""
import time
from databoarder import DataBoarder
w = DataBoarder(port={backend_port}, auto_open=False{logfile_arg})
w.start()
print("DataBoarder backend  →  http://localhost:{backend_port}", flush=True)
while True:
    time.sleep(1)
""",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        start_new_session=True,
    )
    procs.append(backend)
    threading.Thread(target=stream, args=(backend, "[backend]"), daemon=True).start()

    # Give the backend a moment to bind before Vite starts proxying
    time.sleep(1.5)

    # Patch vite.config.ts backend port if it differs from the default
    vite_config = FRONTEND_DIR / "vite.config.ts"
    original_config = vite_config.read_text()
    patched_config = re.sub(r"localhost:\d+", f"localhost:{backend_port}", original_config)
    vite_config.write_text(patched_config)

    # --- Vite frontend dev server ---
    vite_url_event = threading.Event()
    vite_url: list[str] = []

    def on_vite_line(line: str) -> None:
        # Vite prints:  ➜  Local:   http://localhost:XXXX/
        m = re.search(r"Local:\s+(http://localhost:\d+/?)", line)
        if m and not vite_url_event.is_set():
            vite_url.append(m.group(1).rstrip("/"))
            vite_url_event.set()

    npm = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=FRONTEND_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        start_new_session=True,
    )
    procs.append(npm)
    threading.Thread(target=stream, args=(npm, "[frontend]", on_vite_line), daemon=True).start()

    # Open browser once Vite reports its actual URL (handles port conflicts)
    if not args.no_browser:
        def open_browser() -> None:
            if vite_url_event.wait(timeout=30) and vite_url:
                webbrowser.open(vite_url[0])
        threading.Thread(target=open_browser, daemon=True).start()

    # Restore vite.config.ts on exit so git diff stays clean
    try:
        while all(p.poll() is None for p in procs):
            time.sleep(0.5)
    except Exception:
        pass
    finally:
        vite_config.write_text(original_config)

    for p in procs:
        if p.poll() is not None:
            print(f"[dev] process exited with code {p.returncode}", flush=True)
    shutdown()


if __name__ == "__main__":
    main()
