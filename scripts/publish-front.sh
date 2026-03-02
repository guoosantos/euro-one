#!/usr/bin/env bash
set -euo pipefail

# Fluxo padrão: archive oficial canônico.
# Fluxo por source só com liberação explícita:
#   ALLOW_SOURCE_PUBLISH=1 ./scripts/publish-front.sh --from-source
if [[ "${1:-}" == "--from-source" ]]; then
  if [[ "${ALLOW_SOURCE_PUBLISH:-0}" != "1" ]]; then
    echo "publicacao por source bloqueada por seguranca."
    echo "use o fluxo oficial padrao:"
    echo "  ./scripts/publish-front.sh"
    echo "para forcar source de forma explicita:"
    echo "  ALLOW_SOURCE_PUBLISH=1 ./scripts/publish-front.sh --from-source"
    exit 2
  fi
  shift
  exec /home/ubuntu/publish-front-from-source.sh "$@"
fi

exec /home/ubuntu/euro-one/scripts/publish-front-official.sh "$@"
