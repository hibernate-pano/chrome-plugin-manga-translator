#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_DIR="$ROOT_DIR/server"
RUNTIME_DIR="$ROOT_DIR/.runtime"
LOG_DIR="$ROOT_DIR/.logs"
PID_FILE="$RUNTIME_DIR/manga-translator-server.pid"
LOG_FILE="$LOG_DIR/manga-translator-server.log"
HOST="127.0.0.1"
PORT="8000"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR"

resolve_python() {
  if [[ -x "$SERVER_DIR/.venv311/bin/python" ]]; then
    echo "$SERVER_DIR/.venv311/bin/python"
    return
  fi

  if [[ -x "$SERVER_DIR/.venv/bin/python" ]]; then
    echo "$SERVER_DIR/.venv/bin/python"
    return
  fi

  if command -v python3.11 >/dev/null 2>&1; then
    echo "python3.11"
    return
  fi

  echo "python3"
}

is_running() {
  if [[ ! -f "$PID_FILE" ]]; then
    return 1
  fi

  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

if is_running; then
  echo "服务已在运行中，PID: $(cat "$PID_FILE")"
  echo "健康检查: http://$HOST:$PORT/api/v1/health"
  exit 0
fi

PYTHON_BIN="$(resolve_python)"
SERVER_PID="$("$PYTHON_BIN" "$ROOT_DIR/scripts/launch_server_daemon.py")"

for _ in {1..60}; do
  if curl --silent --fail "http://$HOST:$PORT/api/v1/health" >/dev/null 2>&1; then
    echo "服务启动成功，PID: $SERVER_PID"
    echo "地址: http://$HOST:$PORT"
    echo "日志: $LOG_FILE"
    exit 0
  fi
  sleep 0.5
done

echo "服务进程已启动，但健康检查未在预期时间内通过。"
echo "PID: $SERVER_PID"
echo "日志: $LOG_FILE"
exit 1
