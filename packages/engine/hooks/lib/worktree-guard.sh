#!/usr/bin/env bash
# ============================================================================
# worktree-guard.sh — Stop Hook 孤儿 worktree 清理 Guard A 三层判定逻辑
# ============================================================================
# 从 stop.sh 抽取的共享逻辑，供 stop.sh 本体和
# packages/engine/hooks/tests/stop-worktree-guard.manual-test.sh 共用，
# 避免手抄副本与真实逻辑不同步（2026-07-10 审查发现问题 2 的修复）。
#
# 用法：
#   source "packages/engine/hooks/lib/worktree-guard.sh"
#   if _reason=$(stop_hook_should_skip_worktree "$wt_path"); then
#       # 跳过：$_reason 是 "active-lock" 或 "dirty"
#   else
#       # 可以继续检查 PR 是否已 merged
#   fi
#
# 返回值：0 = 应该跳过（不清理该 worktree），并把跳过原因（active-lock / dirty）打到 stdout
#         1 = 可以继续检查 PR，无 stdout 输出
# 副作用：命中"未提交改动"分支时会额外向 stderr 打印一条 [Stop Hook] 提示
# ============================================================================

stop_hook_should_skip_worktree() {
    local _wt_path="$1"

    # 第一层：活跃锁检查 —— .dev-lock.<branch>（按分支后缀命名，从不写裸 .dev-lock）
    #   / .dev-mode.*（同样按分支后缀命名）
    # 用通配匹配而非裸文件名，两者写法保持一致
    if ls "$_wt_path"/.dev-lock* >/dev/null 2>&1 || ls "$_wt_path"/.dev-mode.* >/dev/null 2>&1; then
        echo "active-lock"
        return 0
    fi

    # 第二层：未提交改动检查 —— 非空则跳过，不强制删活跃工作
    if [[ -n "$(git -C "$_wt_path" status --porcelain 2>/dev/null)" ]]; then
        echo "[Stop Hook] 跳过（有未提交改动）: $_wt_path" >&2
        echo "dirty"
        return 0
    fi

    # 两层都没命中 → 可以继续检查该 worktree 对应的 PR 是否已 merged
    return 1
}

# ============================================================================
# stop_hook_remove_merged_worktree — 真正删除已合并 PR 的孤儿 worktree
# ============================================================================
# 用法：
#   if stop_hook_remove_merged_worktree "$wt_path" "$wt_branch"; then
#       # 删除成功，已打印"已清理"日志
#   else
#       # 删除失败，已打印"remove 失败（已忽略）"日志，调用方按需 || true 吞掉
#   fi
#
# 背景（2026-09-28 修复）：git worktree remove --force（单个 --force）对
# git-level locked 的 worktree 必然失败（git 要求 --force --force 或先
# unlock，见 git-worktree(1)）。旧实现删除失败后仍无条件打印"已清理"成功
# 日志，导致 locked 的孤儿 worktree（如 impact-contract-fix）永远清不掉，
# 且每次 Stop 事件都误报清理成功。
# ============================================================================
stop_hook_remove_merged_worktree() {
    local _wt_path="$1"
    local _wt_branch="$2"

    # unlock 对非 locked 的 worktree 本就会失败，属正常路径，忽略即可
    git worktree unlock "$_wt_path" >/dev/null 2>&1 || true

    if git worktree remove --force --force "$_wt_path" 2>/dev/null; then
        echo "[Stop Hook] 已清理已合并 PR 孤儿 worktree: $_wt_branch" >&2
        return 0
    else
        echo "[Stop Hook] worktree remove 失败（已忽略）: $_wt_path" >&2
        return 1
    fi
}
