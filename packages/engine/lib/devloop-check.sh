#!/usr/bin/env bash
# ============================================================================
# devloop-check.sh — Provider-Agnostic Dev Loop 完成判断（4-Stage Pipeline）
# ============================================================================
# 这是 /dev 工作流完成判断逻辑的 **唯一真实来源（SSOT）**。
#
# 所有 Provider 适配器（stop-dev.sh / runners/codex/runner.sh / 未来 Provider）
# 都必须 source 此文件，通过 devloop_check() 获取当前状态，
# 然后各自输出符合自己 Provider 协议的响应。
#
# 适配器永远不改，只改这一个文件。
#
# 版本: v3.0.0
# 创建: 2026-03-13
# 更新: 2026-03-20 — 4-Stage Pipeline 重构
# ============================================================================
#
# 4-Stage Pipeline 条件顺序:
#
#   cleanup_done? → exit 0（唯一出口）
#
#   step_1_spec done?
#     → no → exit 2
#     → yes → spec_review PASS?（查 Brain API）
#       → no → exit 2（等 Codex）
#       → yes → 继续
#
#   step_2_code done?
#     → no → exit 2
#
#   PR 创建了?
#   CI 过了?
#     → code_review PASS?（查 Brain API）
#       → no → exit 2（等 Codex）
#       → yes → 继续
#
#   step_4_ship: Learning 写了? → PR 合并了? → cleanup
#
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
# ============================================================================

# ============================================================================
# 执行日志记录器（source）
# ============================================================================
_DEVLOOP_LOGGER="${BASH_SOURCE[0]%/*}/execution-logger.sh"
if [[ -f "$_DEVLOOP_LOGGER" ]]; then
    source "$_DEVLOOP_LOGGER"
fi

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
_mark_cleanup_done() {
    local dev_mode_file="${1:-}"
    [[ -z "$dev_mode_file" || ! -f "$dev_mode_file" ]] && return 0

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
# 内部函数: _check_codex_review
# ============================================================================
# 通用 Codex 审查状态检查
# 参数:
#   $1: task_id 字段名（如 spec_review_task_id）
#   $2: status 字段名（如 spec_review_status）
#   $3: 审查名称（如 "Spec Review"）
#   $4: dev_mode_file
# 返回值: 0=PASS（或无此审查）, 1=blocked（已输出 JSON）
# ============================================================================
_check_codex_review() {
    local task_id_key="$1"
    local status_key="$2"
    local review_name="$3"
    local dev_mode_file="$4"

    [[ -f "$dev_mode_file" ]] || return 0

    local task_id status_local brain_url
    task_id=$(grep "^${task_id_key}:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
    status_local=$(grep "^${status_key}:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
    brain_url="${BRAIN_URL:-http://localhost:5221}/api/brain"

    # 无此审查或已 pass → 继续
    [[ -z "$task_id" || "$status_local" == "pass" ]] && return 0

    local api_result task_status review_result
    api_result=$(curl -s --max-time 5 "$brain_url/tasks/$task_id" 2>/dev/null || echo "{}")
    task_status=$(echo "$api_result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || echo "")
    review_result=$(echo "$api_result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('review_result','') or '')" 2>/dev/null || echo "")

    if [[ "$task_status" == "completed" ]]; then
        if echo "$review_result" | grep -qi "PASS"; then
            # PASS：更新 .dev-mode 并继续
            if [[ "$(uname)" == "Darwin" ]]; then
                sed -i '' "s/^${status_key}:.*/${status_key}: pass/" "$dev_mode_file" 2>/dev/null || true
            else
                sed -i "s/^${status_key}:.*/${status_key}: pass/" "$dev_mode_file" 2>/dev/null || true
            fi
            return 0
        else
            local fail_reasons
            fail_reasons=$(echo "$review_result" | grep -A 10 "FAIL\|MISSING" | head -8 || echo "详见 review_result")
            if command -v _devlog_event &>/dev/null; then
                _devlog_event "devloop-check" "${task_id_key}" "blocked" "${review_name} FAIL: $fail_reasons"
            fi
            _devloop_jq -n \
                --arg task_id "$task_id" \
                --arg reasons "$fail_reasons" \
                --arg name "$review_name" \
                '{"status":"blocked","reason":"\($name) 未通过，需修复后重新 push","action":"根据以下 FAIL 原因修复。\($name) Task: \($task_id)\nFAIL 原因:\n\($reasons)"}'
            return 1
        fi
    else
        local wait_status="${task_status:-queued}"
        if command -v _devlog_event &>/dev/null; then
            _devlog_event "devloop-check" "${task_id_key}" "blocked" "等待 ${review_name}（状态: $wait_status）"
        fi
        _devloop_jq -n \
            --arg task_id "$task_id" \
            --arg status "$wait_status" \
            --arg name "$review_name" \
            '{"status":"blocked","reason":"等待 \($name) 完成（状态: \($status)）","action":"\($name) 正在由 Codex 执行，输出 '\''等待 \($name)...'\'' 然后停止输出。Stop Hook 会自动检查审查结果。"}'
        return 1
    fi
}

# ============================================================================
# 主函数: devloop_check
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
        if command -v _devlog_event &>/dev/null; then
            _devlog_event "devloop-check" "cleanup" "done" "cleanup_done: true"
        fi
        _devloop_jq -n '{"status":"done"}'
        return 0
    fi

    # ===== 条件 1: step_1_spec 是否完成？ =====
    if [[ -f "$dev_mode_file" ]]; then
        local step_1_status
        step_1_status=$(grep "^step_1_spec:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "pending")
        if [[ "$step_1_status" != "done" ]]; then
            if command -v _devlog_event &>/dev/null; then
                _devlog_event "devloop-check" "step_1_spec" "blocked" "Stage 1 Spec 未完成"
            fi
            _devloop_jq -n '{"status":"blocked","reason":"Stage 1 Spec 未完成","action":"立即读取 packages/engine/skills/dev/steps/01-spec.md 并按照指示执行 Stage 1。禁止询问用户。"}'
            return 2
        fi
    fi

    # ===== 条件 1.5: spec_review 是否通过？（Stage 1 后的 Codex Gate）=====
    if ! _check_codex_review "spec_review_task_id" "spec_review_status" "Spec Review" "$dev_mode_file"; then
        return 2
    fi

    # ===== 条件 2: step_2_code 是否完成？ =====
    if [[ -f "$dev_mode_file" ]]; then
        local step_2_status
        step_2_status=$(grep "^step_2_code:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "pending")
        if [[ "$step_2_status" != "done" ]]; then
            if command -v _devlog_event &>/dev/null; then
                _devlog_event "devloop-check" "step_2_code" "blocked" "Stage 2 Code 未完成"
            fi
            _devloop_jq -n '{"status":"blocked","reason":"Stage 2 Code 未完成","action":"立即读取 packages/engine/skills/dev/steps/02-code.md 并按照指示执行 Stage 2。禁止询问用户。"}'
            return 2
        fi
    fi

    # ===== 条件 3: PR 是否已创建？ =====
    local pr_number="" pr_state=""

    if command -v gh &>/dev/null; then
        pr_number=$(gh pr list --head "$branch" --state open --json number -q '.[0].number' 2>/dev/null || echo "")
        if [[ -n "$pr_number" ]]; then
            pr_state="open"
        else
            pr_number=$(gh pr list --head "$branch" --state merged --json number -q '.[0].number' 2>/dev/null || echo "")
            if [[ -n "$pr_number" ]]; then
                pr_state="merged"
            fi
        fi
    fi

    if [[ -z "$pr_number" ]]; then
        if command -v _devlog_event &>/dev/null; then
            _devlog_event "devloop-check" "pr" "blocked" "PR 未创建"
        fi
        _devloop_jq -n \
            --arg branch "$branch" \
            '{"status":"blocked","reason":"PR 未创建","action":"创建 PR（gh pr create --base main --head \($branch)）"}'
        return 2
    fi

    # ===== 条件 4: CI 状态？=====
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
                    if command -v _devlog_event &>/dev/null; then
                        _devlog_event "devloop-check" "ci" "blocked" "CI 失败（$ci_conclusion）"
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
                if [[ -f "$dev_mode_file" ]]; then
                    local started
                    started=$(grep "^started:" "$dev_mode_file" | awk '{print $2}')
                    if [[ -n "$started" ]]; then
                        local start_epoch now_epoch elapsed
                        start_epoch=$(date -d "$started" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "${started%+*}" +%s 2>/dev/null || echo 0)
                        now_epoch=$(date +%s)
                        elapsed=$(( now_epoch - start_epoch ))
                        if [[ $elapsed -gt 5400 ]]; then
                            echo "⏰ /dev CI 超时 90 分钟，创建 P0 诊断任务..." >&2
                            local _brain_url="${BRAIN_URL:-http://localhost:5221}"
                            curl -s -X POST "$_brain_url/api/brain/tasks" \
                                -H "Content-Type: application/json" \
                                -d "{\"title\":\"P0: /dev CI 超时 90 分钟 (branch: $branch)\",\"task_type\":\"dev\",\"priority\":\"P0\",\"description\":\"CI 在 branch $branch 上 pending/in_progress 超过 90 分钟\"}" \
                                --max-time 5 2>/dev/null || true
                            if command -v _devlog_event &>/dev/null; then
                                _devlog_event "devloop-check" "ci-timeout" "blocked" "CI 超时 90 分钟"
                            fi
                            _devloop_jq -n --arg branch "$branch" \
                                '{"status":"blocked","reason":"CI 已 pending 90+ 分钟，可能卡死，已创建 P0 诊断任务","action":"检查 CI：gh run list --branch \($branch) --limit 5"}'
                            return 2
                        fi
                    fi
                fi
                if command -v _devlog_event &>/dev/null; then
                    _devlog_event "devloop-check" "ci" "blocked" "CI 进行中（$ci_status）"
                fi
                _devloop_jq -n \
                    --arg status "$ci_status" \
                    '{"status":"blocked","reason":"CI 进行中（\($status)）","action":"CI 正在运行中，输出 '\''等待 CI...'\'' 然后停止输出。Stop Hook 会在你下次尝试退出时自动重新检查 CI 状态。"}'
                return 2
                ;;
            *)
                if command -v _devlog_event &>/dev/null; then
                    _devlog_event "devloop-check" "ci" "blocked" "CI 状态未知（$ci_status）"
                fi
                _devloop_jq -n \
                    --arg status "$ci_status" \
                    --arg branch "$branch" \
                    '{"status":"blocked","reason":"CI 状态未知（\($status)）","action":"运行 gh run list --branch \($branch) --limit 1 检查 CI 状态"}'
                return 2
                ;;
        esac
    fi

    # ===== 条件 5: code_review 是否通过？（CI 通过后的 Codex Gate）=====
    if ! _check_codex_review "code_review_task_id" "code_review_status" "Code Review" "$dev_mode_file"; then
        return 2
    fi

    # ===== 条件 6: PR 是否已合并？=====
    if [[ "$pr_state" == "merged" ]]; then
        local step_4_status
        step_4_status=$(grep "^step_4_ship:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "pending")

        if [[ "$step_4_status" == "done" ]]; then
            _mark_cleanup_done "$dev_mode_file"
            _devloop_jq -n \
                '{"status":"blocked","reason":"Stage 4 Ship 已完成，cleanup_done 已标记","action":"cleanup_done 已标记，输出 '\''工作流即将结束'\'' 然后停止输出。Stop Hook 下次检查时会自动退出。"}'
            return 2
        else
            # 尝试自动执行 cleanup
            local _cleanup_script=""
            for _cs_candidate in \
                "$PROJECT_ROOT/packages/engine/skills/dev/scripts/cleanup.sh" \
                "$HOME/.claude/skills/dev/scripts/cleanup.sh"; do
                if [[ -f "$_cs_candidate" ]]; then
                    _cleanup_script="$_cs_candidate"
                    break
                fi
            done

            if [[ -n "$_cleanup_script" ]]; then
                echo "🧹 自动执行 cleanup.sh..." >&2
                (cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" && bash "$_cleanup_script" 2>/dev/null) || true
            fi

            _devloop_jq -n \
                '{"status":"blocked","reason":"PR 已合并，正在执行 Stage 4 Ship（自动触发）","action":"Cleanup 正在执行，输出 '\''等待 cleanup...'\'' 然后停止输出。"}'
            return 2
        fi
    fi

    # ===== 条件 7: CI 通过 + code_review PASS + PR 未合并 → 检查 Learning =====
    local step_4_status
    step_4_status=$(grep "^step_4_ship:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "pending")

    # 兼容旧字段名 step_4_learning
    if [[ "$step_4_status" == "pending" ]]; then
        step_4_status=$(grep "^step_4_learning:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "pending")
    fi

    if [[ "$step_4_status" != "done" ]]; then
        if command -v _devlog_event &>/dev/null; then
            _devlog_event "devloop-check" "ship" "blocked" "Stage 4 Ship 未完成"
        fi
        _devloop_jq -n \
            --arg pr "$pr_number" \
            '{"status":"blocked","reason":"CI 通过 + Code Review PASS，Stage 4 Ship 未完成（合并前必须先写 Learning）","action":"立即读取 packages/engine/skills/dev/steps/04-ship.md 并按照指示执行 Stage 4。禁止询问用户。"}'
        return 2
    fi

    # Stage 4 已完成 → 合并 PR
    if command -v _devlog_event &>/dev/null; then
        _devlog_event "devloop-check" "merge" "blocked" "CI 通过 + Learning 完成，等待合并 PR #$pr_number"
    fi
    _devloop_jq -n \
        --arg pr "$pr_number" \
        '{"status":"blocked","reason":"CI 通过且 Stage 4 Ship 已完成，PR 待合并","action":"执行合并：gh pr merge \($pr) --squash --delete-branch"}'
    return 2
}
