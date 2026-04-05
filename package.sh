#!/bin/bash
#
# package.sh - Create distribution zip files for FoldTube extension
#
# Usage:
#   ./package.sh              # Build both Chrome and Firefox packages
#   ./package.sh chrome       # Build Chrome package only
#   ./package.sh firefox      # Build Firefox package only
#   ./package.sh --output DIR # Specify output directory (default: ./dist)
#
# The source manifest.json uses Chrome's service_worker format.
# For Firefox, the script transforms it to use background.scripts instead,
# and injects data_collection_permissions into gecko settings.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/dist"
VERSION=$(grep -o '"version": *"[^"]*"' "$SCRIPT_DIR/manifest.json" | head -1 | grep -o '[0-9][^"]*')
BUILD_TARGET="all"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    chrome|firefox)
      BUILD_TARGET="$1"
      shift
      ;;
    --output)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [chrome|firefox] [--output DIR]"
      exit 1
      ;;
  esac
done

# Extension files to include (relative to project root) — excludes manifest.json
# since it gets transformed per-browser and added separately.
EXT_FILES=(
  LICENSE
  background/service-worker.js
  content/scraper.js
  dashboard/dashboard.html
  dashboard/dashboard.css
  dashboard/dashboard.js
  icons/icon128.png
)

# Include any additional icon sizes if present
for icon in "$SCRIPT_DIR"/icons/icon*.png; do
  [ -f "$icon" ] || continue
  rel="${icon#$SCRIPT_DIR/}"
  if [[ ! " ${EXT_FILES[*]} " =~ " ${rel} " ]]; then
    EXT_FILES+=("$rel")
  fi
done

mkdir -p "$OUTPUT_DIR"

build_chrome() {
  local zip_name="foldtube-v${VERSION}-chrome.zip"
  local zip_path="$OUTPUT_DIR/$zip_name"
  rm -f "$zip_path"

  echo "Building Chrome package..."

  local tmp_dir
  tmp_dir=$(mktemp -d)
  trap "rm -rf '$tmp_dir'" RETURN

  # Copy extension files
  for f in "${EXT_FILES[@]}"; do
    mkdir -p "$tmp_dir/$(dirname "$f")"
    cp "$SCRIPT_DIR/$f" "$tmp_dir/$f"
  done

  # Chrome manifest: strip browser_specific_settings (ignored by Chrome but cleaner)
  python3 -c "
import json, sys
with open('$SCRIPT_DIR/manifest.json') as f:
    m = json.load(f)
m.pop('browser_specific_settings', None)
with open('$tmp_dir/manifest.json', 'w') as f:
    json.dump(m, f, indent=2)
    f.write('\n')
"

  cd "$tmp_dir"
  zip -rq "$zip_path" .
  echo "  -> $zip_path ($(du -h "$zip_path" | cut -f1 | xargs))"
}

build_firefox() {
  local zip_name="foldtube-v${VERSION}-firefox.zip"
  local zip_path="$OUTPUT_DIR/$zip_name"
  rm -f "$zip_path"

  echo "Building Firefox package..."

  local tmp_dir
  tmp_dir=$(mktemp -d)
  trap "rm -rf '$tmp_dir'" RETURN

  # Copy extension files
  for f in "${EXT_FILES[@]}"; do
    mkdir -p "$tmp_dir/$(dirname "$f")"
    cp "$SCRIPT_DIR/$f" "$tmp_dir/$f"
  done

  # Firefox manifest: replace service_worker with scripts
  python3 -c "
import json, sys
with open('$SCRIPT_DIR/manifest.json') as f:
    m = json.load(f)

# Swap service_worker -> scripts for Firefox event page
bg = m.get('background', {})
sw = bg.pop('service_worker', None)
if sw:
    bg['scripts'] = [sw]
m['background'] = bg

with open('$tmp_dir/manifest.json', 'w') as f:
    json.dump(m, f, indent=2)
    f.write('\n')
"

  cd "$tmp_dir"
  zip -rq "$zip_path" .
  echo "  -> $zip_path ($(du -h "$zip_path" | cut -f1 | xargs))"
}

if [[ "$BUILD_TARGET" == "all" || "$BUILD_TARGET" == "chrome" ]]; then
  build_chrome
fi

if [[ "$BUILD_TARGET" == "all" || "$BUILD_TARGET" == "firefox" ]]; then
  build_firefox
fi

echo ""
echo "Done! Packages are in: $OUTPUT_DIR"
