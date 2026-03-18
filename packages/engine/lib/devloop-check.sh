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

    # ===== 条件 1.5: intent_expand 是否已完成？（PR 检查之前）=====
    # 若 .dev-mode 中有 intent_expand_task_id 且 status != completed，阻塞等待
    if [[ -f "$dev_mode_file" ]]; then
        local intent_task_id intent_status_local brain_url_base
        intent_task_id=$(grep "^intent_expand_task_id:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
        intent_status_local=$(grep "^intent_expand_status:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
        brain_url_base="${BRAIN_URL:-http://localhost:5221}/api/brain"

        if [[ -n "$intent_task_id" && "$intent_status_local" != "completed" ]]; then
            local intent_api_result intent_task_status
            intent_api_result=$(curl -s --max-time 5 "$brain_url_base/tasks/$intent_task_id" 2>/dev/null || echo "{}")
            intent_task_status=$(echo "$intent_api_result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || echo "")

            if [[ "$intent_task_status" == "completed" ]]; then
                # intent_expand 已完成：更新 .dev-mode 并继续
                if [[ "$(uname)" == "Darwin" ]]; then
                    sed -i '' "s/^intent_expand_status:.*/intent_expand_status: completed/" "$dev_mode_file" 2>/dev/null || true
                else
                    sed -i "s/^intent_expand_status:.*/intent_expand_status: completed/" "$dev_mode_file" 2>/dev/null || true
                fi
                # 继续后续条件
            else
                local intent_wait_status="${intent_task_status:-queued}"
                _devloop_jq -n \
                    --arg task_id "$intent_task_id" \
                    --arg status "$intent_wait_status" \
                    '{"status":"blocked","reason":"等待 intent_expand 意图扩展完成（状态: \($status)）","action":"等待 intent_expand task \($task_id) 完成，enriched PRD 写入后自动继续"}'
                return 2
            fi
        fi
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

    # ===== 条件 2.5: cto_review 是否通过？（CI 检查之前）=====
    # 若 .dev-mode 中有 cto_review_task_id 且 cto_review_status != pass，阻塞等待
    if [[ -f "$dev_mode_file" ]]; then
        local cto_task_id cto_status_local brain_url_cto
        cto_task_id=$(grep "^cto_review_task_id:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
        cto_status_local=$(grep "^cto_review_status:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
        brain_url_cto="${BRAIN_URL:-http://localhost:5221}/api/brain"

        if [[ -n "$cto_task_id" && "$cto_status_local" != "pass" ]]; then
            local cto_api_result cto_task_status cto_review_result
            cto_api_result=$(curl -s --max-time 5 "$brain_url_cto/tasks/$cto_task_id" 2>/dev/null || echo "{}")
            cto_task_status=$(echo "$cto_api_result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || echo "")
            cto_review_result=$(echo "$cto_api_result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('review_result','') or '')" 2>/dev/null || echo "")

            if [[ "$cto_task_status" == "completed" ]]; then
                if echo "$cto_review_result" | grep -qi "PASS"; then
                    # CTO Review PASS：更新 .dev-mode 并继续
                    if [[ "$(uname)" == "Darwin" ]]; then
                        sed -i '' "s/^cto_review_status:.*/cto_review_status: pass/" "$dev_mode_file" 2>/dev/null || true
                    else
                        sed -i "s/^cto_review_status:.*/cto_review_status: pass/" "$dev_mode_file" 2>/dev/null || true
                    fi
                    # 继续后续条件
                else
                    local cto_fail_reasons
                    cto_fail_reasons=$(echo "$cto_review_result" | grep -A 5 "FAIL" | head -5 || echo "详见 review_result")
                    _devloop_jq -n \
                        --arg task_id "$cto_task_id" \
                        --arg reasons "$cto_fail_reasons" \
                        '{"status":"blocked","reason":"CTO Review 未通过，需修复后重新 push","action":"根据以下 FAIL 原因修复代码后重新 push。CTO Review Task: \($task_id)\nFAIL 原因:\n\($reasons)"}'
                    return 2
                fi
            else
                local cto_wait_status="${cto_task_status:-queued}"
                _devloop_jq -n \
                    --arg task_id "$cto_task_id" \
                    --arg status "$cto_wait_status" \
                    '{"status":"blocked","reason":"等待 CTO Review 完成（状态: \($status)）","action":"等待 cto_review task \($task_id) 完成，PASS 后自动继续进入 CI"}'
                return 2
            fi
        fi
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
                # ===== 全局 CI 超时保护（90 分钟）=====
                # 若 CI 持续 pending/in_progress 超过 90 分钟，允许退出（CI 可能卡死）
                if [[ -f "$dev_mode_file" ]]; then
                    local started
                    started=$(grep "^started:" "$dev_mode_file" | awk '{print $2}')
                    if [[ -n "$started" ]]; then
                        local start_epoch now_epoch elapsed
                        start_epoch=$(date -d "$started" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "${started%+*}" +%s 2>/dev/null || echo 0)
                        now_epoch=$(date +%s)
                        elapsed=$(( now_epoch - start_epoch ))
                        if [[ $elapsed -gt 5400 ]]; then  # 90 分钟 = 5400 秒
                            echo "⏰ /dev 会话已超过 90 分钟，CI 可能卡住，允许退出" >&2
                            echo "   请手动检查 CI 状态: gh run list --branch $branch" >&2
                            _devloop_jq -n '{"status":"done"}'
                            return 0
                        fi
                    fi
                fi
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

    # ===== 条件 3.5: CI 通过 → 检查异步 PR Review 状态（若有 review_task_id）=====
    if [[ -f "$dev_mode_file" ]]; then
        local review_task_id review_status_local brain_url
        review_task_id=$(grep "^review_task_id:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
        review_status_local=$(grep "^review_status:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
        brain_url="${BRAIN_URL:-http://localhost:5221}/api/brain"

        if [[ -n "$review_task_id" && "$review_status_local" != "pass" ]]; then
            local review_api_result review_task_status review_result_text
            review_api_result=$(curl -s --max-time 5 "$brain_url/tasks/$review_task_id" 2>/dev/null || echo "{}")
            review_task_status=$(echo "$review_api_result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || echo "")
            review_result_text=$(echo "$review_api_result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('review_result','') or '')" 2>/dev/null || echo "")

            if [[ "$review_task_status" == "completed" ]]; then
                if echo "$review_result_text" | grep -qi "REVIEW_RESULT:[[:space:]]*PASS"; then
                    # Review PASS：更新 .dev-mode 并继续
                    if [[ "$(uname)" == "Darwin" ]]; then
                        sed -i '' "s/^review_status:.*/review_status: pass/" "$dev_mode_file" 2>/dev/null || true
                    else
                        sed -i "s/^review_status:.*/review_status: pass/" "$dev_mode_file" 2>/dev/null || true
                    fi
                    # 继续条件 4
                else
                    local fail_reasons
                    fail_reasons=$(echo "$review_result_text" | grep -A 10 "FAIL_REASONS:" | head -8 || echo "详见 review_result")
                    _devloop_jq -n \
                        --arg task_id "$review_task_id" \
                        --arg reasons "$fail_reasons" \
                        '{"status":"blocked","reason":"PR Review 未通过（西安 Codex 独立审查）","action":"修复 review 指出的问题后重新 push。Review Task ID: \($task_id)\nFAIL_REASONS:\n\($reasons)"}'
                    return 2
                fi
            else
                local review_wait_status="${review_task_status:-queued}"
                _devloop_jq -n \
                    --arg task_id "$review_task_id" \
                    --arg status "$review_wait_status" \
                    '{"status":"blocked","reason":"等待西安 Codex PR Review 完成（状态: \($status)）","action":"等待 review_task \($task_id) 完成，通常 10-30 秒，不要做任何操作"}'
                return 2
            fi
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
