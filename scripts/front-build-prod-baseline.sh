#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/home/ubuntu/euro-one.replaced-20260304-201722"
BASE_BRANCH="${BASE_BRANCH:-prod-00h22}"
BASE_TGZ="${BASE_TGZ:-/home/ubuntu/backups/euro-one-front/OFFICIAL_FRONT_BUILD.rollback-blackscreen-20260305T032203Z.tgz}"
HOTFIX_PREFIX="${HOTFIX_PREFIX:-prod00h22-baseline}"

cd "$REPO_DIR"

git fetch origin "$BASE_BRANCH"
git checkout "$BASE_BRANCH"
git reset --hard "origin/$BASE_BRANCH"
git clean -fd

MAIN_SHA="$(git rev-parse HEAD)"
HOTFIX="${HOTFIX_PREFIX}-$(date -u +%Y%m%dT%H%M%SZ)"

if [[ ! -d node_modules ]]; then
  npm ci
fi

GIT_SHA="$MAIN_SHA" npm run build --workspace client

if [[ -f "$BASE_TGZ" ]]; then
  bash "$REPO_DIR/scripts/front-compare-dist-with-tgz.sh" "$BASE_TGZ" "$REPO_DIR/client/dist" || true
fi

bash /home/ubuntu/stamp-front-version-from-deploy.sh "$REPO_DIR/client/dist" "$HOTFIX" "$MAIN_SHA"

OUT="/home/ubuntu/backups/euro-one-front/OFFICIAL_FRONT_BUILD.${HOTFIX}.tgz"
tar -czf "$OUT" -C "$REPO_DIR/client/dist" .

echo "MAIN_SHA=$MAIN_SHA"
echo "HOTFIX=$HOTFIX"
echo "OUT=$OUT"
tar -xOf "$OUT" ./version.json
