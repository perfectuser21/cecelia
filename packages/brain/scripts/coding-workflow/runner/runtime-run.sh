#!/usr/bin/env bash
# 启动器持锁后执行；保留原仓库补齐与凭据加载顺序。
set -uo pipefail
REPO="${CODING_WF_REPO:-$HOME/perfect21/cecelia-cw-runner}"
NODE_BIN="${CODING_WF_NODE:-node}"
RUN_ONCE_REL="packages/brain/scripts/coding-workflow/runner/run-once.mjs"
CLONES_REL="packages/brain/scripts/coding-workflow/runner/list-clones.mjs"
log() { echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] [coding-workflow-runner.sh] $*" >&2; }
# 其他已启用仓库：只补缺的 clone（失败只记日志，run-once 会跳过 clone 不存在的仓库，不影响默认仓）
if [ -f "$REPO/$CLONES_REL" ]; then
  CLONE_LIST="$("$NODE_BIN" "$REPO/$CLONES_REL")" || log "列仓库 clone 失败（repos.json 不可读？），本轮不补 clone"
  while IFS=$'\t' read -r EXTRA_CLONE EXTRA_ORIGIN; do
    [ -n "$EXTRA_CLONE" ] || continue
    [ -e "$EXTRA_CLONE/.git" ] && continue
    if [ -e "$EXTRA_CLONE" ] && [ -n "$(ls -A "$EXTRA_CLONE" 2>/dev/null)" ]; then
      log "仓库目录 $EXTRA_CLONE 已存在但不是 git clone，不覆盖"
      continue
    fi
    log "仓库 clone 不存在，从 $EXTRA_ORIGIN clone 到 $EXTRA_CLONE"
    mkdir -p "$(dirname "$EXTRA_CLONE")"
    git clone -q "$EXTRA_ORIGIN" "$EXTRA_CLONE" || log "clone $EXTRA_CLONE 失败（本轮跳过该仓库）"
  done <<< "${CLONE_LIST:-}"
fi

cd "$REPO" || exit 1
# QA 门请求/停止 PR 预览环境要 DEPLOY_TOKEN：运行时从凭据文件读（不进代码、不进 plist）
TOKEN_FILE="${CODING_WF_DEPLOY_TOKEN_FILE:-$HOME/.credentials/cecelia-deploy-token.env}"
if [ -z "${DEPLOY_TOKEN:-}" ] && [ -f "$TOKEN_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$TOKEN_FILE"
  set +a
fi

# 上报执行记录（POST /api/brain/spans）要 Brain 内部令牌：同样运行时从凭据文件读，只取这一项（不把整份文件导进环境）
INTERNAL_TOKEN_FILE="${CODING_WF_INTERNAL_TOKEN_FILE:-$HOME/.credentials/cecelia-internal.env}"
if [ -z "${CECELIA_INTERNAL_TOKEN:-}" ] && [ -f "$INTERNAL_TOKEN_FILE" ]; then
  CECELIA_INTERNAL_TOKEN="$(sed -n 's/^CECELIA_INTERNAL_TOKEN=//p' "$INTERNAL_TOKEN_FILE" | head -1 | tr -d "\"' \r")"
  export CECELIA_INTERNAL_TOKEN
fi

exec "$NODE_BIN" "$REPO/$RUN_ONCE_REL"
