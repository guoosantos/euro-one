#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
CLIENT_DIR="$ROOT_DIR/client"
TARGET_DIR="$CLIENT_DIR/src/pages"
if grep -RIl --include='Vehicles.jsx' -E '<\s*CommBuckets\s*/>' "$TARGET_DIR" >/dev/null 2>&1; then
  echo "❌ Guard: Remova <CommBuckets /> de $TARGET_DIR/Vehicles.jsx"; exit 2
fi
