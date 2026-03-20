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
# 版本: v2.0.0
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
# 向 dev_mode_file 写入 cleanup_done: true，触发唯一的终止路径。
# 调用方：cleanup.sh（直接写文件）和 devloop_check（step_5_clean: done 时调用）
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
        if command -v _devlog_event &>/dev/null; then
            _devlog_event "devloop-check" "cleanup" "done" "cleanup_done: true"
        fi
        _devloop_jq -n '{"status":"done"}'
        return 0
    fi

    # ===== 条件 2.5: cto_review 是否通过？（PR 创建之前，P0 本机 Codex）=====
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
                    if command -v _devlog_event &>/dev/null; then
                        _devlog_event "devloop-check" "cto_review" "blocked" "CTO Review FAIL: $cto_fail_reasons"
                    fi
                    _devloop_jq -n \
                        --arg task_id "$cto_task_id" \
                        --arg reasons "$cto_fail_reasons" \
                        '{"status":"blocked","reason":"CTO Review 未通过，需修复后重新 push","action":"根据以下 FAIL 原因修复代码后重新 push。CTO Review Task: \($task_id)\nFAIL 原因:\n\($reasons)"}'
                    return 2
                fi
            else
                local cto_wait_status="${cto_task_status:-queued}"
                if command -v _devlog_event &>/dev/null; then
                    _devlog_event "devloop-check" "cto_review" "blocked" "等待 CTO Review（状态: $cto_wait_status）"
                fi
                _devloop_jq -n \
                    --arg task_id "$cto_task_id" \
                    --arg status "$cto_wait_status" \
                    '{"status":"blocked","reason":"等待 CTO Review 完成（状态: \($status)）","action":"等待 cto_review task \($task_id) 完成，PASS 后自动继续进入 CI"}'
                return 2
            fi
        fi
    fi

    # ===== 条件 2.6: prd_coverage_audit 是否通过？（PR 创建之前，P0 本机 Codex）=====
    # 若 .dev-mode 中有 prd_audit_task_id 且 prd_audit_status != pass，阻塞等待
    if [[ -f "$dev_mode_file" ]]; then
        local pa_task_id pa_status_local brain_url_pa
        pa_task_id=$(grep "^prd_audit_task_id:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
        pa_status_local=$(grep "^prd_audit_status:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
        brain_url_pa="${BRAIN_URL:-http://localhost:5221}/api/brain"

        if [[ -n "$pa_task_id" && "$pa_status_local" != "pass" ]]; then
            local pa_api_result pa_task_status pa_review_result
            pa_api_result=$(curl -s --max-time 5 "$brain_url_pa/tasks/$pa_task_id" 2>/dev/null || echo "{}")
            pa_task_status=$(echo "$pa_api_result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || echo "")
            pa_review_result=$(echo "$pa_api_result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('review_result','') or '')" 2>/dev/null || echo "")

            if [[ "$pa_task_status" == "completed" ]]; then
                if echo "$pa_review_result" | grep -qi "PASS"; then
                    # PRD Audit PASS：更新 .dev-mode 并继续
                    if [[ "$(uname)" == "Darwin" ]]; then
                        sed -i '' "s/^prd_audit_status:.*/prd_audit_status: pass/" "$dev_mode_file" 2>/dev/null || true
                    else
                        sed -i "s/^prd_audit_status:.*/prd_audit_status: pass/" "$dev_mode_file" 2>/dev/null || true
                    fi
                    # 继续后续条件
                else
                    local pa_fail_reasons
                    pa_fail_reasons=$(echo "$pa_review_result" | grep -A 10 "MISSING\|FAIL" | head -8 || echo "详见 review_result")
                    if command -v _devlog_event &>/dev/null; then
                        _devlog_event "devloop-check" "prd_audit" "blocked" "PRD Audit FAIL: $pa_fail_reasons"
                    fi
                    _devloop_jq -n \
                        --arg task_id "$pa_task_id" \
                        --arg reasons "$pa_fail_reasons" \
                        '{"status":"blocked","reason":"PRD 覆盖审计未通过，有承诺未实现","action":"根据以下 MISSING 项补充实现后重新 push。PRD Audit Task: \($task_id)\n未覆盖项:\n\($reasons)"}'
                    return 2
                fi
            else
                local pa_wait_status="${pa_task_status:-queued}"
                if command -v _devlog_event &>/dev/null; then
                    _devlog_event "devloop-check" "prd_audit" "blocked" "等待 PRD 覆盖审计（状态: $pa_wait_status）"
                fi
                _devloop_jq -n \
                    --arg task_id "$pa_task_id" \
                    --arg status "$pa_wait_status" \
                    '{"status":"blocked","reason":"等待 PRD 覆盖审计完成（状态: \($status)）","action":"等待 prd_coverage_audit task \($task_id) 完成，PASS 后自动继续"}'
                return 2
            fi
        fi
    fi

    # ===== 条件 2.7: dod_verify 是否通过？（DoD 独立验证）=====
    if [[ -f "$dev_mode_file" ]]; then
        local dv_task_id dv_status_local brain_url_dv
        dv_task_id=$(grep "^dod_verify_task_id:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
        dv_status_local=$(grep "^dod_verify_status:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
        brain_url_dv="${BRAIN_URL:-http://localhost:5221}/api/brain"

        if [[ -n "$dv_task_id" && "$dv_status_local" != "pass" ]]; then
            local dv_api_result dv_task_status dv_review_result
            dv_api_result=$(curl -s --max-time 5 "$brain_url_dv/tasks/$dv_task_id" 2>/dev/null || echo "{}")
            dv_task_status=$(echo "$dv_api_result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || echo "")
            dv_review_result=$(echo "$dv_api_result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('review_result','') or '')" 2>/dev/null || echo "")

            if [[ "$dv_task_status" == "completed" ]]; then
                if echo "$dv_review_result" | grep -qi "PASS"; then
                    if [[ "$(uname)" == "Darwin" ]]; then
                        sed -i '' "s/^dod_verify_status:.*/dod_verify_status: pass/" "$dev_mode_file" 2>/dev/null || true
                    else
                        sed -i "s/^dod_verify_status:.*/dod_verify_status: pass/" "$dev_mode_file" 2>/dev/null || true
                    fi
                else
                    local dv_fail_reasons
                    dv_fail_reasons=$(echo "$dv_review_result" | grep -A 10 "FAIL" | head -8 || echo "详见 review_result")
                    if command -v _devlog_event &>/dev/null; then
                        _devlog_event "devloop-check" "dod_verify" "blocked" "DoD Verify FAIL: $dv_fail_reasons"
                    fi
                    _devloop_jq -n \
                        --arg task_id "$dv_task_id" \
                        --arg reasons "$dv_fail_reasons" \
                        '{"status":"blocked","reason":"DoD 独立验证未通过，有 Test 命令失败","action":"根据以下 FAIL 原因修复代码后重新 push。DoD Verify Task: \($task_id)\nFAIL 原因:\n\($reasons)"}'
                    return 2
                fi
            else
                local dv_wait_status="${dv_task_status:-queued}"
                if command -v _devlog_event &>/dev/null; then
                    _devlog_event "devloop-check" "dod_verify" "blocked" "等待 DoD 独立验证（状态: $dv_wait_status）"
                fi
                _devloop_jq -n \
                    --arg task_id "$dv_task_id" \
                    --arg status "$dv_wait_status" \
                    '{"status":"blocked","reason":"等待 DoD 独立验证完成（状态: \($status)）","action":"等待 dod_verify task \($task_id) 完成，PASS 后自动继续"}'
                return 2
            fi
        fi
    fi

    # ===== 条件 1: PR 是否已创建？（审查全 PASS 后才创建 PR）=====
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
            '{"status":"blocked","reason":"审查已通过，PR 未创建","action":"创建 PR（gh pr create --base main --head \($branch)）"}'
        return 2
    fi

    # ===== 条件 3: CI 状态？=====
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
                            echo "⏰ /dev CI 超时 90 分钟，创建 P0 诊断任务..." >&2
                            # 向 Brain 注册 P0 诊断任务（ci-timeout）
                            local _brain_url="${BRAIN_URL:-http://localhost:5221}"
                            curl -s -X POST "$_brain_url/api/brain/tasks" \
                                -H "Content-Type: application/json" \
                                -d "{\"title\":\"P0: /dev CI 超时 90 分钟 (branch: $branch)\",\"task_type\":\"dev\",\"priority\":\"P0\",\"description\":\"CI 在 branch $branch 上 pending/in_progress 超过 90 分钟，需要诊断原因。\\n\\n检查：gh run list --branch $branch --limit 5\"}" \
                                --max-time 5 2>/dev/null || true
                            if command -v _devlog_event &>/dev/null; then
                                _devlog_event "devloop-check" "ci-timeout" "blocked" "CI 超时 90 分钟，已创建 P0 诊断任务"
                            fi
                            _devloop_jq -n --arg branch "$branch" \
                                '{"status":"blocked","reason":"CI 已 pending 90+ 分钟，可能卡死，已创建 P0 诊断任务","action":"手动检查 CI：gh run list --branch \($branch) --limit 5，或 gh run cancel"}'
                            return 2
                        fi
                    fi
                fi
                if command -v _devlog_event &>/dev/null; then
                    _devlog_event "devloop-check" "ci" "blocked" "CI 进行中（$ci_status）"
                fi
                _devloop_jq -n \
                    --arg status "$ci_status" \
                    '{"status":"blocked","reason":"CI 进行中（\($status)）","action":"等待 CI 完成（通常 3-10 分钟），不要做任何操作"}'
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

    # ===== 条件 4: PR 是否已合并？=====
    if [[ "$pr_state" == "merged" ]]; then
        # PR 已合并，检查 Step 5 Clean
        local step_5_status
        step_5_status=$(grep "^step_5_clean:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "pending")

        if [[ "$step_5_status" == "done" ]]; then
            # v1.1.0: 不再直接返回 done，改为调用 _mark_cleanup_done 写入 cleanup_done: true
            # 统一通过顶层 cleanup_done: true 检查退出（唯一终止路径），消除双 exit 0 路径
            _mark_cleanup_done "$dev_mode_file"
            _devloop_jq -n \
                '{"status":"blocked","reason":"Step 5 Clean 已完成，cleanup_done 已标记，等待下次检查退出","action":"等待 Stop Hook 检测到 cleanup_done: true 并退出"}'
            return 2
        else
            # 尝试自动执行 cleanup（不依赖 AI 手动调用）
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
                # cleanup.sh 会写 step_5_clean: done + cleanup_done: true
                # 下次 devloop_check 时顶层 cleanup_done 检查会捕获
            fi

            _devloop_jq -n \
                '{"status":"blocked","reason":"PR 已合并，正在执行 Step 5 Clean（自动触发）","action":"等待 cleanup 完成，下次检查时自动退出"}'
            return 2
        fi
    fi

    # ===== 条件 4.5: CI 通过 → 检查异步 PR Review 状态（若有 review_task_id）=====
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
                    if command -v _devlog_event &>/dev/null; then
                        _devlog_event "devloop-check" "pr_review" "blocked" "PR Review FAIL: $fail_reasons"
                    fi
                    _devloop_jq -n \
                        --arg task_id "$review_task_id" \
                        --arg reasons "$fail_reasons" \
                        '{"status":"blocked","reason":"PR Review 未通过（本机 Codex 独立审查）","action":"修复 review 指出的问题后重新 push。Review Task ID: \($task_id)\nFAIL_REASONS:\n\($reasons)"}'
                    return 2
                fi
            else
                local review_wait_status="${review_task_status:-queued}"
                if command -v _devlog_event &>/dev/null; then
                    _devlog_event "devloop-check" "pr_review" "blocked" "等待 PR Review（状态: $review_wait_status）"
                fi
                _devloop_jq -n \
                    --arg task_id "$review_task_id" \
                    --arg status "$review_wait_status" \
                    '{"status":"blocked","reason":"等待本机 Codex PR Review 完成（状态: \($status)）","action":"等待 review_task \($task_id) 完成，通常 10-30 秒，不要做任何操作"}'
                return 2
            fi
        fi
    fi

    # ===== 条件 5: CI 通过 + PR 未合并 → 检查 Step 4 LEARNINGS =====
    local step_4_status
    step_4_status=$(grep "^step_4_learning:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "pending")

    if [[ "$step_4_status" != "done" ]]; then
        if command -v _devlog_event &>/dev/null; then
            _devlog_event "devloop-check" "learning" "blocked" "Learning 未完成"
        fi
        _devloop_jq -n \
            --arg pr "$pr_number" \
            '{"status":"blocked","reason":"CI 通过，Step 4 Learning 未完成（合并前必须先写 LEARNINGS）","action":"执行 Step 4：读取 skills/dev/steps/04-learning.md，写 docs/LEARNINGS.md，git add + commit + push 到功能分支（PR #\($pr) 自动更新）"}'
        return 2
    fi

    # Step 4 Learning 已完成 → 合并 PR
    if command -v _devlog_event &>/dev/null; then
        _devlog_event "devloop-check" "merge" "blocked" "CI 通过 + Learning 完成，等待合并 PR #$pr_number"
    fi
    _devloop_jq -n \
        --arg pr "$pr_number" \
        '{"status":"blocked","reason":"CI 通过且 Step 4 Learning 已完成，PR 待合并","action":"执行合并：gh pr merge \($pr) --squash --delete-branch"}'
    return 2
}
