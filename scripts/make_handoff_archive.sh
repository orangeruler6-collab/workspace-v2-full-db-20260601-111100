#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT_DIR/release"
TS="$(date +%Y%m%d_%H%M%S)"
ARCHIVE="$OUT_DIR/workspace-v2_handoff_$TS.zip"

mkdir -p "$OUT_DIR"
cd "$ROOT_DIR"

zip -r "$ARCHIVE" . \
  -x "node_modules/*" \
  -x "dist/*" \
  -x "release/*" \
  -x ".git/*" \
  -x ".env" \
  -x ".env.local" \
  -x "*.log" \
  -x ".DS_Store" \
  -x "data/*.db" \
  -x "public/uploads/*" \
  -x "tools/douyin-downloader/.venv/*" \
  -x "tools/douyin-downloader/.venv*/*" \
  -x "tools/douyin-downloader/Downloaded/*" \
  -x "tools/douyin-downloader/rendered_comment_report/*" \
  -x "tools/douyin-downloader/config.yml" \
  -x "tools/douyin-downloader/config.local.yml" \
  -x "tools/douyin-downloader/.cookies.json" \
  -x "tools/douyin-downloader/config/cookies.json" \
  -x "tools/douyin-downloader/dy_downloader.db" \
  -x "tools/douyin-downloader/*.docx" \
  -x "tools/bilibili-cli/.venv/*" \
  -x "tools/bilibili-cli/.venv*/*"

echo "$ARCHIVE"
