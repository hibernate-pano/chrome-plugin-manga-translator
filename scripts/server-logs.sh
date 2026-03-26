#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$ROOT_DIR/.logs/manga-translator-server.log"

if [[ ! -f "$LOG_FILE" ]]; then
  echo "暂无日志: $LOG_FILE"
  exit 0
fi

tail -n 120 -f "$LOG_FILE"
