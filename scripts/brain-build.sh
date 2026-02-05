#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Read version from brain/package.json
VERSION=$(node -e "console.log(require('$ROOT_DIR/brain/package.json').version)")

echo "=== Building cecelia-brain:${VERSION} ==="

docker build \
  -t "cecelia-brain:${VERSION}" \
  -t "cecelia-brain:latest" \
  "$ROOT_DIR/brain"

echo ""
echo "=== Build complete ==="
echo "  cecelia-brain:${VERSION}"
echo "  cecelia-brain:latest"
echo "  Size: $(docker images cecelia-brain:${VERSION} --format '{{.Size}}')"
