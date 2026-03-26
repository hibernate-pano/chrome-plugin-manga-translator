from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
SERVER_DIR = ROOT_DIR / "server"
RUNTIME_DIR = ROOT_DIR / ".runtime"
LOG_DIR = ROOT_DIR / ".logs"
PID_FILE = RUNTIME_DIR / "manga-translator-server.pid"
LOG_FILE = LOG_DIR / "manga-translator-server.log"
HOST = "127.0.0.1"
PORT = "8000"


def resolve_python() -> str:
  candidates = [
    SERVER_DIR / ".venv311" / "bin" / "python",
    SERVER_DIR / ".venv" / "bin" / "python",
  ]
  for candidate in candidates:
    if candidate.exists():
      return str(candidate)
  return sys.executable


def main() -> int:
  RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
  LOG_DIR.mkdir(parents=True, exist_ok=True)

  with LOG_FILE.open("a", encoding="utf-8") as log_file:
    process = subprocess.Popen(
      [
        resolve_python(),
        "-m",
        "uvicorn",
        "app.main:app",
        "--host",
        HOST,
        "--port",
        PORT,
      ],
      cwd=str(SERVER_DIR),
      stdin=subprocess.DEVNULL,
      stdout=log_file,
      stderr=subprocess.STDOUT,
      start_new_session=True,
    )

  PID_FILE.write_text(str(process.pid), encoding="utf-8")
  print(process.pid)
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
