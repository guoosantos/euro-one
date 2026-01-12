#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
TARGETS=("$ROOT_DIR/ecosystem.config.cjs" "$ROOT_DIR/server" "$ROOT_DIR/client")
ECOSYSTEM_FILE="$ROOT_DIR/ecosystem.config.cjs"
ECOSYSTEM_TEMPLATE="$ROOT_DIR/ecosystem.config.template.cjs"

if ! command -v rg >/dev/null 2>&1; then
  echo "❌ Guard: 'rg' não encontrado para validar conflitos."
  exit 2
fi

if rg -n '^(<<<<<<<|=======|>>>>>>>)' "${TARGETS[@]}" >/dev/null 2>&1; then
  echo "❌ Guard: marcadores de conflito encontrados. Resolva antes de iniciar."
  rg -n '^(<<<<<<<|=======|>>>>>>>)' "${TARGETS[@]}" || true

  if rg -n '^(<<<<<<<|=======|>>>>>>>)' "$ECOSYSTEM_FILE" >/dev/null 2>&1; then
    if [[ -f "$ECOSYSTEM_TEMPLATE" ]]; then
      cp "$ECOSYSTEM_TEMPLATE" "$ECOSYSTEM_FILE"
      echo "⚠️ Guard: ecosystem.config.cjs regenerado a partir do template."
    else
      echo "⚠️ Guard: template ausente para regenerar ecosystem.config.cjs."
    fi
  fi

  exit 2
fi

echo "✅ Guard: nenhum marcador de conflito encontrado."
