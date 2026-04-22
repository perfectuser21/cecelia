#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Read version from brain/package.json
VERSION=$(node -e "console.log(require('$ROOT_DIR/packages/brain/package.json').version)")

echo "=== Building cecelia-brain:${VERSION} ==="

# 从 monorepo 根构建（workspace hoisted deps 在 root node_modules）
docker build \
  -t "cecelia-brain:${VERSION}" \
  -t "cecelia-brain:latest" \
  -f "$ROOT_DIR/packages/brain/Dockerfile" \
  "$ROOT_DIR"

echo ""
echo "=== Build complete ==="
echo "  cecelia-brain:${VERSION}"
echo "  cecelia-brain:latest"
echo "  Size: $(docker images cecelia-brain:${VERSION} --format '{{.Size}}')"
