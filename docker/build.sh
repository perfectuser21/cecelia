#!/usr/bin/env bash
# docker/build.sh — 本地构建 cecelia/runner:latest 镜像
#
# 用法：
#   bash docker/build.sh
#   bash docker/build.sh --no-cache
#
# 输出：本地镜像 cecelia/runner:latest

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKERFILE="$SCRIPT_DIR/cecelia-runner/Dockerfile"
IMAGE_TAG="${CECELIA_RUNNER_IMAGE:-cecelia/runner:latest}"

if ! command -v docker >/dev/null 2>&1; then
  echo "[build.sh] docker 未安装，无法构建镜像" >&2
  echo "[build.sh] 请先安装 Docker Desktop 或 colima" >&2
  exit 1
fi

if [[ ! -f "$DOCKERFILE" ]]; then
  echo "[build.sh] Dockerfile 不存在: $DOCKERFILE" >&2
  exit 1
fi

EXTRA_ARGS=""
if [[ "${1:-}" == "--no-cache" ]]; then
  EXTRA_ARGS="--no-cache"
fi

echo "[build.sh] 构建镜像 $IMAGE_TAG"
docker build \
  -f "$DOCKERFILE" \
  -t "$IMAGE_TAG" \
  $EXTRA_ARGS \
  "$SCRIPT_DIR/cecelia-runner"

echo "[build.sh] 完成: $IMAGE_TAG"
docker images "$IMAGE_TAG" --format 'table {{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.Size}}'
