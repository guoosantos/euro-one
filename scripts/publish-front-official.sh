#!/usr/bin/env bash
set -euo pipefail

# Release canônica travada (mapbox-livefix)
CANONICAL_ARCHIVE="/home/ubuntu/backups/euro-one-front/OFFICIAL_FRONT_BUILD.mapbox-livefix-2026-03-01T021817Z.tgz"
ARCHIVE_PATH="${1:-$CANONICAL_ARCHIVE}"
TARGET_DIST_DIR="/var/www/euro-one/dist"
BACKUP_DIR="/home/ubuntu/backups/euro-one-front"
TIMESTAMP="$(date +%F-%H%M%S)"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

if [ ! -f "$ARCHIVE_PATH" ]; then
  echo "archive nao encontrado: $ARCHIVE_PATH" >&2
  exit 1
fi

tar -xzf "$ARCHIVE_PATH" -C "$TMP_DIR"
if [ ! -f "$TMP_DIR/index.html" ]; then
  echo "archive invalido (index.html ausente): $ARCHIVE_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
if [ -d "$TARGET_DIST_DIR" ]; then
  sudo tar -czf "$BACKUP_DIR/dist-before-official-publish-${TIMESTAMP}.tgz" -C "$TARGET_DIST_DIR" .
fi

sudo mkdir -p "$TARGET_DIST_DIR"
sudo rsync -a --delete "$TMP_DIR/" "$TARGET_DIST_DIR/"
sudo chown -R www-data:www-data "$TARGET_DIST_DIR"
sudo nginx -t
sudo systemctl reload nginx

echo "release oficial publicada em ${TARGET_DIST_DIR}"
echo "origem oficial: ${ARCHIVE_PATH}"
if [ -f "$TARGET_DIST_DIR/version.json" ]; then
  echo "version.json:"
  sudo cat "$TARGET_DIST_DIR/version.json"
fi
