#!/usr/bin/env bash
set -euo pipefail
if grep -RIl --include='Vehicles.jsx' -E '<\s*CommBuckets\s*/>' src/pages >/dev/null 2>&1; then
  echo "❌ Guard: Remova <CommBuckets /> de src/pages/Vehicles.jsx"; exit 2
fi
