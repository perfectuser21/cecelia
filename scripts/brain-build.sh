#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# v1.2.0 (2026-05-05): build 用 origin/main 而不是 HEAD — 工具链对 cwd 分支彻底免疫。
# 旧版 v1.1.0 用 git archive HEAD：当主仓库 cwd 被切到 cp-* 分支（如另一个 session 在做
# 别的 PR），git archive HEAD 拿到的是该分支版本而不是最新 main，build 出来的 image
# 缺最新合并的修复。改用 git fetch origin main + git archive FETCH_HEAD：deploy 永远
# build origin/main 最新版，不管 cwd 在哪。
#
# 同步 v1.1.0 的脏工作树隔离（git archive 只导出 git 库版本，工作树脏改动 / untracked
# 文件全部忽略）。
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
RELEASE_SHA="${KERNEL_RELEASE_MERGE_SHA:-}"
if [[ -n "$RELEASE_SHA" ]]; then
  [[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] \
    || { echo "[FAIL] KERNEL_RELEASE_MERGE_SHA must be an exact SHA" >&2; exit 78; }
  git -C "$ROOT_DIR" cat-file -e "${RELEASE_SHA}^{commit}" \
    || { echo "[FAIL] exact ReleaseRun SHA is unavailable" >&2; exit 78; }
  BUILD_REF="$RELEASE_SHA"
  BUILD_SOURCE="ReleaseRun ${RELEASE_SHA}"
else
  BUILD_REF="origin/$DEPLOY_BRANCH"
  BUILD_SOURCE="origin/${DEPLOY_BRANCH}"
fi

# Read version from the immutable build ref — 不读 cwd 工作树
VERSION=$(git -C "$ROOT_DIR" show "$BUILD_REF:packages/brain/package.json" 2>/dev/null \
  | node -e "let s=''; process.stdin.on('data',c=>s+=c); process.stdin.on('end',()=>console.log(JSON.parse(s).version))" \
  || node -e "console.log(require('$ROOT_DIR/packages/brain/package.json').version)")

echo "=== Building cecelia-brain:${VERSION} (from ${BUILD_SOURCE}) ==="

TEMP_BUILD=$(mktemp -d -t cecelia-brain-build-XXXXXX)
# shellcheck disable=SC2064
trap "rm -rf '$TEMP_BUILD'" EXIT

# v1.2.0 compatibility: non-ReleaseRun builds still refresh origin/main.
if [[ -z "$RELEASE_SHA" ]]; then
  echo "  Fetch origin/${DEPLOY_BRANCH}..."
  git -C "$ROOT_DIR" fetch origin "$DEPLOY_BRANCH" 2>&1 | tail -3
  BUILD_REF="FETCH_HEAD"
fi

echo "  导出 ${BUILD_SOURCE} 到临时 build context: $TEMP_BUILD"
git -C "$ROOT_DIR" archive --format=tar "$BUILD_REF" | tar -x -C "$TEMP_BUILD"

# FR-01: 传 GIT_SHA build-arg（Gate3 SHA 对账）
# ReleaseRun uses its immutable SHA; compatibility builds use fetched main.
BUILD_SHA=$(git -C "$ROOT_DIR" rev-parse "$BUILD_REF" 2>/dev/null || echo "unknown")
echo "  GIT_SHA=${BUILD_SHA}"

# 从干净的 origin/main 快照构建
docker build \
  -t "cecelia-brain:${VERSION}" \
  -t "cecelia-brain:latest" \
  --build-arg "GIT_SHA=${BUILD_SHA}" \
  -f "$TEMP_BUILD/packages/brain/Dockerfile" \
  "$TEMP_BUILD"

echo ""
echo "=== Build complete ==="
echo "  cecelia-brain:${VERSION}"
echo "  cecelia-brain:latest"
echo "  Size: $(docker images "cecelia-brain:${VERSION}" --format '{{.Size}}')"

# Build 完成后清理 dangling 镜像，防止虚拟磁盘膨胀
echo ""
echo "=== 清理 dangling 镜像 ==="
docker image prune -f --filter "dangling=true" 2>/dev/null || true
