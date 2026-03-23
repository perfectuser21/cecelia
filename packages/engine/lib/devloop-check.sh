#!/usr/bin/env bash
# ============================================================================
# devloop-check.sh — Provider-Agnostic Dev Loop 完成判断（4-Stage Pipeline）
# ============================================================================
# 这是 /dev 工作流完成判断逻辑的 **唯一真实来源（SSOT）**。
#
# 所有 Provider 适配器（stop-dev.sh / stop.sh / 未来 Provider）
# 都必须 source 此文件，通过 devloop_check() 获取当前状态，
# 然后各自输出符合自己 Provider 协议的响应。
#
# 适配器永远不改，只改这一个文件。
#
# 版本: v3.5.0
# 创建: 2026-03-13
# 更新: 2026-03-20 — 4-Stage Pipeline 重构
# 更新: 2026-03-21 — Pipeline 死锁修复（#1286/#1294）
# 更新: 2026-03-22 — spec_review/code_review_gate 改为 Agent subagent 同步审查（原 Codex 异步 Gate 改为同步）
# 更新: 2026-03-22 — 加回条件 1.5/2.5：读 .dev-mode 中 subagent 写入的 status 字段（不查 Brain API）
# 更新: 2026-03-22 — 清理误导性注释，blocked 状态为 subagent FAIL 写入，需分析 root cause 修复
# 更新: 2026-03-22 — P0 修复：cleanup 失败后加 return 2 触发重试，避免 PR 合并后工作流卡死
# 更新: 2026-03-22 — P0 安全：seal 文件机制（#seal-gate），条件 1.5/2.5 读 seal 文件，自认证检测
# ============================================================================
#
# 4-Stage Pipeline 条件顺序:
#
#   cleanup_done? → exit 0（唯一出口）
#
#   step_1_spec done?
#     → no → exit 2
#     → yes → 继续
#
#   条件 1.5: spec_review seal 文件验证（P0 防伪机制）
#     → seal 文件存在 且 verdict=PASS → 继续
#     → seal 文件存在 且 verdict=FAIL → exit 2（审查失败，修复 Task Card）
#     → seal 文件不存在 且 .dev-mode 有 pass → exit 2（自认证检测，拦截）
#     → seal 文件不存在 且 无字段 → pass-through（subagent 尚未运行）
#
#   step_2_code done?
#     → no → exit 2
#     → yes → 继续
#
#   条件 2.5: code_review_gate seal 文件验证（P0 防伪机制）
#     → seal 文件存在 且 verdict=PASS → 继续
#     → seal 文件存在 且 verdict=FAIL → exit 2（审查失败，修复代码）
#     → seal 文件不存在 且 .dev-mode 有 pass → exit 2（自认证检测，拦截）
#     → seal 文件不存在 且 无字段 → pass-through（subagent 尚未运行）
#
#   PR 创建了?
#   CI 过了?
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
            _devloop_jq -n '{"status":"blocked","reason":"Stage 1 Spec 未完成","action":"立即读取 skills/dev/steps/01-spec.md 并执行 Stage 1。禁止询问用户。"}'
            return 2
        fi
    fi

    # ===== 条件 1.5: spec_review_status（seal 文件验证）=====
    # seal 文件存在且 verdict=PASS → 继续
    # seal 文件存在且 verdict=FAIL → blocked
    # seal 文件不存在 且 .dev-mode 有 status=pass → blocked（自认证检测）
    # seal 文件不存在 且 .dev-mode 无该字段 → pass-through（subagent 尚未运行）
    if [[ -f "$dev_mode_file" ]]; then
        local spec_review_status spec_seal_file spec_seal_verdict
        spec_review_status=$(grep "^spec_review_status:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
        spec_seal_file="$(dirname "$dev_mode_file")/.dev-gate-spec.${branch}"
        if [[ -f "$spec_seal_file" ]]; then
            spec_seal_verdict=$(jq -r '.verdict // ""' "$spec_seal_file" 2>/dev/null || echo "")
            if [[ "$spec_seal_verdict" == "FAIL" ]]; then
                if command -v _devlog_event &>/dev/null; then
                    _devlog_event "devloop-check" "spec_review" "blocked" "spec_review seal FAIL，需修复 Task Card"
                fi
                _devloop_jq -n '{"status":"blocked","reason":"spec_review seal 文件 verdict=FAIL，需分析 root cause 修复 Task Card","action":"读取 .dev-gate-spec.<branch> 中的 issues，修复 Task Card，重新调用 spec-review subagent"}'
                return 2
            fi
            # seal 存在且 verdict=PASS → 继续
        else
            # seal 文件不存在
            if [[ "$spec_review_status" == "pass" ]]; then
                # .dev-mode 中有 pass 但无 seal 文件 → 自认证检测，拦截
                if command -v _devlog_event &>/dev/null; then
                    _devlog_event "devloop-check" "spec_review" "blocked" "spec_review 自认证检测：无 seal 文件但 .dev-mode 有 pass"
                fi
                _devloop_jq -n '{"status":"blocked","reason":"spec_review 自认证被检测：.dev-mode 有 spec_review_status: pass 但无 seal 文件","action":"调用 spec-review subagent，让 subagent 写入 .dev-gate-spec.<branch> seal 文件后再标记 pass"}'
                return 2
            elif [[ "$spec_review_status" == "blocked" ]]; then
                if command -v _devlog_event &>/dev/null; then
                    _devlog_event "devloop-check" "spec_review" "blocked" "spec_review 审查失败，需分析 root cause"
                fi
                _devloop_jq -n '{"status":"blocked","reason":"spec_review FAIL，需深入分析 root cause 修复 Task Card","action":"读取 spec_review blocker issues，修复 Task Card，重新调用 spec-review subagent"}'
                return 2
            fi
            # 不存在且无字段 → pass-through，subagent 尚未运行
        fi
    fi

    # ===== 条件 2: step_2_code 是否完成？ =====
    if [[ -f "$dev_mode_file" ]]; then
        local step_2_status
        step_2_status=$(grep "^step_2_code:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "pending")
        if [[ "$step_2_status" != "done" ]]; then
            if command -v _devlog_event &>/dev/null; then
                _devlog_event "devloop-check" "step_2_code" "blocked" "Stage 2 Code 未完成"
            fi
            _devloop_jq -n '{"status":"blocked","reason":"Stage 2 Code 未完成","action":"立即读取 skills/dev/steps/02-code.md 并执行 Stage 2。禁止询问用户。"}'
            return 2
        fi
    fi

    # ===== 条件 2.5: code_review_gate_status（seal 文件验证）=====
    # seal 文件存在且 verdict=PASS → 继续
    # seal 文件存在且 verdict=FAIL → blocked
    # seal 文件不存在 且 .dev-mode 有 status=pass → blocked（自认证检测）
    # seal 文件不存在 且 .dev-mode 无该字段 → pass-through（subagent 尚未运行）
    if [[ -f "$dev_mode_file" ]]; then
        local code_review_gate_status crg_seal_file crg_seal_verdict
        code_review_gate_status=$(grep "^code_review_gate_status:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
        crg_seal_file="$(dirname "$dev_mode_file")/.dev-gate-crg.${branch}"
        if [[ -f "$crg_seal_file" ]]; then
            crg_seal_verdict=$(jq -r '.verdict // ""' "$crg_seal_file" 2>/dev/null || echo "")
            if [[ "$crg_seal_verdict" == "FAIL" ]]; then
                if command -v _devlog_event &>/dev/null; then
                    _devlog_event "devloop-check" "code_review_gate" "blocked" "code_review_gate seal FAIL，需修复代码"
                fi
                _devloop_jq -n '{"status":"blocked","reason":"code_review_gate seal 文件 verdict=FAIL，需修复代码","action":"读取 .dev-gate-crg.<branch> 中的 issues，修复代码，重新调用 code-review-gate subagent"}'
                return 2
            fi
            # seal 存在且 verdict=PASS → 继续
        else
            # seal 文件不存在
            if [[ "$code_review_gate_status" == "pass" ]]; then
                # .dev-mode 中有 pass 但无 seal 文件 → 自认证检测，拦截
                if command -v _devlog_event &>/dev/null; then
                    _devlog_event "devloop-check" "code_review_gate" "blocked" "code_review_gate 自认证检测：无 seal 文件但 .dev-mode 有 pass"
                fi
                _devloop_jq -n '{"status":"blocked","reason":"code_review_gate 自认证被检测：.dev-mode 有 code_review_gate_status: pass 但无 seal 文件","action":"调用 code-review-gate subagent，让 subagent 写入 .dev-gate-crg.<branch> seal 文件后再标记 pass"}'
                return 2
            elif [[ "$code_review_gate_status" == "blocked" ]]; then
                if command -v _devlog_event &>/dev/null; then
                    _devlog_event "devloop-check" "code_review_gate" "blocked" "code_review_gate 审查失败，需分析 root cause"
                fi
                _devloop_jq -n '{"status":"blocked","reason":"code_review_gate FAIL，需深入分析 root cause 修复代码","action":"读取 code_review_gate blocker issues，修复代码，重新调用 code-review-gate subagent"}'
                return 2
            fi
            # 不存在且无字段 → pass-through，subagent 尚未运行
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
                    '{"status":"blocked","reason":"CI 进行中（\($status)）","action":"CI 正在运行。输出当前状态后停止，Stop Hook 会自动重新检查。禁止询问用户。"}'
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

    # ===== 条件 5: PR 是否已合并？=====
    if [[ "$pr_state" == "merged" ]]; then
        local step_4_status
        step_4_status=$(grep "^step_4_ship:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "pending")

        if [[ "$step_4_status" == "done" ]]; then
            _mark_cleanup_done "$dev_mode_file"
            _devloop_jq -n \
                '{"status":"blocked","reason":"Stage 4 Ship 已完成，cleanup_done 已标记，等待下次检查退出","action":"等待 Stop Hook 检测到 cleanup_done: true 并退出"}'
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
                if (cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" && bash "$_cleanup_script") 2>/dev/null; then
                    _devloop_jq -n \
                        '{"status":"blocked","reason":"PR 已合并，cleanup 执行完成，等待下次检查","action":"等待 Stop Hook 检测到 cleanup_done: true 并退出"}'
                else
                    echo "⚠️  cleanup.sh 执行失败，exit 2 重试..." >&2
                    _devloop_jq -n \
                        '{"status":"blocked","reason":"PR 已合并，cleanup.sh 执行失败","action":"立即读取 skills/dev/steps/04-ship.md 并执行 Stage 4 Ship（写 Learning + cleanup）"}'
                fi
            else
                _devloop_jq -n \
                    '{"status":"blocked","reason":"PR 已合并，未找到 cleanup.sh","action":"立即读取 skills/dev/steps/04-ship.md 并执行 Stage 4 Ship"}'
            fi
            return 2
        fi
    fi

    # ===== 条件 6: CI 通过 + code_review PASS + PR 未合并 → 检查 Learning =====
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
            '{"status":"blocked","reason":"CI 通过，Stage 4 Ship 未完成（合并前必须先写 Learning）","action":"立即读取 skills/dev/steps/04-ship.md 并执行 Stage 4，写 Learning + 合并 PR #\($pr)。禁止询问用户。"}'
        return 2
    fi

    # v14.2.0: Stage 4 已完成 → 真正执行合并
    if command -v _devlog_event &>/dev/null; then
        _devlog_event "devloop-check" "merge" "executing" "CI 通过 + Learning 完成，执行自动合并 PR #$pr_number"
    fi
    echo "[devloop-check] 自动合并 PR #$pr_number（CI 通过 + Stage 4 完成）..." >&2
    if gh pr merge "$pr_number" --squash --delete-branch 2>&1; then
        echo "[devloop-check] PR #$pr_number 已合并" >&2
        if command -v _devlog_event &>/dev/null; then
            _devlog_event "devloop-check" "merge" "success" "PR #$pr_number 已自动合并"
        fi

        # v15.4.0: PR 合并成功后回调 Brain execution-callback（通知任务完成）
        local _cb_task_id=""
        _cb_task_id=$(grep "^brain_task_id:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
        [[ -z "$_cb_task_id" ]] && _cb_task_id=$(grep "^task_id:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
        if [[ -n "$_cb_task_id" ]]; then
            local _cb_brain_url="${BRAIN_URL:-http://localhost:5221}"
            local _cb_repo=""
            _cb_repo=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null || echo "")
            local _cb_pr_url=""
            [[ -n "$_cb_repo" ]] && _cb_pr_url="https://github.com/${_cb_repo}/pull/${pr_number}"
            # 从 .dev-mode 读取 goal_id
            local _cb_goal_id=""
            _cb_goal_id=$(grep "^goal_id:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
            echo "[devloop-check] 回调 Brain execution-callback（task: $_cb_task_id, status: completed）..." >&2
            # 回调时附带 goal_id，Brain 会自动更新 KR 进度
            curl -s -X POST "$_cb_brain_url/api/brain/execution-callback" \
                -H "Content-Type: application/json" \
                -d "{\"task_id\":\"$_cb_task_id\",\"status\":\"completed\",\"goal_id\":\"$_cb_goal_id\",\"pr_url\":\"${_cb_pr_url}\"}" \
                --max-time 10 2>/dev/null || true
        fi

        _devloop_jq -n \
            --arg pr "$pr_number" \
            '{"status":"merged","reason":"PR #\($pr) 已自动合并，工作流即将结束","action":"执行 cleanup"}'
        return 0
    else
        echo "[devloop-check] ⚠️ PR #$pr_number 合并失败，等待下次重试..." >&2
        if command -v _devlog_event &>/dev/null; then
            _devlog_event "devloop-check" "merge" "failed" "PR #$pr_number 自动合并失败"
        fi
        _devloop_jq -n \
            --arg pr "$pr_number" \
            '{"status":"blocked","reason":"PR #\($pr) 自动合并失败，等待下次重试"}'
        return 2
    fi
}
