#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-5189}"

echo "[validate] checking http://${HOST}:${PORT}"

curl -sf --max-time 8 "http://${HOST}:${PORT}/health" >/dev/null
echo "[validate] /health responded successfully"

if command -v ss >/dev/null 2>&1; then
  if ss -ltnp | grep -E ":${PORT}\\s" >/dev/null; then
    echo "[validate] port ${PORT} is bound"
  else
    echo "[validate] port ${PORT} is NOT bound"
    exit 1
  fi
else
  echo "[validate] 'ss' not available to verify listening socket"
  exit 1
fi

echo "[validate] checks completed"
