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
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
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

if ! command -v git >/dev/null 2>&1 || ! command -v shasum >/dev/null 2>&1; then
  echo "[build.sh] git/shasum 不可用，无法绑定 Runner 源码" >&2
  exit 1
fi

runner_status="$(
  git -C "$REPO_ROOT" status --porcelain --untracked-files=all \
    -- docker/cecelia-runner
)"
if [[ -n "$runner_status" ]]; then
  echo "[build.sh] Runner 源码未提交或不干净，拒绝构建" >&2
  exit 1
fi
runner_revision="$(
  git -C "$REPO_ROOT" log -1 --format=%H HEAD -- docker/cecelia-runner
)"
runner_source_sha256="$(
  git -C "$REPO_ROOT" ls-tree -r --full-tree "$runner_revision" \
    -- docker/cecelia-runner \
    | shasum -a 256 \
    | awk '{print $1}'
)"
if [[ ! "$runner_revision" =~ ^[0-9a-f]{40}$ \
  || ! "$runner_source_sha256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "[build.sh] Runner 源码元数据无效" >&2
  exit 1
fi

EXTRA_ARGS=()
if [[ "${1:-}" == "--no-cache" ]]; then
  EXTRA_ARGS+=(--no-cache)
fi

echo "[build.sh] 构建镜像 $IMAGE_TAG"
docker build \
  -f "$DOCKERFILE" \
  -t "$IMAGE_TAG" \
  --build-arg "CECELIA_RUNNER_REVISION=$runner_revision" \
  --build-arg "CECELIA_RUNNER_SOURCE_SHA256=$runner_source_sha256" \
  "${EXTRA_ARGS[@]}" \
  "$SCRIPT_DIR/cecelia-runner"

observed_revision="$(
  docker image inspect --format \
    '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
    "$IMAGE_TAG"
)"
observed_source_sha256="$(
  docker image inspect --format \
    '{{ index .Config.Labels "com.perfect21.cecelia.runner.source-sha256" }}' \
    "$IMAGE_TAG"
)"
if [[ "$observed_revision" != "$runner_revision" \
  || "$observed_source_sha256" != "$runner_source_sha256" ]]; then
  echo "[build.sh] Runner 镜像源码标签校验失败" >&2
  exit 1
fi

echo "[build.sh] 完成: $IMAGE_TAG"
docker images "$IMAGE_TAG" --format 'table {{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.Size}}'
docker image inspect --format '{{.Id}}' "$IMAGE_TAG"
