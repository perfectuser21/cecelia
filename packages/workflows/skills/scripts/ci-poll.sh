#!/usr/bin/env bash
# ci-poll.sh — CI 状态轮询（单一 SSOT），供多个 skill 复用
# 用法：scripts/ci-poll.sh <PR_NUMBER> <REPO>
#   REPO 格式：owner/repo（如 perfectuser21/zenithjoy-skills）
# 退出码：
#   0  = CI 全绿（pending=0，fail=0，非 BEHIND）
#   10 = 有失败的 check
#   11 = 分支落后 main（BEHIND）
# 职责：只报状态，不做决定，不做 merge/rebase/fix。

set -euo pipefail

PR_NUMBER="${1:?需要 PR 号}"
REPO="${2:?需要 repo（格式：owner/repo）}"

while true; do
  CHECKS=$(gh pr checks "$PR_NUMBER" --repo "$REPO" 2>/dev/null || true)
  FAILED=$(echo "$CHECKS" | grep -c "fail" || true)
  PENDING=$(echo "$CHECKS" | grep -cE "pending|in_progress|queued" || true)
  MERGE_STATE=$(gh pr view "$PR_NUMBER" --repo "$REPO" \
    --json mergeStateStatus --jq '.mergeStateStatus' 2>/dev/null || true)

  if [ "${FAILED:-0}" -gt 0 ]; then
    echo "CI_FAILED: $FAILED 个失败 check" >&2
    exit 10
  fi

  if [ "$MERGE_STATE" = "BEHIND" ]; then
    echo "BEHIND: 分支落后 main" >&2
    exit 11
  fi

  if [ "${PENDING:-1}" -eq 0 ]; then
    echo "CI_GREEN" >&2
    exit 0
  fi

  echo "$(TZ=Asia/Shanghai date '+%H:%M:%S') CI polling | pending=$PENDING fail=$FAILED | $MERGE_STATE" >&2
  sleep 30
done
