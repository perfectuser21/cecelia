#!/usr/bin/env bash
# ============================================================================
# devloop-check.sh — Provider-Agnostic Dev Loop 完成判断
# ============================================================================
# 这是 /dev 工作流完成判断逻辑的 **唯一真实来源（SSOT）**。
#
# 所有 Provider 适配器（stop-dev.sh / runners/codex/runner.sh / 未来 Provider）
# 都必须 source 此文件，通过 devloop_check() 获取当前状态，
# 然后各自输出符合自己 Provider 协议的响应。
#
# 适配器永远不改，只改这一个文件。
#
# 版本: v1.0.0
# 创建: 2026-03-13
# PR: provider-agnostic-engine
# ============================================================================
#
# 公开函数:
#   devloop_check BRANCH DEV_MODE_FILE
#     输出 JSON 到 stdout:
#       {"status":"done"}                         → 全部完成，可以结束
#       {"status":"blocked","reason":"...","action":"..."}  → 未完成，需要继续
#     返回值: 0=done, 2=blocked
#
# 使用示例（Claude Code stop hook）:
#   source lib/devloop-check.sh
#   result=$(devloop_check "$BRANCH" "$DEV_MODE_FILE")
#   status=$(echo "$result" | jq -r '.status')
#   if [[ "$status" == "done" ]]; then exit 0; fi
#   reason=$(echo "$result" | jq -r '.reason')
#   jq -n --arg r "$reason" '{"decision":"block","reason":$r}'; exit 2
#
# 使用示例（Codex runner）:
#   source lib/devloop-check.sh
#   while true; do
#     result=$(devloop_check "$BRANCH" "$DEV_MODE_FILE")
#     status=$(echo "$result" | jq -r '.status')
#     [[ "$status" == "done" ]] && break
#     action=$(echo "$result" | jq -r '.action')
#     codex-bin exec "$action"
#   done
# ============================================================================

# jq 缺失时的极简 shim（防止 set -e 崩溃）
_devloop_jq() {
    if command -v jq &>/dev/null; then
        jq "$@"
    else
        # 极简 shim：只支持 jq -n --arg k v '...'
        cat >/dev/null 2>&1
        echo '{}'
    fi
}

# ============================================================================
# 内部函数: _mark_cleanup_done
# ============================================================================
# 向 dev_mode_file 写入 cleanup_done: true，触发唯一的终止路径。
# 调用方：cleanup.sh（直接写文件）和 devloop_check（step_11_cleanup: done 时调用）
#
# 参数:
#   $1: dev_mode_file — .dev-mode.<branch> 文件路径
# ============================================================================
_mark_cleanup_done() {
    local dev_mode_file="${1:-}"
    [[ -z "$dev_mode_file" || ! -f "$dev_mode_file" ]] && return 0

    # 原子写入（使用 flock 防止并发冲突，不可用时 fallback）
    {
        flock -x 203
        grep -v "^cleanup_done:" "$dev_mode_file" > "$dev_mode_file.cleanup.tmp" 2>/dev/null || true
        echo "cleanup_done: true" >> "$dev_mode_file.cleanup.tmp"
        mv "$dev_mode_file.cleanup.tmp" "$dev_mode_file"
    } 203>"$dev_mode_file.cleanup.lock" 2>/dev/null || {
        if [[ "$(uname)" == "Darwin" ]]; then
            sed -i '' "/^cleanup_done:/d" "$dev_mode_file" 2>/dev/null || true
        else
            sed -i "/^cleanup_done:/d" "$dev_mode_file" 2>/dev/null || true
        fi
        echo "cleanup_done: true" >> "$dev_mode_file"
    }
}

# ============================================================================
# 主函数: devloop_check
# ============================================================================
# 参数:
#   $1: BRANCH — git 分支名（功能分支）
#   $2: DEV_MODE_FILE — .dev-mode.<branch> 文件路径
#
# 输出（stdout）:
#   {"status":"done"}
#   {"status":"blocked","reason":"...","action":"...","pr_number":"...","ci_run_id":"..."}
#
# 返回值:
#   0 = done（所有条件满足，工作流结束）
#   2 = blocked（仍有未完成条件）
# ============================================================================
devloop_check() {
    local branch="${1:-}"
    local dev_mode_file="${2:-}"

    # ===== 前置检查 =====
    if [[ -z "$branch" ]]; then
        _devloop_jq -n '{"status":"blocked","reason":"branch 参数为空","action":"检查调用方传入的 BRANCH 参数"}'
        return 2
    fi

    # ===== 检查 cleanup_done（终止条件：最高优先级）=====
    if [[ -f "$dev_mode_file" ]] && grep -q "cleanup_done: true" "$dev_mode_file" 2>/dev/null; then
        _devloop_jq -n '{"status":"done"}'
        return 0
    fi

    # ===== 条件 1: PR 是否已创建？=====
    local pr_number="" pr_state=""

    if command -v gh &>/dev/null; then
        # 检查 open 状态的 PR
        pr_number=$(gh pr list --head "$branch" --state open --json number -q '.[0].number' 2>/dev/null || echo "")
        if [[ -n "$pr_number" ]]; then
            pr_state="open"
        else
            # 检查已合并的 PR
            pr_number=$(gh pr list --head "$branch" --state merged --json number -q '.[0].number' 2>/dev/null || echo "")
            if [[ -n "$pr_number" ]]; then
                pr_state="merged"
            fi
        fi
    fi

    if [[ -z "$pr_number" ]]; then
        _devloop_jq -n \
            --arg branch "$branch" \
            '{"status":"blocked","reason":"PR 未创建","action":"执行 Step 8：创建 PR（gh pr create --base main --head \($branch)）"}'
        return 2
    fi

    # ===== 条件 2: CI 状态？=====
    # PR 已合并则跳过（合并意味着 CI 必然已通过）
    local ci_status="unknown" ci_conclusion="" ci_run_id=""

    if [[ "$pr_state" != "merged" ]]; then
        local run_info
        run_info=$(gh run list --branch "$branch" --limit 1 --json status,conclusion,databaseId 2>/dev/null || echo "[]")

        if [[ -n "$run_info" && "$run_info" != "[]" ]]; then
            ci_status=$(echo "$run_info" | jq -r '.[0].status // "unknown"')
            ci_conclusion=$(echo "$run_info" | jq -r '.[0].conclusion // ""')
            ci_run_id=$(echo "$run_info" | jq -r '.[0].databaseId // ""')
        fi

        case "$ci_status" in
            "completed")
                if [[ "$ci_conclusion" != "success" ]]; then
                    local action_msg="CI 失败（$ci_conclusion），查看日志修复问题后重新 push"
                    if [[ -n "$ci_run_id" ]]; then
                        action_msg="CI 失败（$ci_conclusion），运行 gh run view $ci_run_id --log-failed 查看错误，修复后 git push"
                    fi
                    _devloop_jq -n \
                        --arg reason "CI 失败（$ci_conclusion）" \
                        --arg action "$action_msg" \
                        --arg run_id "${ci_run_id:-}" \
                        '{"status":"blocked","reason":$reason,"action":$action,"ci_run_id":$run_id}'
                    return 2
                fi
                ;;
            "in_progress"|"queued"|"waiting"|"pending")
                _devloop_jq -n \
                    --arg status "$ci_status" \
                    '{"status":"blocked","reason":"CI 进行中（\($status)）","action":"等待 CI 完成（通常 3-10 分钟），不要做任何操作"}'
                return 2
                ;;
            *)
                _devloop_jq -n \
                    --arg status "$ci_status" \
                    --arg branch "$branch" \
                    '{"status":"blocked","reason":"CI 状态未知（\($status)）","action":"运行 gh run list --branch \($branch) --limit 1 检查 CI 状态"}'
                return 2
                ;;
        esac
    fi

    # ===== 条件 3: PR 是否已合并？=====
    if [[ "$pr_state" == "merged" ]]; then
        # PR 已合并，检查 Step 11 Cleanup
        local step_11_status
        step_11_status=$(grep "^step_11_cleanup:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "pending")

        if [[ "$step_11_status" == "done" ]]; then
            # v1.1.0: 不再直接返回 done，改为调用 _mark_cleanup_done 写入 cleanup_done: true
            # 统一通过顶层 cleanup_done: true 检查退出（唯一终止路径），消除双 exit 0 路径
            _mark_cleanup_done "$dev_mode_file"
            _devloop_jq -n \
                '{"status":"blocked","reason":"Step 11 已完成，cleanup_done 已标记，等待下次检查退出","action":"等待 Stop Hook 检测到 cleanup_done: true 并退出"}'
            return 2
        else
            _devloop_jq -n \
                '{"status":"blocked","reason":"PR 已合并，Step 11 Cleanup 未完成","action":"执行 Step 11 Cleanup：读取 skills/dev/steps/11-cleanup.md 并执行清理"}'
            return 2
        fi
    fi

    # ===== 条件 4: CI 通过 + PR 未合并 → 检查 Step 10 LEARNINGS =====
    local step_10_status
    step_10_status=$(grep "^step_10_learning:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "pending")

    if [[ "$step_10_status" != "done" ]]; then
        _devloop_jq -n \
            --arg pr "$pr_number" \
            '{"status":"blocked","reason":"CI 通过，Step 10 LEARNINGS 未完成（合并前必须先写 LEARNINGS）","action":"执行 Step 10：读取 skills/dev/steps/10-learning.md，写 docs/LEARNINGS.md，git add + commit + push 到功能分支（PR #\($pr) 自动更新）"}'
        return 2
    fi

    # Step 10 已完成 → 合并 PR
    _devloop_jq -n \
        --arg pr "$pr_number" \
        '{"status":"blocked","reason":"CI 通过且 Step 10 LEARNINGS 已完成，PR 待合并","action":"执行合并：gh pr merge \($pr) --squash --delete-branch"}'
    return 2
}
