#!/usr/bin/env bash
# ============================================================================
# devloop-check.sh — Provider-Agnostic Dev Loop 完成判断（4-Stage Pipeline）
# ============================================================================
# SSOT：所有 Provider 适配器 source 此文件，通过 devloop_check() 获取当前状态。
#
# 版本: v4.1.0
# 更新: 2026-04-03 — Harness v2.0 适配：harness_mode 快速通道（跳过 DoD/CI/Learning）
#
# 4-Stage Pipeline 条件顺序:
#   0. cleanup_done → exit 0（唯一出口）
#   0.5 harness_mode → 快速通道（只检查 code done + PR 创建）
#   1. step_1_spec done?
#   2. step_2_code done?
#   2.6. DoD 完整性检查（[ ] → [x]）
#   2.7. drift check（warning only）
#   3. PR 已创建?
#   4. CI 状态?
#   5. PR 已合并 + step_4_ship?
#   6. 自动合并 + Brain callback
#
# 公开函数:
#   devloop_check BRANCH DEV_MODE_FILE
#     输出 JSON: {"status":"done"} | {"status":"blocked","reason":"...","action":"..."}
#     返回值: 0=done, 2=blocked
# ============================================================================

# jq 缺失时的极简 shim
_devloop_jq() {
    if command -v jq &>/dev/null; then
        jq "$@"
    else
        cat >/dev/null 2>&1
        echo '{}'
    fi
}

# ============================================================================
# 内部函数: _mark_cleanup_done
# ============================================================================
_mark_cleanup_done() {
    local f="${1:-}"; [[ -z "$f" || ! -f "$f" ]] && return 0
    { flock -x 203
      grep -v "^cleanup_done:" "$f" > "$f.tmp" 2>/dev/null || true
      echo "cleanup_done: true" >> "$f.tmp" && mv "$f.tmp" "$f"
    } 203>"$f.lock" 2>/dev/null || {
      [[ "$(uname)" == "Darwin" ]] && sed -i '' "/^cleanup_done:/d" "$f" 2>/dev/null || \
          sed -i "/^cleanup_done:/d" "$f" 2>/dev/null
      echo "cleanup_done: true" >> "$f"
    }
}

# ============================================================================
# 主函数: devloop_check BRANCH DEV_MODE_FILE
# ============================================================================
devloop_check() {
    local branch="${1:-}"
    local dev_mode_file="${2:-}"

    if [[ -z "$branch" ]]; then
        _devloop_jq -n '{"status":"blocked","reason":"branch 参数为空","action":"检查调用方传入的 BRANCH 参数"}'
        return 2
    fi

    # ===== 条件 0: cleanup_done =====
    if [[ -f "$dev_mode_file" ]] && grep -q "cleanup_done: true" "$dev_mode_file" 2>/dev/null; then
        _devloop_jq -n '{"status":"done"}'
        return 0
    fi

    # ===== 条件 0.5: harness_mode 快速通道 =====
    # Harness v2.0: Generator 只需写代码 + 创建 PR，然后 exit 0 让 Brain 派 Evaluator
    # 不检查 DoD 勾选、CI 通过、Learning 等
    local _harness_mode="false"
    if [[ -f "$dev_mode_file" ]]; then
        local _hm_raw
        _hm_raw=$(grep "^harness_mode:" "$dev_mode_file" 2>/dev/null | awk '{gsub(/^[ \t]+|[ \t]+$/, "", $2); print $2}' || true)
        [[ -n "$_hm_raw" ]] && _harness_mode="$_hm_raw"
    fi

    if [[ "$_harness_mode" == "true" ]]; then
        # 检查 1: step_2_code done?
        local _h_step2="pending"
        local _h_step2_raw
        _h_step2_raw=$(grep "^step_2_code:" "$dev_mode_file" 2>/dev/null | awk '{gsub(/^[ \t]+|[ \t]+$/, "", $2); print $2}' || true)
        [[ -n "$_h_step2_raw" ]] && _h_step2="$_h_step2_raw"
        if [[ "$_h_step2" != "done" ]]; then
            _devloop_jq -n '{"status":"blocked","reason":"[Harness] Stage 2 Code 未完成","action":"立即读取 skills/dev/steps/02-code.md 并执行 Stage 2（harness 模式）。禁止询问用户。"}'
            return 2
        fi

        # 检查 2: PR 已创建?
        local _h_pr=""
        if command -v gh &>/dev/null; then
            _h_pr=$(gh pr list --head "$branch" --state all --json number -q '.[0].number' 2>/dev/null || echo "")
        fi
        if [[ -z "$_h_pr" ]]; then
            _devloop_jq -n --arg branch "$branch" \
                '{"status":"blocked","reason":"[Harness] PR 未创建","action":"立即 push + 创建 PR（gh pr create --base main --head \($branch)）"}'
            return 2
        fi

        # Harness 模式: 代码写完 + PR 已创建 → done，让 Brain 派 Evaluator
        _mark_cleanup_done "$dev_mode_file"
        _devloop_jq -n --arg pr "$_h_pr" \
            '{"status":"done","reason":"[Harness] 代码完成 + PR #\($pr) 已创建，session 结束，Brain 将派 Evaluator 验证"}'
        return 0
    fi

    # ===== 条件 1: step_1_spec =====
    if [[ -f "$dev_mode_file" ]]; then
        local step_1_status
        step_1_status=$(grep "^step_1_spec:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "pending")
        if [[ "$step_1_status" != "done" ]]; then
            _devloop_jq -n '{"status":"blocked","reason":"Stage 1 Spec 未完成","action":"立即读取 skills/dev/steps/01-spec.md 并执行 Stage 1。禁止询问用户。"}'
            return 2
        fi
    fi

    # ===== 条件 2: step_2_code =====
    if [[ -f "$dev_mode_file" ]]; then
        local step_2_status
        step_2_status=$(grep "^step_2_code:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "pending")
        if [[ "$step_2_status" != "done" ]]; then
            _devloop_jq -n '{"status":"blocked","reason":"Stage 2 Code 未完成","action":"立即读取 skills/dev/steps/02-code.md 并执行 Stage 2。禁止询问用户。"}'
            return 2
        fi
    fi

    # ===== 条件 2.6: DoD 完整性检查 =====
    if [[ -f "$dev_mode_file" ]]; then
        local _task_card_rel _worktree_root _task_card_abs _dod_unchecked
        _task_card_rel=$(grep "^task_card:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
        _worktree_root=$(dirname "$dev_mode_file")
        _task_card_abs="$_worktree_root/$_task_card_rel"
        if [[ -n "$_task_card_rel" && -f "$_task_card_abs" ]]; then
            _dod_unchecked=$(grep -cE '^\s*-\s+\[ \]\s+\[' "$_task_card_abs" 2>/dev/null || echo "0")
            if [[ "$_dod_unchecked" -gt 0 ]]; then
                _devloop_jq -n --argjson n "$_dod_unchecked" \
                    '{"status":"blocked","reason":"DoD 有 \($n) 条未验证（[ ] 未改为 [x]）","action":"逐条运行 Test 命令验证，通过后改为 [x]"}'
                return 2
            fi
        fi
    fi

    # ===== 条件 3: PR 已创建? =====
    local pr_number="" pr_state=""
    if command -v gh &>/dev/null; then
        pr_number=$(gh pr list --head "$branch" --state open --json number -q '.[0].number' 2>/dev/null || echo "")
        if [[ -n "$pr_number" ]]; then
            pr_state="open"
        else
            pr_number=$(gh pr list --head "$branch" --state merged --json number -q '.[0].number' 2>/dev/null || echo "")
            [[ -n "$pr_number" ]] && pr_state="merged"
        fi
    fi

    if [[ -z "$pr_number" ]]; then
        _devloop_jq -n --arg branch "$branch" \
            '{"status":"blocked","reason":"PR 未创建","action":"创建 PR（gh pr create --base main --head \($branch)）"}'
        return 2
    fi

    # ===== 条件 4: CI 状态? =====
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
                    [[ -n "$ci_run_id" ]] && \
                        action_msg="CI 失败（$ci_conclusion），运行 gh run view $ci_run_id --log-failed 查看错误，修复后 git push"
                    _devloop_jq -n \
                        --arg reason "CI 失败（$ci_conclusion）" \
                        --arg action "$action_msg" \
                        --arg run_id "${ci_run_id:-}" \
                        '{"status":"blocked","reason":$reason,"action":$action,"ci_run_id":$run_id}'
                    return 2
                fi
                ;;
            "in_progress"|"queued"|"waiting"|"pending")
                local _started _se _elapsed
                _started=$(grep "^started:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
                if [[ -z "$_started" ]]; then
                    _se=0
                else
                    _se=$(date -d "$_started" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "${_started%+*}" +%s 2>/dev/null || echo 0)
                fi
                _elapsed=$(( $(date +%s) - _se ))
                if [[ -n "$_started" && $_elapsed -gt 5400 ]]; then
                    _devloop_jq -n --arg b "$branch" '{"status":"blocked","reason":"CI 已 pending 90+ 分钟，可能卡死","action":"检查 CI：gh run list --branch \($b) --limit 5"}'
                    return 2
                fi
                _devloop_jq -n --arg s "$ci_status" '{"status":"blocked","reason":"CI 进行中（\($s)）","action":"CI 正在运行，Stop Hook 会自动重新检查。禁止询问用户。"}'
                return 2
                ;;
            *)
                _devloop_jq -n --arg status "$ci_status" --arg branch "$branch" \
                    '{"status":"blocked","reason":"CI 状态未知（\($status)）","action":"运行 gh run list --branch \($branch) --limit 1 检查 CI 状态"}'
                return 2
                ;;
        esac
    fi

    # ===== 条件 5: PR 已合并? =====
    if [[ "$pr_state" == "merged" ]]; then
        local pr_base_ref=""
        [[ -n "$pr_number" ]] && \
            pr_base_ref=$(gh pr view "$pr_number" --json baseRefName -q '.baseRefName' 2>/dev/null || echo "")
        if [[ -n "$pr_base_ref" && "$pr_base_ref" != "main" ]]; then
            _devloop_jq -n --arg base "$pr_base_ref" \
                '{"status":"blocked","reason":"PR 已合并但目标分支不是 main（目标：\($base)）","action":"检查是否误合并到错误分支"}'
            return 2
        fi

        local step_4_status
        step_4_status=$(grep "^step_4_ship:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "pending")
        [[ "$step_4_status" == "pending" ]] && \
            step_4_status=$(grep "^step_4_learning:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "pending")

        if [[ "$step_4_status" == "done" ]]; then
            _mark_cleanup_done "$dev_mode_file"
            _devloop_jq -n '{"status":"blocked","reason":"Stage 4 Ship 已完成，cleanup_done 已标记，等待下次检查退出","action":"等待 Stop Hook 检测到 cleanup_done: true 并退出"}'
            return 2
        else
            local _cleanup_script=""
            for _cs in \
                "${PROJECT_ROOT:-}/packages/engine/skills/dev/scripts/cleanup.sh" \
                "$HOME/.claude/skills/dev/scripts/cleanup.sh" \
                "$HOME/.claude-account1/skills/dev/scripts/cleanup.sh"; do
                [[ -f "$_cs" ]] && { _cleanup_script="$_cs"; break; }
            done
            if [[ -n "$_cleanup_script" ]]; then
                echo "🧹 自动执行 cleanup.sh..." >&2
                if (cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" && bash "$_cleanup_script") 2>/dev/null; then
                    _mark_cleanup_done "$dev_mode_file"
                    _devloop_jq -n '{"status":"done","reason":"PR 已合并，cleanup 完成"}'
                    return 0
                else
                    _devloop_jq -n '{"status":"blocked","reason":"PR 已合并，cleanup.sh 执行失败","action":"立即读取 skills/dev/steps/04-ship.md 并执行 Stage 4 Ship"}'
                fi
            else
                _devloop_jq -n '{"status":"blocked","reason":"PR 已合并，未找到 cleanup.sh","action":"立即读取 skills/dev/steps/04-ship.md 并执行 Stage 4 Ship"}'
            fi
            return 2
        fi
    fi

    # ===== 条件 6: CI 通过 + Stage 4 Learning → 执行合并 =====
    local step_4_status
    step_4_status=$(grep "^step_4_ship:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "pending")
    [[ "$step_4_status" == "pending" ]] && \
        step_4_status=$(grep "^step_4_learning:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "pending")

    if [[ "$step_4_status" != "done" ]]; then
        _devloop_jq -n --arg pr "$pr_number" \
            '{"status":"blocked","reason":"CI 通过，Stage 4 Ship 未完成（合并前必须先写 Learning）","action":"立即读取 skills/dev/steps/04-ship.md 并执行 Stage 4，写 Learning + 合并 PR #\($pr)。禁止询问用户。"}'
        return 2
    fi

    # 合并前检查
    local _pms
    _pms=$(gh pr view "$pr_number" --json mergeable,state -q '{m:.mergeable,s:.state}' 2>/dev/null || echo '{}')
    [[ "$(echo "$_pms" | jq -r '.m' 2>/dev/null)" == "CONFLICTING" ]] && {
        _devloop_jq -n --arg pr "$pr_number" '{"status":"blocked","reason":"PR #\($pr) 存在冲突，需要 rebase","action":"解决冲突后重新 push"}'
        return 2; }
    [[ "$(echo "$_pms" | jq -r '.s' 2>/dev/null)" != "OPEN" ]] && {
        _devloop_jq -n --arg pr "$pr_number" '{"status":"blocked","reason":"PR #\($pr) 状态非 OPEN","action":"检查 PR 状态"}'
        return 2; }

    # P0 修复：不自动合并，输出 JSON action 建议用户手动合并
    # 合并失败时由用户处理（不再自动重试）→ return 2
    echo "[devloop-check] PR #$pr_number CI 通过 + Stage 4 完成，建议手动合并" >&2
    local _repo_name=""
    _repo_name=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null || echo "")
    local _pr_url=""
    [[ -n "$_repo_name" ]] && _pr_url="https://github.com/${_repo_name}/pull/${pr_number}"
    _devloop_jq -n --arg pr "$pr_number" --arg url "$_pr_url" \
        '{"status":"ready_to_merge","reason":"PR #\($pr) CI 通过 + Stage 4 完成，可以合并","action":"请手动执行: gh pr merge \($pr) --squash --delete-branch","pr_url":$url}'
    return 0
}

# ============================================================================
# 直接执行入口（会话压缩恢复诊断）
# ============================================================================
devloop_check_main() {
    local search_root
    search_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
    local _found=false

    while IFS= read -r _wt_line; do
        [[ "$_wt_line" == "worktree "* ]] || continue
        local _wt="${_wt_line#worktree }"
        [[ -d "$_wt" ]] || continue
        for _dmf in "$_wt"/.dev-mode.*; do
            [[ -f "$_dmf" ]] || continue
            _found=true
            local _branch _result _status _reason _action
            _branch=$(grep "^branch:" "$_dmf" 2>/dev/null | awk '{print $2}' || echo "")
            echo "=== Cecelia Dev Session Status ===" >&2
            echo "分支: $_branch" >&2
            grep "^step_" "$_dmf" 2>/dev/null | sed 's/^/  /' >&2
            _result=$(devloop_check "$_branch" "$_dmf") || true
            _status=$(echo "$_result" | jq -r '.status // "unknown"' 2>/dev/null || echo "unknown")
            _reason=$(echo "$_result" | jq -r '.reason // ""' 2>/dev/null || echo "")
            _action=$(echo "$_result" | jq -r '.action // ""' 2>/dev/null || echo "")
            echo "状态: $_status" >&2
            [[ -n "$_reason" ]] && echo "原因: $_reason" >&2
            [[ -n "$_action" ]] && echo "下一步: $_action" >&2
        done
    done < <(git -C "$search_root" worktree list --porcelain 2>/dev/null; echo "worktree $search_root")

    [[ "$_found" == "false" ]] && echo "NO_ACTIVE_SESSION" >&2
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    devloop_check_main "$@"
fi
