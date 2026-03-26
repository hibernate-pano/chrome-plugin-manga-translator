#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$ROOT_DIR/.runtime/manga-translator-server.pid"
LOG_FILE="$ROOT_DIR/.logs/manga-translator-server.log"
HEALTH_URL="http://127.0.0.1:8000/api/v1/health"

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    echo "PID: $PID"
  else
    echo "PID 文件存在，但进程未运行。"
  fi
else
  echo "未找到 PID 文件。"
fi

if curl --silent --fail "$HEALTH_URL" >/dev/null 2>&1; then
  echo "健康状态: OK"
  curl --silent "$HEALTH_URL"
  echo
else
  echo "健康状态: FAILED"
fi

echo "日志: $LOG_FILE"
