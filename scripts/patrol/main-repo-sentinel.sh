#!/usr/bin/env bash
# =============================================================================
# main-repo-sentinel.sh — 主仓状态哨兵(守卫补链刀 件③,2026-07-19)
# 病史:主仓 ~/perfect21/cecelia 被容器/会话霸在私分支(第 N 次复发),
#      cron 全家(照相层/janitor)都在主仓跑,主仓歪=全歪且静默。
# 规矩:主仓必须 main + 工作区净。
#   - main+净 → 无输出退出(不刷日志)
#   - 被霸分支且该分支已有 merged PR → stash 残留 + 自动救回 main(RESCUED)
#   - 被霸分支且未合并 → 不敢动,告警(ALERT,exit 1)
#   - main 但脏 → 只警不动(可能是进行中的手工操作)
# cron 安装(SSOT):
#   */30 * * * * bash /Users/administrator/perfect21/cecelia/scripts/patrol/main-repo-sentinel.sh >> /tmp/main-repo-sentinel.log 2>&1
# 测试注入:SENTINEL_REPO_DIR / SENTINEL_GH_CMD / SENTINEL_NOTIFY_CMD
# =============================================================================
set -uo pipefail

REPO_DIR="${SENTINEL_REPO_DIR:-/Users/administrator/perfect21/cecelia}"
GH_CMD="${SENTINEL_GH_CMD:-gh}"
NOTIFY_CMD="${SENTINEL_NOTIFY_CMD:-}"

cd "$REPO_DIR" || { echo "ALERT: 主仓目录不可达 $REPO_DIR"; exit 1; }

BRANCH=$(git branch --show-current 2>/dev/null || echo "")
DIRTY=$(git status --porcelain 2>/dev/null | head -1)

if [ "$BRANCH" = "main" ] && [ -z "$DIRTY" ]; then
  exit 0
fi

notify() {
  if [ -n "$NOTIFY_CMD" ]; then $NOTIFY_CMD "$1" || true; else
    curl -s -m 5 -X POST localhost:5221/api/brain/harness/notify \
      -H 'Content-Type: application/json' \
      -d "{\"title\":\"主仓哨兵\",\"message\":\"$1\"}" >/dev/null 2>&1 || true
  fi
}

if [ "$BRANCH" != "main" ] && [ -n "$BRANCH" ]; then
  MERGED=$($GH_CMD pr list --head "$BRANCH" --state merged --json number --jq 'length' 2>/dev/null || echo "0")
  if [ "${MERGED:-0}" -ge 1 ]; then
    git stash push -u -m "sentinel-rescue-$(date +%s)" >/dev/null 2>&1 || true
    if git switch main >/dev/null 2>&1 && git pull --ff-only origin main >/dev/null 2>&1; then
      echo "RESCUED: 主仓从已合并分支 $BRANCH 救回 main $(date '+%F %T')"
      notify "主仓被已合并分支 $BRANCH 占用,已自动救回 main(残留已 stash)"
      exit 0
    fi
    echo "ALERT: 救回 main 失败(分支 $BRANCH)"
    notify "主仓救回 main 失败(分支 $BRANCH),需人工"
    exit 1
  fi
  echo "ALERT: 主仓被未合并分支 $BRANCH 占用,不敢自动动"
  notify "主仓被未合并分支 $BRANCH 占用,请人工处理(cron 全家在主仓跑,会全歪)"
  exit 1
fi

echo "WARN: 主仓 main 工作区不净:"
git status --porcelain | head -5
exit 0
