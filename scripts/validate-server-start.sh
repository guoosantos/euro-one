#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-5189}"

fail() {
  echo "[validate] falha detectada"
  if command -v pm2 >/dev/null 2>&1; then
    pm2 logs euro-one-server --lines 200 || true
  else
    echo "[validate] pm2 não disponível para imprimir logs"
  fi
  exit 1
}

echo "[validate] checking http://${HOST}:${PORT}"

if ! curl -sf --max-time 8 "http://127.0.0.1:${PORT}/health" >/dev/null; then
  echo "[validate] /health não respondeu"
  fail
fi
echo "[validate] /health responded successfully"

if command -v ss >/dev/null 2>&1; then
  if ss -ltnp | grep -E ":${PORT}\\s" >/dev/null; then
    echo "[validate] port ${PORT} is bound"
  else
    echo "[validate] port ${PORT} is NOT bound"
    fail
  fi
else
  echo "[validate] 'ss' not available to verify listening socket"
  fail
fi

echo "[validate] checks completed"
