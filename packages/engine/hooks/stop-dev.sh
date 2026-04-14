#!/usr/bin/env bash
# Stop Hook: Claude Code 协议适配器 v16.6.0
# 职责：找 .dev-lock → 调 devloop_check → exit 0/2
# 版本: v16.6.0 — dev-lock 自愈（dev-mode 存在但 lock 丢失时用 CLAUDE_SESSION_ID 重建）

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

# ============================================================================
# v16.6.0: dev-lock 自愈 — dev-mode 存在但 dev-lock 丢失时自动重建
# 条件: CLAUDE_SESSION_ID 非空 + dev-mode 首行是 'dev'
# 目的: 避免 dev-lock 文件意外丢失导致 Stop Hook 永久 block
# ============================================================================
if [[ -n "${CLAUDE_SESSION_ID:-}" ]]; then
    _heal_cur_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    if [[ -n "$_heal_cur_branch" ]]; then
        _heal_cur_tty="$(tty 2>/dev/null || echo 'not a tty')"
        _heal_now="$(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00 2>/dev/null || date +%Y-%m-%dT%H:%M:%S)"
        while IFS= read -r _heal_dir; do
            for _heal_dmf in "$_heal_dir"/.dev-mode.*; do
                [[ -f "$_heal_dmf" ]] || continue
                head -1 "$_heal_dmf" 2>/dev/null | grep -q "^dev$" || continue
                _heal_branch=$(grep "^branch:" "$_heal_dmf" 2>/dev/null | awk '{print $2}' || echo "")
                [[ -z "$_heal_branch" ]] && continue
                [[ "$_heal_branch" != "$_heal_cur_branch" ]] && continue
                _heal_lockf="$_heal_dir/.dev-lock.${_heal_branch}"
                if [[ ! -f "$_heal_lockf" ]]; then
                    cat > "$_heal_lockf" <<HEAL_EOF
dev
branch: ${_heal_branch}
session_id: ${CLAUDE_SESSION_ID}
tty: ${_heal_cur_tty}
recreated_at: ${_heal_now}
recovered: true
HEAL_EOF
                    echo "[Stop Hook] dev-lock 自愈重建（分支: ${_heal_branch}）" >&2
                fi
            done
        done < <(_collect_search_dirs "$PROJECT_ROOT")
    fi
fi

# v16.3.0: 清理主仓库残留的 .dev-lock/.dev-mode（迁移：这些文件应只存在于 worktree）
# 仅在有 worktree 存在时清理主仓库（无 worktree = 单仓库/测试环境，不清理）
_main_wt=""
_has_worktrees=false
while IFS= read -r _l; do
    if [[ "$_l" == "worktree "* ]]; then
        if [[ -z "$_main_wt" ]]; then
            _main_wt="${_l#worktree }"
        else
            _has_worktrees=true; break
        fi
    fi
done < <(git worktree list --porcelain 2>/dev/null)
if [[ "$_has_worktrees" == "true" && -n "$_main_wt" && -d "$_main_wt" ]]; then
    for _stale in "$_main_wt"/.dev-lock.* "$_main_wt"/.dev-mode.*; do
        [[ -f "$_stale" ]] && rm -f "$_stale" 2>/dev/null
    done
fi

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

# fail-closed：无 dev-lock 时扫描所有 worktree，发现未完成的 dev-mode 则阻止退出
# v16.4.0: 按 session_id 隔离 — 跨 session 的 orphan 只 warning，不 block 当前 session
# v16.5.0: worktree 消失时自动清理孤儿 dev-mode/dev-lock（不 block）
if [[ -z "$DEV_LOCK_FILE" ]]; then
    _orphan_branch=""
    _current_sid="${CLAUDE_SESSION_ID:-}"
    while IFS= read -r _dir; do
        for _dmf in "$_dir"/.dev-mode.*; do
            [[ -f "$_dmf" ]] || continue
            head -1 "$_dmf" 2>/dev/null | grep -q "^dev$" || continue
            grep -q "cleanup_done: true" "$_dmf" 2>/dev/null && continue
            grep -qE "^step_(2|3|4).*pending" "$_dmf" 2>/dev/null || continue
            _ob=$(grep "^branch:" "$_dmf" 2>/dev/null | awk '{print $2}' || echo "unknown")

            # v16.5.0: worktree 消失自动清理
            # 若该分支在 git worktree list 中已不存在 → 孤儿，自动清理
            _branch_has_worktree=false
            while IFS= read -r _wtl; do
                if [[ "$_wtl" == "branch refs/heads/${_ob}" ]]; then
                    _branch_has_worktree=true
                    break
                fi
            done < <(git -C "$PROJECT_ROOT" worktree list --porcelain 2>/dev/null)
            if [[ "$_branch_has_worktree" == "false" ]]; then
                echo "[Stop Hook] worktree gone, auto-cleanup orphan (branch=${_ob}): ${_dmf}" >&2
                rm -f "$_dmf" "$_dir/.dev-lock.${_ob}" 2>/dev/null || true
                continue
            fi

            # 读取对应 dev-lock 的 session_id（若存在）
            _lockf="$_dir/.dev-lock.${_ob}"
            _orphan_sid=""
            [[ -f "$_lockf" ]] && _orphan_sid=$(grep "^session_id:" "$_lockf" 2>/dev/null | awk '{print $2}' || echo "")

            # 跨 session 隔离：当前 session_id 已知 且 orphan session_id 已知 且不同 → 跳过
            if [[ -n "$_current_sid" && -n "$_orphan_sid" && "$_current_sid" != "$_orphan_sid" ]]; then
                echo "[Stop Hook] warning: cross-session orphan skipped (orphan_sid=${_orphan_sid}, current=${_current_sid}, branch=${_ob})" >&2
                continue
            fi
            _orphan_branch="$_ob"
            break 2
        done
    done < <(_collect_search_dirs "$PROJECT_ROOT")
    if [[ -n "$_orphan_branch" ]]; then
        jq -n --arg b "$_orphan_branch" \
            '{"decision":"block","reason":"dev-lock 丢失但发现未完成 session（分支: \($b)）。重新运行 /dev 重建 dev-lock，禁止退出。"}'
        exit 2
    fi
    exit 0
fi

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
# Harness 完成条件：step_2_code=done + pr_url 已创建（委托 devloop_check 0.5 通道判断）
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
