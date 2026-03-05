#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "uso: $0 /caminho/base.tgz /caminho/dist" >&2
  exit 2
fi

BASE_TGZ="$1"
DIST_DIR="$2"

[[ -f "$BASE_TGZ" ]] || { echo "ERRO: tgz não encontrado: $BASE_TGZ" >&2; exit 2; }
[[ -d "$DIST_DIR" ]] || { echo "ERRO: dist não encontrado: $DIST_DIR" >&2; exit 2; }

tmp_base="$(mktemp -d)"
tmp_work="$(mktemp -d)"
trap 'rm -rf "$tmp_base" "$tmp_work"' EXIT

tar -xzf "$BASE_TGZ" -C "$tmp_base"

list_files() {
  local dir="$1"
  (
    cd "$dir"
    find . -type f ! -path "./version.json" | LC_ALL=C sort
  )
}

sum_files() {
  local dir="$1"
  (
    cd "$dir"
    while IFS= read -r rel; do
      sha256sum "$rel"
    done < <(find . -type f ! -path "./version.json" | LC_ALL=C sort)
  )
}

list_files "$tmp_base" > "$tmp_work/base.files"
list_files "$DIST_DIR" > "$tmp_work/dist.files"

if ! diff -u "$tmp_work/base.files" "$tmp_work/dist.files" > "$tmp_work/files.diff"; then
  echo "ERRO: lista de arquivos diverge (ignorando version.json)." >&2
  cat "$tmp_work/files.diff" >&2
  exit 1
fi

sum_files "$tmp_base" > "$tmp_work/base.sha"
sum_files "$DIST_DIR" > "$tmp_work/dist.sha"

if ! diff -u "$tmp_work/base.sha" "$tmp_work/dist.sha" > "$tmp_work/sha.diff"; then
  echo "ERRO: conteúdo dos arquivos diverge (ignorando version.json)." >&2
  cat "$tmp_work/sha.diff" >&2
  exit 1
fi

echo "OK: dist reproduz o TGZ base (comparação 1:1, ignorando version.json)."
