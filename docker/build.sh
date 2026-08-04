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

# 构建来源 label：记录 git HEAD 与 entrypoint.sh 的 sha256，供 verify_runner_label 校验
BUILD_HEAD="$(git -C "$SCRIPT_DIR/.." rev-parse HEAD 2>/dev/null || echo "unknown")"
if command -v sha256sum >/dev/null 2>&1; then
  ENTRYPOINT_SHA256="$(sha256sum "$SCRIPT_DIR/cecelia-runner/entrypoint.sh" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  ENTRYPOINT_SHA256="$(shasum -a 256 "$SCRIPT_DIR/cecelia-runner/entrypoint.sh" | awk '{print $1}')"
else
  echo "[build.sh] 警告: sha256 工具不可用，跳过 entrypoint label" >&2
  ENTRYPOINT_SHA256="unknown"
fi

echo "[build.sh] 构建镜像 $IMAGE_TAG"
docker build \
  -f "$DOCKERFILE" \
  -t "$IMAGE_TAG" \
  --label "cecelia.build.head=$BUILD_HEAD" \
  --label "cecelia.entrypoint.sha256=$ENTRYPOINT_SHA256" \
  $EXTRA_ARGS \
  "$SCRIPT_DIR/cecelia-runner"

echo "[build.sh] 完成: $IMAGE_TAG"
docker images "$IMAGE_TAG" --format 'table {{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.Size}}'
