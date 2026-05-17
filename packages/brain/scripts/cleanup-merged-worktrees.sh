#!/usr/bin/env bash
# Cleanup merged orphan worktrees —— R4 孤儿 worktree 自动清理
# 扫描白名单路径下的 worktree，若其 branch 对应的 PR 已 merged 超过 grace period
# 且无 uncommitted / unpushed / human_hold 等风险，则安全清理 worktree + 本地 branch。
#
# 白名单：
#   - /Users/administrator/perfect21/cecelia/.claude/worktrees/agent-*
#   - /Users/administrator/worktrees/cecelia/*
#
# 安全守卫（Guard A~E）：任一条失败即 skip
#   A. 无 uncommitted changes
#   B. 无 unpushed commits（origin/<branch>..HEAD = 0）
#   C. PR merged_at > grace period 前（默认 1h）
#   D. branch 不是 main/master/develop
#   E. dev-mode 文件里无 human_hold: true
#
# 环境变量：
#   REPO          主仓库路径（默认 /Users/administrator/perfect21/cecelia）
#   DRY_RUN       1 = 只打印动作不执行（默认 0）
#   GRACE_SECONDS merged_at 保护期秒数（默认 3600）

set -uo pipefail

REPO="${REPO:-/Users/administrator/perfect21/cecelia}"
DRY_RUN="${DRY_RUN:-0}"
GRACE_SECONDS="${GRACE_SECONDS:-3600}"

# 引入 cleanup-lock helper — 跟 zombie-cleaner / zombie-sweep / startup-recovery 互斥
# 防止并发删 worktree 撕坏 .git/worktrees 元数据（root cause of "worktree 神秘消失"）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=cleanup-lock.sh
source "$SCRIPT_DIR/cleanup-lock.sh"

WHITELIST_GLOBS=(
  "$REPO/.claude/worktrees/agent-*"
  "/Users/administrator/worktrees/cecelia/*"
)

log() { echo "[cleanup-worker] $*"; }

cleanup_one() {
  local wt="$1"
  [[ -d "$wt" ]] || { log "[skip] $wt: not a dir"; return 0; }
  [[ "$wt" == "$REPO" ]] && { log "[skip] $wt: is main repo"; return 0; }

  local branch
  branch=$(git -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

  # Guard D: 主干 branch 永不动（也处理 branch 读取失败的场景）
  case "$branch" in
    main|master|develop|"")
      log "[skip] $wt: protected or empty branch (branch=$branch)"
      return 0
      ;;
  esac

  # 查 PR 状态
  local pr_json pr_state merged_at pr_num
  pr_json=$(gh pr list --head "$branch" --state all --json state,mergedAt,number -q '.[0]' 2>/dev/null || echo "")
  pr_state=$(echo "$pr_json" | jq -r '.state // ""' 2>/dev/null || echo "")
  merged_at=$(echo "$pr_json" | jq -r '.mergedAt // ""' 2>/dev/null || echo "")
  pr_num=$(echo "$pr_json" | jq -r '.number // ""' 2>/dev/null || echo "")

  if [[ "$pr_state" != "MERGED" ]]; then
    log "[skip] $wt ($branch): PR state=${pr_state:-unknown}, not merged"
    return 0
  fi

  # Guard C: merged_at 必须 > GRACE_SECONDS 前（避免竞态）
  local merged_epoch now_epoch diff_sec
  # macOS BSD date 解析 ISO8601 Z
  merged_epoch=$(date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$merged_at" +%s 2>/dev/null || echo 0)
  if [[ "$merged_epoch" == "0" ]]; then
    # 兼容带 .000Z 的 fractional，截断到秒
    merged_epoch=$(date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$(echo "$merged_at" | sed 's/\.[0-9]*Z/Z/')" +%s 2>/dev/null || echo 0)
  fi
  now_epoch=$(date -u +%s)
  diff_sec=$(( now_epoch - merged_epoch ))
  if [[ "$merged_epoch" -eq 0 ]]; then
    log "[skip] $wt ($branch): cannot parse merged_at=$merged_at"
    return 0
  fi
  if [[ "$diff_sec" -lt "$GRACE_SECONDS" ]]; then
    log "[skip] $wt ($branch): merged ${diff_sec}s ago, within grace period (${GRACE_SECONDS}s)"
    return 0
  fi

  # Guard A: 无 uncommitted changes
  if [[ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ]]; then
    log "[skip] $wt ($branch): has uncommitted changes"
    return 0
  fi

  # Guard B: 无 unpushed commits
  local ahead
  ahead=$(git -C "$wt" rev-list "origin/$branch..HEAD" --count 2>/dev/null || echo 0)
  if [[ "$ahead" -gt 0 ]]; then
    log "[skip] $wt ($branch): $ahead unpushed commits"
    return 0
  fi

  # Guard E: dev-mode 里有 human_hold 不清（覆盖 .dev-mode / .dev-mode.* / .dev-mode.*.lock）
  local dm
  shopt -s nullglob
  for dm in "$wt"/.dev-mode "$wt"/.dev-mode.*; do
    [[ -f "$dm" ]] || continue
    if grep -q "^human_hold: true" "$dm" 2>/dev/null; then
      shopt -u nullglob
      log "[skip] $wt ($branch): human_hold=true in $(basename "$dm")"
      return 0
    fi
  done
  shopt -u nullglob

  # 所有 guard 通过 → 清理
  if [[ "$DRY_RUN" == "1" ]]; then
    log "[would-cleanup] $wt (branch=$branch, PR #$pr_num, merged ${diff_sec}s ago)"
    return 0
  fi

  log "[cleanup] removing $wt (branch=$branch, PR #$pr_num merged ${diff_sec}s ago)"

  # 持锁删 — 与 Brain 内的 zombie-cleaner / zombie-sweep / startup-recovery 互斥
  if ! acquire_cleanup_lock; then
    log "[cleanup] skip $wt — cleanup-lock contention（will retry next round）"
    return 0
  fi
  # subshell 限定 trap 范围
  (
    trap 'release_cleanup_lock' EXIT
    git -C "$REPO" worktree unlock "$wt" 2>/dev/null || true
    if ! git -C "$REPO" worktree remove --force "$wt" 2>/dev/null; then
      rm -rf "$wt"
      git -C "$REPO" worktree prune 2>/dev/null || true
    fi
  )
  git -C "$REPO" branch -D "$branch" 2>/dev/null || true
  log "[cleanup] removed $wt (branch=$branch, PR #$pr_num merged)"
}

log "starting (REPO=$REPO DRY_RUN=$DRY_RUN GRACE_SECONDS=$GRACE_SECONDS)"

# 主循环：展开白名单 glob（nullglob 容忍无匹配）
for pattern in "${WHITELIST_GLOBS[@]}"; do
  shopt -s nullglob
  # shellcheck disable=SC2206
  matches=( $pattern )
  shopt -u nullglob
  # Phase 7.3: bash 3.2 set -u compat — nullglob 无匹配时 matches 为空数组，
  # "${matches[@]}" 直接展开会触发 unbound variable
  for wt in "${matches[@]+${matches[@]}}"; do
    cleanup_one "$wt"
  done
done

log "done"
