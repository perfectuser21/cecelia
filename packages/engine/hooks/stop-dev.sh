#!/usr/bin/env bash
# Stop Hook: Claude Code 协议适配器 v16.2.0
# 职责：找 .dev-lock → 调 devloop_check → exit 0/2
# 版本: v16.2.0 — Bug fix: harness 模式跳过 cleanup_done 残留文件早退（与 devloop-check v4.2.0 同步）

set -euo pipefail

# 收集主仓库 + 所有 worktree 路径（主仓库优先）
_collect_search_dirs() {
    local root="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
    local _main=""
    while IFS= read -r _l; do
        [[ "$_l" == "worktree "* ]] && { _main="${_l#worktree }"; break; }
    done < <(git -C "$root" worktree list --porcelain 2>/dev/null)
    [[ -n "$_main" && -d "$_main" ]] && echo "$_main" || echo "$root"
    while IFS= read -r _l; do
        if [[ "$_l" == "worktree "* ]]; then
            local _p="${_l#worktree }"
            [[ "$_p" != "${_main:-$root}" && -d "$_p" ]] && echo "$_p"
        fi
    done < <(git -C "$root" worktree list --porcelain 2>/dev/null)
}

# 判断 .dev-lock 是否属于当前会话（TTY / session_id / branch 匹配）
_session_matches() {
    local lock_tty="$1" lock_session="$2" lock_branch="$3"
    local cur_tty cur_session cur_branch
    cur_tty=$(tty 2>/dev/null || echo ""); cur_session="${CLAUDE_SESSION_ID:-}"
    cur_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    if [[ "$lock_tty" == /dev/* && "$cur_tty" == /dev/* && "$lock_tty" == "$cur_tty" ]]; then
        return 0
    elif [[ -n "$lock_session" && -n "$cur_session" && "$lock_session" == "$cur_session" ]]; then
        return 0
    elif [[ ("$lock_tty" == "not a tty" || -z "$lock_tty") ]] || \
         { [[ -z "$cur_tty" || "$cur_tty" == "not a tty" ]] && [[ -z "$cur_session" ]]; }; then
        [[ -n "$lock_branch" && "$lock_branch" == "$cur_branch" ]] && return 0
    fi
    return 1
}

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# 加载 devloop-check.sh（SSOT）
DEVLOOP_CHECK_LIB=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for _c in \
    "$PROJECT_ROOT/packages/engine/lib/devloop-check.sh" \
    "$PROJECT_ROOT/lib/devloop-check.sh" \
    "$SCRIPT_DIR/../lib/devloop-check.sh" \
    "$HOME/.claude/lib/devloop-check.sh"; do
    [[ -f "$_c" ]] && { DEVLOOP_CHECK_LIB="$_c"; break; }
done
# shellcheck disable=SC1090
[[ -n "$DEVLOOP_CHECK_LIB" ]] && source "$DEVLOOP_CHECK_LIB"
if ! command -v jq &>/dev/null; then
    jq() { cat >/dev/null 2>&1; echo '{}'; }
fi

# 扫描所有 worktree 找匹配的 .dev-lock
DEV_LOCK_FILE=""
DEV_MODE_FILE=""
MATCHED_DIR=""
while IFS= read -r _dir; do
    for _lf in "$_dir"/.dev-lock.*; do
        [[ -f "$_lf" ]] || continue
        _lt=$(grep "^tty:" "$_lf" 2>/dev/null | cut -d' ' -f2- | xargs 2>/dev/null || echo "")
        _ls=$(grep "^session_id:" "$_lf" 2>/dev/null | cut -d' ' -f2 | xargs 2>/dev/null || echo "")
        _lb=$(grep "^branch:" "$_lf" 2>/dev/null | cut -d' ' -f2 | xargs 2>/dev/null || echo "")
        if _session_matches "$_lt" "$_ls" "$_lb" && [[ -n "$_lb" ]]; then
            DEV_LOCK_FILE="$_lf"; MATCHED_DIR="$_dir"
            DEV_MODE_FILE="$_dir/.dev-mode.${_lb}"; break 2
        fi
    done
done < <(_collect_search_dirs "$PROJECT_ROOT")

[[ -z "$DEV_LOCK_FILE" ]] && exit 0

# 并发锁（per-worktree）
_git_dir="$(git -C "$MATCHED_DIR" rev-parse --git-dir 2>/dev/null || echo "/tmp")"
[[ ! -d "$_git_dir" ]] && _git_dir="/tmp"
if command -v flock &>/dev/null; then
    exec 201>"$_git_dir/cecelia-stop.lock"
    flock -w 2 201 || { jq -n '{"decision":"block","reason":"并发锁获取失败，等待重试"}'; exit 2; }
else
    # macOS fallback: mkdir 原子锁（mkdir 是 POSIX 原子操作）
    _lock_dir="$_git_dir/cecelia-stop.lockdir"
    _lock_try=0
    until mkdir "$_lock_dir" 2>/dev/null; do
        _lock_try=$((_lock_try + 1))
        [[ $_lock_try -ge 20 ]] && { jq -n '{"decision":"block","reason":"并发锁获取超时（macOS mkdir），等待重试"}'; exit 2; }
        sleep 0.1
    done
    trap 'rmdir "$_lock_dir" 2>/dev/null' EXIT INT TERM
fi

# .dev-mode 不存在 → 状态丢失，无上限阻止退出（fail-closed）
if [[ ! -f "$DEV_MODE_FILE" ]]; then
    jq -n '{"decision":"block","reason":".dev-lock 存在但 .dev-mode 缺失，请重建 .dev-mode 文件（第一行必须是 dev）"}'
    exit 2
fi

# cleanup_done → 工作流结束（harness 模式跳过，由 devloop_check 0.5 通道处理）
# Bug fix v16.2.0: 残留 .dev-mode 含 cleanup_done: true 时，harness 新会话不能早退
HARNESS_MODE_IN_FILE=$(grep "^harness_mode:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "false")
if [[ "$HARNESS_MODE_IN_FILE" != "true" ]] && grep -q "cleanup_done: true" "$DEV_MODE_FILE" 2>/dev/null; then
    rm -f "$DEV_MODE_FILE" "$DEV_LOCK_FILE"
    jq -n '{"decision":"allow","reason":"PR 已合并且 Stage 4 完成，工作流结束"}'
    # harness guard: HARNESS_MODE_IN_FILE != "true" checked above, harness sessions skip this path
    exit 0
fi

# .dev-mode 首行校验
DEV_MODE_FIRST=$(head -1 "$DEV_MODE_FILE" 2>/dev/null || echo "")
if [[ "$DEV_MODE_FIRST" != "dev" ]]; then
    jq -n --arg m "$DEV_MODE_FIRST" '{"decision":"block","reason":"dev-mode 首行损坏（期望 dev，实际 \($m)）"}'
    exit 2
fi

# 会话隔离由 .dev-lock 扫描阶段的 _session_matches 已完成（L63-73）
# BRANCH_NAME 直接从 .dev-lock 的 branch 字段（_lb）获取，不依赖 .dev-mode
BRANCH_NAME="${_lb:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")}"

# Harness 模式标识
HARNESS_MODE_FLAG=$(grep "^harness_mode:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "false")
if [[ "$HARNESS_MODE_FLAG" == "true" ]]; then
    echo "  [Stop Hook] /dev harness 模式 — 分支: $BRANCH_NAME（只检查代码完成+PR创建）" >&2
else
    echo "  [Stop Hook] /dev 完成条件检查 — 分支: $BRANCH_NAME" >&2
fi

# 调用 devloop_check（SSOT）
if [[ -n "$DEVLOOP_CHECK_LIB" ]] && type devloop_check &>/dev/null; then
    RESULT=""
    RESULT=$(devloop_check "$BRANCH_NAME" "$DEV_MODE_FILE") || true
    STATUS=$(echo "$RESULT" | jq -r '.status // "blocked"' 2>/dev/null || echo "blocked")

    if [[ "$STATUS" == "done" || "$STATUS" == "merged" ]]; then
        rm -f "$DEV_MODE_FILE" "$DEV_LOCK_FILE"
        jq -n '{"decision":"allow","reason":"PR 已合并且 Stage 4 完成，工作流结束"}'
        exit 0
    fi

    REASON=$(echo "$RESULT" | jq -r '.reason // "未知原因"' 2>/dev/null || echo "未知原因")
    ACTION=$(echo "$RESULT" | jq -r '.action // ""' 2>/dev/null || echo "")
    RUN_ID=$(echo "$RESULT" | jq -r '.ci_run_id // ""' 2>/dev/null || echo "")
    [[ -n "$ACTION" ]] && REASON="${REASON}。下一步：${ACTION}。⚠️ 立即执行，禁止询问用户。"
    echo "  原因: $REASON" >&2
    jq -n --arg r "$REASON" --arg id "${RUN_ID:-}" '{"decision":"block","reason":$r,"ci_run_id":$id}'
    exit 2
else
    jq -n '{"decision":"block","reason":"devloop-check.sh 未加载，fail-closed 拒绝降级执行"}'
    exit 2
fi
