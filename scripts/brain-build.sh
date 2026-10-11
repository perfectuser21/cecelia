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

# Read version from origin/main brain/package.json — 不读 cwd 工作树
VERSION=$(git -C "$ROOT_DIR" show "origin/$DEPLOY_BRANCH:packages/brain/package.json" 2>/dev/null \
  | node -e "let s=''; process.stdin.on('data',c=>s+=c); process.stdin.on('end',()=>console.log(JSON.parse(s).version))" \
  || node -e "console.log(require('$ROOT_DIR/packages/brain/package.json').version)")

echo "=== Building cecelia-brain:${VERSION} (from origin/${DEPLOY_BRANCH}) ==="

TEMP_BUILD=$(mktemp -d -t cecelia-brain-build-XXXXXX)
# shellcheck disable=SC2064
trap "rm -rf '$TEMP_BUILD'" EXIT

# v1.2.0: fetch 最新 origin/main 后用 FETCH_HEAD 作 archive 源
echo "  Fetch origin/${DEPLOY_BRANCH}..."
git -C "$ROOT_DIR" fetch origin "$DEPLOY_BRANCH" 2>&1 | tail -3

echo "  导出 origin/${DEPLOY_BRANCH} (FETCH_HEAD) 到临时 build context: $TEMP_BUILD"
git -C "$ROOT_DIR" archive --format=tar FETCH_HEAD | tar -x -C "$TEMP_BUILD"

# FR-01: 传 GIT_SHA build-arg（Gate3 SHA 对账）
# 使用 FETCH_HEAD（origin/main 最新）作为构建期 SHA
BUILD_SHA=$(git -C "$ROOT_DIR" rev-parse FETCH_HEAD 2>/dev/null || git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo "unknown")
echo "  GIT_SHA=${BUILD_SHA}"

# v1.3.0 (2026-10-12, B4 / e2fc7076 / a80485b3): 同版本号不同 SHA 重建保护。
# auto-version bump 之前的合并提交与上一次 bump 提交版本号相同（09167e2 与 86b5389 同为 1.417.0），
# 无条件 -t cecelia-brain:${VERSION} -t latest 会把旧镜像的 tag 全部抢走：旧镜像一旦不再被容器引用就成了
# dangling，被下面的 prune 删掉（回滚目标丢失）；部署中途死亡时也只能人工把 tag 挪回去才能结算 recovered（a9add058）。
# 方案 A：检测到 cecelia-brain:${VERSION} 已指向 GIT_SHA 不同的镜像时，
#   - 旧镜像补 cecelia-brain:prev-${VERSION}-${oldsha12} 保活（janitor 认这个单 tag 形态，可照常按容量回收）；
#   - 新镜像额外打 cecelia-brain:${VERSION}-${sha12}，可按提交精确指认本次构建。
# 构建后收敛：被顶替的镜像身上的 ${VERSION}-${sha12} 别名摘掉，只留一个 tag——
# janitor 按镜像 id 删除，同仓库多 tag 时 docker 拒删（referenced in multiple repositories），多 tag 等于永久泄漏。
IMAGE_REPO="cecelia-brain"
image_id_of() {
  local id
  id=$(docker image inspect --format '{{.Id}}' "$1" 2>/dev/null) || return 0
  [[ "$id" =~ ^sha256:[a-f0-9]{64}$ ]] && echo "$id"
  return 0
}
image_git_sha_of() {
  { docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$1" 2>/dev/null || true; } \
    | sed -n 's/^GIT_SHA=//p' | head -1
}
OLD_ID=$(image_id_of "${IMAGE_REPO}:${VERSION}")
PRIOR_ID=$(image_id_of "${IMAGE_REPO}:latest")
EXTRA_TAG_ARGS=()
EXTRA_TAG=""
if [[ -n "$OLD_ID" ]]; then
  OLD_SHA=$(image_git_sha_of "$OLD_ID")
  if [[ "$OLD_SHA" != "$BUILD_SHA" ]]; then
    OLD_SHA12="${OLD_SHA:0:12}"
    [[ "$OLD_SHA12" =~ ^[a-f0-9]{12}$ ]] || OLD_SHA12=$(echo "${OLD_ID#sha256:}" | cut -c1-12)
    PREV_TAG="${IMAGE_REPO}:prev-${VERSION}-${OLD_SHA12}"
    EXTRA_TAG="${IMAGE_REPO}:${VERSION}-${BUILD_SHA:0:12}"
    echo "  同版本号不同 SHA 重建：${IMAGE_REPO}:${VERSION} 当前指向 ${OLD_ID}（GIT_SHA=${OLD_SHA:-unknown}）"
    echo "    旧镜像保活 tag: ${PREV_TAG}"
    echo "    新镜像额外 tag: ${EXTRA_TAG}"
    docker tag "$OLD_ID" "$PREV_TAG"
    EXTRA_TAG_ARGS=(-t "$EXTRA_TAG")
  fi
fi

# 从干净的 origin/main 快照构建
docker build \
  -t "${IMAGE_REPO}:${VERSION}" \
  -t "${IMAGE_REPO}:latest" \
  ${EXTRA_TAG_ARGS[@]+"${EXTRA_TAG_ARGS[@]}"} \
  --build-arg "GIT_SHA=${BUILD_SHA}" \
  -f "$TEMP_BUILD/packages/brain/Dockerfile" \
  "$TEMP_BUILD"

# 收敛：被顶替的镜像（旧版本 tag 持有者 / 旧 latest）只留一个 tag，摘掉 ${VERSION}-${sha12} 别名（至少还剩一个 tag 时才摘）
NEW_ID=$(image_id_of "${IMAGE_REPO}:${VERSION}")
for id in $(printf '%s\n' "$OLD_ID" "$PRIOR_ID" | sort -u); do
  [[ -n "$id" && "$id" != "$NEW_ID" ]] || continue
  aliases=(); others=0
  while IFS= read -r t; do
    [[ -n "$t" ]] || continue
    if [[ "$t" =~ ^${IMAGE_REPO}:[0-9]+\.[0-9]+\.[0-9]+-[A-Za-z0-9]+$ ]]; then aliases+=("$t"); else others=$((others + 1)); fi
  done < <(docker image inspect --format '{{range .RepoTags}}{{println .}}{{end}}' "$id" 2>/dev/null || true)
  if [[ $others -ge 1 ]]; then
    for t in ${aliases[@]+"${aliases[@]}"}; do
      echo "  摘掉被顶替镜像的别名 tag: $t"
      docker image rm "$t" >/dev/null || true
    done
  fi
done

echo ""
echo "=== Build complete ==="
echo "  ${IMAGE_REPO}:${VERSION}"
echo "  ${IMAGE_REPO}:latest"
[[ -n "$EXTRA_TAG" ]] && echo "  ${EXTRA_TAG}"
[[ -n "${PREV_TAG:-}" ]] && echo "  (旧镜像保活) ${PREV_TAG}"
echo "  Size: $(docker images "cecelia-brain:${VERSION}" --format '{{.Size}}')"

# Build 完成后清理 dangling 镜像，防止虚拟磁盘膨胀
echo ""
echo "=== 清理 dangling 镜像 ==="
docker image prune -f --filter "dangling=true" 2>/dev/null || true
