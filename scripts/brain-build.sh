#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Read version from brain/package.json
VERSION=$(node -e "console.log(require('$ROOT_DIR/packages/brain/package.json').version)")

echo "=== Building cecelia-brain:${VERSION} ==="

# v1.1.0 (2026-05-05): git archive 隔离 — Docker build 用 git HEAD 快照，不用 cwd 工作树。
# 旧版本 docker build $ROOT_DIR 会把 cwd 任何未 commit 的修改（如 package.json 改了
# 但 lock 没更新）打进 image，触发 npm ci EUSAGE fail。git archive HEAD 只导出
# git index 跟 HEAD 的文件，工作树脏改动一律忽略，deploy 对脏工作树完全免疫。
TEMP_BUILD=$(mktemp -d -t cecelia-brain-build-XXXXXX)
# shellcheck disable=SC2064
trap "rm -rf '$TEMP_BUILD'" EXIT

echo "  导出 git HEAD 到临时 build context: $TEMP_BUILD"
git -C "$ROOT_DIR" archive --format=tar HEAD | tar -x -C "$TEMP_BUILD"

# 从干净的 git HEAD 快照构建
docker build \
  -t "cecelia-brain:${VERSION}" \
  -t "cecelia-brain:latest" \
  -f "$TEMP_BUILD/packages/brain/Dockerfile" \
  "$TEMP_BUILD"

echo ""
echo "=== Build complete ==="
echo "  cecelia-brain:${VERSION}"
echo "  cecelia-brain:latest"
echo "  Size: $(docker images "cecelia-brain:${VERSION}" --format '{{.Size}}')"
