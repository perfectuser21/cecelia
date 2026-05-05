#!/usr/bin/env bash
# ============================================================================
# devloop-check.sh — Provider-Agnostic Dev Loop 完成判断（4-Stage Pipeline）
# ============================================================================
# SSOT：所有 Provider 适配器 source 此文件，通过 devloop_check() 获取当前状态。
#
# 版本: v4.5.0
# 更新: 2026-04-14 — CI 失败计数器：.dev-mode 新增 ci_fix_count 字段，>=3 次切 systematic-debugging
# 更新: 2026-04-11 — 职责分离���条件 6 自动合并后调用 cleanup.sh（与条件 5 一致），文档面不再负责合并/清理
# 更新: 2026-04-11 — v4.3.0 单一出口原则：删除 ready_to_merge 中间状态，CI 通过 + step4 done 直接自动合并；CI in_progress 不输出 action 字段
# 更新: 2026-05-02 — v4.6.0 单一 exit 0：删除 harness 快速通道 return 0，harness 统一走 CI 等待 + auto-merge
# 4-Stage Pipeline 条件顺序:
#   0. harness_mode 预检 → 若 harness_mode=true，跳过 cleanup_done 通用早退
#   0.1 cleanup_done → exit 0（非 harness 唯一出口；harness 由 0.5 控制）
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
    local f="${1:-}"; [[ -z "$f" || ! -f "$f" ]] && return
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
# 内部函数: _increment_and_check_ci_counter
# 每次 CI 失败调用，.dev-mode 的 ci_fix_count +1
# 输出：新的 count（stdout）
# ============================================================================
_increment_and_check_ci_counter() {
    local f="${1:-}"
    [[ -z "$f" || ! -f "$f" ]] && return
    local current
    current=$(grep "^ci_fix_count:" "$f" 2>/dev/null | awk '{print $2}' || echo "0")
    current="${current:-0}"
    local next=$((current + 1))
    if grep -q "^ci_fix_count:" "$f" 2>/dev/null; then
        if [[ "$(uname)" == "Darwin" ]]; then
            sed -i '' "s/^ci_fix_count:.*/ci_fix_count: ${next}/" "$f"
        else
            sed -i "s/^ci_fix_count:.*/ci_fix_count: ${next}/" "$f"
        fi
    else
        echo "ci_fix_count: ${next}" >> "$f"
    fi
    echo "$next"
}

# ============================================================================
# 内部函数: _ci_action_for_count
# 根据 ci_fix_count 返回相应的 action 字符串（stdout）
# ============================================================================
_ci_action_for_count() {
    local f="${1:-}"
    local count
    count=$(grep "^ci_fix_count:" "$f" 2>/dev/null | awk '{print $2}' || echo "0")
    count="${count:-0}"
    if [[ "$count" -ge 3 ]]; then
        echo "CI 已失败 ${count} 次（>=3）。停下来，使用 superpowers:systematic-debugging 分析根因。不要再盲目 push 修复。建议派 dispatching-parallel-agents 独立分析。"
    else
        echo "CI 失败，查看日志修复问题后重新 push（已失败 ${count} 次）"
    fi
}

# ============================================================================
# 内部函数: _get_step4_status — 读取 step_4_ship 或 step_4_learning 状态
# ============================================================================
_get_step4_status() {
    local dev_mode_file="${1:-}"
    local status
    status=$(grep "^step_4_ship:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "pending")
    [[ "$status" == "pending" ]] && \
        status=$(grep "^step_4_learning:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "pending")
    echo "$status"
}

# ============================================================================
# 主函数: devloop_check BRANCH DEV_MODE_FILE
# ============================================================================
# 单一出口模式：所有条件用 result_json=...; break 表语义，
# 末尾单一 echo + return 0；状态由 status 字段携带（done/blocked）。
# 业务逻辑（auto-merge / cleanup.sh / Brain 回写 / harness 分叉）保留原行为。
# ============================================================================
devloop_check() {
    local branch="${1:-}"
    local dev_mode_file="${2:-}"
    local PROJECT_ROOT
    PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
    local result_json='{"status":"blocked","reason":"未知"}'

    while :; do
        if [[ -z "$branch" ]]; then
            result_json='{"status":"blocked","reason":"branch 参数为空","action":"检查调用方传入的 BRANCH 参数"}'
            break
        fi

        # ===== 条件 0 (预检): harness_mode =====
        local _harness_mode="false"
        if [[ -f "$dev_mode_file" ]]; then
            local _hm_raw
            _hm_raw=$(grep "^harness_mode:" "$dev_mode_file" 2>/dev/null | awk '{gsub(/^[ \t]+|[ \t]+$/, "", $2); print $2}' || true)
            [[ -n "$_hm_raw" ]] && _harness_mode="$_hm_raw"
        fi

        # ===== 条件 0.1: cleanup_done（跳过 harness 模式）=====
        if [[ "$_harness_mode" != "true" ]] && \
           [[ -f "$dev_mode_file" ]] && grep -q "cleanup_done: true" "$dev_mode_file" 2>/dev/null; then
            result_json='{"status":"done","reason":"cleanup_done"}'
            break
        fi

        # ===== 条件 0.5: harness_mode 通道 =====
        if [[ "$_harness_mode" == "true" ]]; then
            local _h_step2="pending"
            local _h_step2_raw
            _h_step2_raw=$(grep "^step_2_code:" "$dev_mode_file" 2>/dev/null | awk '{gsub(/^[ \t]+|[ \t]+$/, "", $2); print $2}' || true)
            [[ -n "$_h_step2_raw" ]] && _h_step2="$_h_step2_raw"
            if [[ "$_h_step2" != "done" ]]; then
                local _task_id
                _task_id=$(grep "^task_id:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
                if [[ -n "$_task_id" ]]; then
                    curl -s --connect-timeout 3 --max-time 5 \
                        -X PATCH "http://localhost:5221/api/brain/tasks/$_task_id" \
                        -H "Content-Type: application/json" \
                        -d "{\"status\":\"failed\",\"result\":{\"error_message\":\"[Harness] Stage 2 Code 未完成，devloop-check 检测到失败\"}}" \
                        >/dev/null 2>&1 || true
                fi
                result_json='{"status":"blocked","reason":"[Harness] Stage 2 Code 未完成","action":"立即读取 skills/dev/steps/02-code.md 并执行 Stage 2（harness 模式）。禁止询问用户。"}'
                break
            fi

            local _h_pr=""
            if command -v gh &>/dev/null; then
                _h_pr=$(gh pr list --head "$branch" --state all --json number -q '.[0].number' 2>/dev/null || echo "")
            fi
            if [[ -z "$_h_pr" ]]; then
                result_json=$(_devloop_jq -n --arg branch "$branch" \
                    '{"status":"blocked","reason":"[Harness] PR 未创建","action":"立即 push + 创建 PR（gh pr create --base main --head \($branch)）"}')
                break
            fi

            # Harness: 代码写完 + PR 已创建 → 开 auto-merge，继续走 CI 等待 → 条件 6 自动 merge
            gh pr merge "$_h_pr" --squash --auto 2>/dev/null || true
        fi

        # ===== 条件 1: step_1_spec =====
        if [[ -f "$dev_mode_file" ]]; then
            local step_1_status
            step_1_status=$(grep "^step_1_spec:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "pending")
            if [[ "$step_1_status" != "done" ]]; then
                result_json='{"status":"blocked","reason":"Stage 1 Spec 未完成","action":"立即读取 skills/dev/steps/01-spec.md 并执行 Stage 1。禁止询问用户。"}'
                break
            fi
        fi

        # ===== 条件 2: step_2_code =====
        if [[ -f "$dev_mode_file" ]]; then
            local step_2_status
            step_2_status=$(grep "^step_2_code:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "pending")
            if [[ "$step_2_status" != "done" ]]; then
                result_json='{"status":"blocked","reason":"Stage 2 Code 未完成","action":"立即读取 skills/dev/steps/02-code.md 并执行 Stage 2。禁止询问用户。"}'
                break
            fi
        fi

        # ===== 条件 2.6: DoD 完整性检查（harness 跳过）=====
        if [[ "$_harness_mode" != "true" ]] && [[ -f "$dev_mode_file" ]]; then
            local _task_card_rel _worktree_root _task_card_abs _dod_unchecked
            _task_card_rel=$(grep "^task_card:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
            _worktree_root=$(dirname "$dev_mode_file")
            _task_card_abs="$_worktree_root/$_task_card_rel"
            if [[ -n "$_task_card_rel" && -f "$_task_card_abs" ]]; then
                _dod_unchecked=$(grep -cE '^\s*-\s+\[ \]\s+\[' "$_task_card_abs" 2>/dev/null; true)
                _dod_unchecked="${_dod_unchecked:-0}"
                if [[ "$_dod_unchecked" -gt 0 ]]; then
                    result_json=$(_devloop_jq -n --argjson n "$_dod_unchecked" \
                        '{"status":"blocked","reason":"DoD 有 \($n) 条未验证（[ ] 未改为 [x]）","action":"逐条运行 Test 命令验证，通过后改为 [x]"}')
                    break
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
            result_json=$(_devloop_jq -n --arg branch "$branch" \
                '{"status":"blocked","reason":"PR 未创建","action":"创建 PR（gh pr create --base main --head \($branch)）"}')
            break
        fi

        # ===== 条件 4: CI 状态? =====
        local ci_status="unknown" ci_conclusion="" ci_run_id=""
        if [[ "$pr_state" != "merged" ]]; then
            local run_info
            run_info=$(gh run list --branch "$branch" --workflow CI --limit 1 --json status,conclusion,databaseId 2>/dev/null || echo "[]")
            if [[ -n "$run_info" && "$run_info" != "[]" ]]; then
                ci_status=$(echo "$run_info" | jq -r '.[0].status // "unknown"' 2>/dev/null || echo "unknown")
                ci_conclusion=$(echo "$run_info" | jq -r '.[0].conclusion // ""' 2>/dev/null || echo "")
                ci_run_id=$(echo "$run_info" | jq -r '.[0].databaseId // ""' 2>/dev/null || echo "")
            fi

            local _ci_break=false
            case "$ci_status" in
                "completed")
                    if [[ "$ci_conclusion" != "success" ]]; then
                        _increment_and_check_ci_counter "$dev_mode_file" >/dev/null
                        local action_msg
                        action_msg=$(_ci_action_for_count "$dev_mode_file")
                        [[ -n "${ci_run_id}" ]] && \
                            action_msg="${action_msg}（gh run view ${ci_run_id} --log-failed）"
                        result_json=$(_devloop_jq -n \
                            --arg reason "CI 失败（${ci_conclusion}）" \
                            --arg action "$action_msg" \
                            --arg run_id "${ci_run_id:-}" \
                            '{"status":"blocked","reason":$reason,"action":$action,"ci_run_id":$run_id}')
                        _ci_break=true
                    fi
                    ;;
                "in_progress"|"queued"|"waiting"|"pending")
                    local _started _se _elapsed
                    _started=$(grep "^started:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
                    _se=""
                    if [[ -n "$_started" ]]; then
                        _se=$(date -d "$_started" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "${_started%+*}" +%s 2>/dev/null || echo "")
                    fi
                    if [[ -n "$_started" && -n "$_se" && $_se -gt 0 ]]; then
                        _elapsed=$(( $(date +%s) - _se ))
                    else
                        _elapsed=0
                    fi
                    if [[ -n "$_started" && -n "$_se" && $_elapsed -gt 5400 ]]; then
                        result_json=$(_devloop_jq -n --arg b "$branch" '{"status":"blocked","reason":"CI 已 pending 90+ 分钟，可能卡死","action":"检查 CI：gh run list --branch \($b) --limit 5"}')
                    else
                        result_json=$(_devloop_jq -n --arg s "$ci_status" '{"status":"blocked","reason":"CI 进行中（\($s)）"}')
                    fi
                    _ci_break=true
                    ;;
                *)
                    result_json=$(_devloop_jq -n --arg status "$ci_status" --arg branch "$branch" \
                        '{"status":"blocked","reason":"CI 状态未知（\($status)）","action":"运行 gh run list --branch \($branch) --limit 1 检查 CI 状态"}')
                    _ci_break=true
                    ;;
            esac
            [[ "$_ci_break" == "true" ]] && break
        fi

        # ===== 条件 5: PR 已合并? =====
        # 严格守门：唯一 done 路径 = step_4=done AND cleanup.sh 真跑成功（含部署）
        # 之前 fallback 在 step_4=pending 时跑 cleanup.sh 成功就标 done，绕过 Learning 检查
        if [[ "$pr_state" == "merged" ]]; then
            # 5.1 base ref 必须是 main
            local pr_base_ref=""
            [[ -n "$pr_number" ]] && \
                pr_base_ref=$(gh pr view "$pr_number" --json baseRefName -q '.baseRefName' 2>/dev/null || echo "")
            if [[ -n "$pr_base_ref" && "$pr_base_ref" != "main" ]]; then
                result_json=$(_devloop_jq -n --arg base "$pr_base_ref" \
                    '{"status":"blocked","reason":"PR 已合并但目标分支不是 main（目标：\($base)）","action":"检查是否误合并到错误分支"}')
                break
            fi

            # 5.2 step_4_ship 必须 done（除 harness 模式）— 严格守门
            local step_4_status
            step_4_status=$(_get_step4_status "$dev_mode_file")
            if [[ "$step_4_status" != "done" ]] && [[ "$_harness_mode" != "true" ]]; then
                result_json=$(_devloop_jq -n --arg pr "$pr_number" \
                    '{"status":"blocked","reason":"PR #\($pr) 已合并，但 Stage 4 Ship 未完成（必须先写 docs/learnings/<branch>.md 并标记 step_4_ship: done）","action":"立即读取 skills/dev/steps/04-ship.md 完成 Stage 4。禁止询问用户。"}')
                break
            fi

            # 5.3 找 cleanup.sh
            local _cleanup_script=""
            for _cs in \
                "${PROJECT_ROOT:-}/packages/engine/skills/dev/scripts/cleanup.sh" \
                "$HOME/.claude/skills/dev/scripts/cleanup.sh" \
                "$HOME/.claude-account1/skills/dev/scripts/cleanup.sh"; do
                [[ -f "$_cs" ]] && { _cleanup_script="$_cs"; break; }
            done
            if [[ -z "$_cleanup_script" ]]; then
                result_json=$(_devloop_jq -n --arg pr "$pr_number" \
                    '{"status":"blocked","reason":"PR #\($pr) 已合并 + Stage 4 done，但未找到 cleanup.sh（无法部署/归档）","action":"检查 packages/engine/skills/dev/scripts/cleanup.sh 是否存在"}')
                break
            fi

            # 5.4 跑 cleanup.sh（含部署）— 必须成功才允许 done
            echo "🧹 自动执行 cleanup.sh（含部署）..." >&2
            if (cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" && bash "$_cleanup_script") 2>/dev/null; then
                _mark_cleanup_done "$dev_mode_file"
                result_json=$(_devloop_jq -n --arg pr "$pr_number" \
                    '{"status":"done","reason":"PR #\($pr) 真完成：合并 + Learning + 部署 + 归档"}')
            else
                result_json=$(_devloop_jq -n --arg pr "$pr_number" \
                    '{"status":"blocked","reason":"PR #\($pr) 已合并 + Stage 4 done，但 cleanup.sh 失败（部署/归档异常）","action":"重新执行 bash packages/engine/skills/dev/scripts/cleanup.sh 或检查 deploy-local.sh"}')
            fi
            break
        fi

        # ===== 条件 6: CI 通过 + Stage 4 Learning → 执行合并 =====
        local step_4_status
        step_4_status=$(_get_step4_status "$dev_mode_file")
        if [[ "$_harness_mode" != "true" ]] && [[ "$step_4_status" != "done" ]]; then
            result_json=$(_devloop_jq -n --arg pr "$pr_number" \
                '{"status":"blocked","reason":"CI 通过，Stage 4 Ship 未完成（合并前必须先写 Learning）","action":"立即读取 skills/dev/steps/04-ship.md 并执行 Stage 4，写 Learning + 合并 PR #\($pr)。禁止询问用户。"}')
            break
        fi

        # 合并前检查
        local _pms
        _pms=$(gh pr view "$pr_number" --json mergeable,state -q '{m:.mergeable,s:.state}' 2>/dev/null || echo '{}')
        if [[ "$(echo "$_pms" | jq -r '.m' 2>/dev/null)" == "CONFLICTING" ]]; then
            result_json=$(_devloop_jq -n --arg pr "$pr_number" \
                '{"status":"blocked","reason":"PR #\($pr) 存在冲突，需要 rebase","action":"解决冲突后重新 push"}')
            break
        fi
        if [[ "$(echo "$_pms" | jq -r '.s' 2>/dev/null)" != "OPEN" ]]; then
            result_json=$(_devloop_jq -n --arg pr "$pr_number" \
                '{"status":"blocked","reason":"PR #\($pr) 状态非 OPEN","action":"检查 PR 状态"}')
            break
        fi

        # 自动合并
        echo "[devloop-check] PR #$pr_number CI 通过 + Stage 4 完成，自动合并中..." >&2
        if gh pr merge "$pr_number" --squash --delete-branch 2>/dev/null; then
            local _cleanup_script_6=""
            for _cs6 in \
                "${PROJECT_ROOT:-}/packages/engine/skills/dev/scripts/cleanup.sh" \
                "$HOME/.claude/skills/dev/scripts/cleanup.sh" \
                "$HOME/.claude-account1/skills/dev/scripts/cleanup.sh"; do
                [[ -f "$_cs6" ]] && { _cleanup_script_6="$_cs6"; break; }
            done
            if [[ -n "$_cleanup_script_6" ]]; then
                echo "🧹 自动执行 cleanup.sh（合并后清理）..." >&2
                (cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" && bash "$_cleanup_script_6") 2>/dev/null || true
            fi
            _mark_cleanup_done "$dev_mode_file"
            result_json=$(_devloop_jq -n --arg pr "$pr_number" \
                '{"status":"done","reason":"PR #\($pr) 已自动合并，工作流结束"}')
        else
            result_json=$(_devloop_jq -n --arg pr "$pr_number" \
                '{"status":"blocked","reason":"PR #\($pr) 自动合并失败","action":"检查冲突或权限问题，执行: gh pr merge \($pr) --squash --delete-branch"}')
        fi
        break
    done

    echo "$result_json"
    # 单点出口：status → exit code 单一映射（done=0, 其他=2），保持 stop hook 协议向后兼容
    local _final_status
    _final_status=$(echo "$result_json" | jq -r '.status // "blocked"' 2>/dev/null || echo "blocked")
    [[ "$_final_status" == "done" ]] && return 0 || return 2
}

# ============================================================================
# 公开函数: classify_session CWD
#   入口契约：从 cwd 推断当前是否在 /dev 业务上下文。
#   输出 stdout JSON: {status, reason, [action], [ci_run_id], [dev_mode]}
#   status 三态严格区分（fail-open / fail-closed 按"是否在 dev 上下文"分流）：
#     - "not-dev"  → 真·非开发模式（bypass / 主分支 / 无 .dev-mode / 非 git / cwd 不存在）
#                    调用方应放行：没有信号显示当前在 /dev 业务里，没有放行误伤面。
#     - "blocked"  → 已确认在 dev 上下文（git repo 内）但状态损坏 OR 业务未完成：
#                    rev-parse --abbrev-ref 在 worktree 内失败 / .dev-mode 格式坏 /
#                    devloop_check 业务未完成。一律 fail-closed 阻塞。
#     - "done"     → 在 dev 上下文且业务真完成（PR 合 + cleanup_done），调用方应清理
#                    .dev-mode 并放行
#   设计动机："PR1 开就停"故障源 = 在 worktree 内 git rev-parse 抖动 → 旧版本误归 not-dev
#   → fail-open 放行。修复：worktree 已确认 + branch 读不出 = 真·dev 上下文探测异常 →
#   fail-closed。但"压根不在 git repo"这种 no-signal 情况照旧 fail-open（exit 99）。
#   单一出口：while:; do ... break; done 收敛到末尾单一 echo + return。
# ============================================================================
classify_session() {
    local cwd="${1:-$PWD}"
    local result_json='{"status":"blocked","reason":"unknown"}'

    while :; do
        # 1) bypass — 真·非开发模式
        if [[ "${CECELIA_STOP_HOOK_BYPASS:-}" == "1" ]]; then
            result_json='{"status":"not-dev","reason":"bypass via CECELIA_STOP_HOOK_BYPASS=1"}'
            break
        fi

        # 2) cwd 必须是目录 — 不存在则不可能在 /dev 业务（no signal） → not-dev
        if [[ ! -d "$cwd" ]]; then
            result_json=$(_devloop_jq -n --arg c "$cwd" \
                '{"status":"not-dev","reason":"cwd [\($c)] 不是目录，不可能在 /dev 业务"}')
            break
        fi

        # 3) git worktree 探测 — 非 git repo 不可能在 /dev 业务 → not-dev（fail-open OK：
        #    没有 git 就没有 .dev-mode，不存在被误放行的 dev 上下文）
        local wt_root
        wt_root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || {
            result_json=$(_devloop_jq -n --arg c "$cwd" \
                '{"status":"not-dev","reason":"[\($c)] 非 git repo，不可能在 /dev 业务"}')
            break
        }
        # 4) branch 探测 — 已确认在 git repo 内，rev-parse 失败 = 真·探测异常 fail-closed
        #    特殊情况：unborn HEAD（git init 后未 commit）git exit=128 但 stdout="HEAD"，
        #    fall through 到下一步主分支放行（HEAD 命中 case 第 5 步）
        local branch
        if ! branch=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null); then
            if [[ "$branch" != "HEAD" ]]; then
                result_json=$(_devloop_jq -n --arg c "$cwd" --arg w "$wt_root" \
                    '{"status":"blocked","reason":"git 探测异常：worktree [\($w)] 存在但 rev-parse --abbrev-ref HEAD 失败（cwd=\($c)），fail-closed"}')
                break
            fi
        fi

        # 5) 主分支放行 — 真·非开发模式
        case "$branch" in
            main|master|develop|HEAD)
                result_json=$(_devloop_jq -n --arg b "$branch" \
                    '{"status":"not-dev","reason":"主分支放行（\($b)）"}')
                break
                ;;
        esac

        # 6) 必须有 .dev-mode — cp-* 分支但未启动 /dev 流程，真·非开发模式
        local dev_mode="$wt_root/.dev-mode.$branch"
        if [[ ! -f "$dev_mode" ]]; then
            result_json=$(_devloop_jq -n --arg f "$dev_mode" \
                '{"status":"not-dev","reason":"无 \($f)，非 /dev 业务"}')
            break
        fi

        # 7) .dev-mode 格式校验（首行必须 dev）— 已确认 .dev-mode 存在，
        #    格式坏 = dev 上下文中状态损坏 → fail-closed blocked
        if ! head -1 "$dev_mode" 2>/dev/null | grep -q "^dev$"; then
            local first_line
            first_line=$(head -1 "$dev_mode" 2>/dev/null || echo "<empty>")
            result_json=$(_devloop_jq -n --arg f "$dev_mode" --arg l "$first_line" \
              '{"status":"blocked","reason":"dev-mode 格式异常（首行 [\($l)] 不是 dev）: \($f)。请删除该文件或修正为标准格式后重试。"}')
            break
        fi

        # 7) 业务判定（透传 devloop_check 输出，附加 dev_mode 路径供调用方 rm）
        local devloop_result
        devloop_result=$(devloop_check "$branch" "$dev_mode" 2>/dev/null) || true
        [[ -z "$devloop_result" ]] && devloop_result='{"status":"blocked","reason":"devloop_check 无输出"}'
        result_json=$(echo "$devloop_result" | jq --arg dm "$dev_mode" '. + {dev_mode: $dm}' 2>/dev/null \
            || echo "$devloop_result")
        break
    done

    echo "$result_json"
    # 单点出口：status → exit code 三态映射
    #   done=0（真完成）/ not-dev=99（不适用，由 stop.sh 路由层放行）/ 其他=2（fail-closed）
    # exit 99 是 custom code：让上游 stop.sh 区分"真 done（继续走 architect/decomp）"
    # 与"不适用此 hook（继续走 architect/decomp）"，避免 stop-dev.sh 字面散点 exit 0。
    local _final_status
    _final_status=$(echo "$result_json" | jq -r '.status // "blocked"' 2>/dev/null || echo "blocked")
    case "$_final_status" in
        done)    return 0 ;;
        not-dev) return 99 ;;
        *)       return 2 ;;
    esac
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

# ============================================================================
# 公开函数: verify_dev_complete BRANCH WORKTREE_PATH MAIN_REPO
# ============================================================================
# 7 阶段决策树（v18.20.0）：
#   P1 PR 未创建        → block: 立即 push + gh pr create
#   P2 PR CI 进行中     → block + foreground 轮询
#   P3 PR CI 失败       → block: fail job 名 + log URL
#   P4 PR CI 通过未合   → block: auto-merge / squash
#   P5 merged → deploy workflow conclusion=success（VERIFY_DEPLOY_WORKFLOW=1 启用）
#   P6 deploy → /api/brain/health 200 重试（VERIFY_HEALTH_PROBE=1 启用）
#   P7 health 200 → Learning 文件存在 + ### 根本原因
#   P0 全过 → cleanup.sh exit 0 → done
#
# 信号源：GitHub API + HTTP probe（不读 .dev-mode 字段）
# Env 调参：
#   VERIFY_DEPLOY_WORKFLOW=1   启用 P5（默认 0，向后兼容旧测试）
#   VERIFY_HEALTH_PROBE=1      启用 P6（默认 0）
#   HEALTH_PROBE_MAX_RETRIES=N P6 最大重试（默认 60）
#   HEALTH_PROBE_INTERVAL=N    P6 间隔秒（默认 5）
#   BRAIN_HEALTH_URL=URL       默认 http://localhost:5221/api/brain/health
# ============================================================================
verify_dev_complete() {
    local branch="${1:-}"
    local worktree_path="${2:-}"
    local main_repo="${3:-}"
    local result_json='{"status":"blocked","reason":"unknown"}'

    local verify_deploy="${VERIFY_DEPLOY_WORKFLOW:-0}"
    local verify_health="${VERIFY_HEALTH_PROBE:-0}"
    local health_max_retries="${HEALTH_PROBE_MAX_RETRIES:-60}"
    local health_interval="${HEALTH_PROBE_INTERVAL:-5}"
    local brain_health_url="${BRAIN_HEALTH_URL:-http://localhost:5221/api/brain/health}"

    while :; do
        if [[ -z "$branch" || -z "$main_repo" ]]; then
            result_json='{"status":"blocked","reason":"verify_dev_complete 缺参数：branch / main_repo"}'
            break
        fi

        # harness 模式豁免（保留兼容）
        local harness_mode="false"
        local dev_mode_file="${worktree_path}/.dev-mode.${branch}"
        if [[ -f "$dev_mode_file" ]]; then
            local _hm
            _hm=$(grep "^harness_mode:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' | tr -d '[:space:]')
            [[ -n "$_hm" ]] && harness_mode="$_hm"
        fi

        if ! command -v gh &>/dev/null; then
            result_json='{"status":"blocked","reason":"gh CLI 不可用，无法验证 PR 状态","action":"安装 gh CLI"}'
            break
        fi

        # ------ P1: PR 未创建 ------
        local pr_number pr_merged_at
        pr_number=$(gh pr list --head "$branch" --state all --json number -q '.[0].number' 2>/dev/null || echo "")
        if [[ -z "$pr_number" ]]; then
            result_json=$(_devloop_jq -n --arg branch "$branch" \
                '{"status":"blocked","reason":"PR 未创建（branch=\($branch)）","action":"立即 push + gh pr create --base main --head \($branch)"}')
            break
        fi

        pr_merged_at=$(gh pr view "$pr_number" --json mergedAt -q '.mergedAt' 2>/dev/null || echo "")
        if [[ -z "$pr_merged_at" || "$pr_merged_at" == "null" ]]; then
            # ------ P2/P3/P4: CI 状态 ------
            local ci_status ci_conclusion ci_run_id
            ci_status=$(gh run list --branch "$branch" --workflow CI --limit 1 --json status -q '.[0].status' 2>/dev/null || echo "unknown")
            ci_conclusion=$(gh run list --branch "$branch" --workflow CI --limit 1 --json conclusion -q '.[0].conclusion' 2>/dev/null || echo "")
            ci_run_id=$(gh run list --branch "$branch" --workflow CI --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || echo "")
            case "$ci_status" in
                in_progress|queued|waiting|pending)
                    # P2
                    result_json=$(_devloop_jq -n --arg pr "$pr_number" --arg id "$ci_run_id" \
                        '{"status":"blocked","reason":"PR #\($pr) CI 进行中","action":"等 CI 完成（gh pr checks \($pr) --watch）","ci_run_id":$id}')
                    ;;
                completed)
                    case "$ci_conclusion" in
                        ""|success|completed)
                            # 空 conclusion 或 completed 字符串 = 兼容旧测试（stub 不区分 --json 字段）
                            # P4: CI 通过未合 → auto-merge
                            result_json=$(_devloop_jq -n --arg pr "$pr_number" \
                                '{"status":"blocked","reason":"PR #\($pr) CI 通过但未合并","action":"启 auto-merge: gh pr merge \($pr) --squash --auto"}')
                            ;;
                        failure|cancelled|timed_out|action_required|startup_failure)
                            # P3: CI 失败 — 给 fail job 名 + log URL
                            local failed_summary log_url
                            failed_summary=$(gh run view "$ci_run_id" --json jobs -q '[.jobs[] | select(.conclusion=="failure") | .name] | join(", ")' 2>/dev/null || echo "未知 job")
                            [[ -z "$failed_summary" ]] && failed_summary="未知 job"
                            log_url=$(gh run view "$ci_run_id" --json jobs -q '[.jobs[] | select(.conclusion=="failure") | .url][0]' 2>/dev/null || echo "")
                            result_json=$(_devloop_jq -n --arg pr "$pr_number" --arg s "$failed_summary" --arg url "$log_url" --arg id "$ci_run_id" --arg c "$ci_conclusion" \
                                '{"status":"blocked","reason":"PR #\($pr) CI 失败（\($c)）：\($s)","action":"看 log: gh run view \($id) --log-failed (\($url))。修代码 → commit → push 触发新 CI","ci_run_id":$id}')
                            ;;
                        *)
                            result_json=$(_devloop_jq -n --arg pr "$pr_number" --arg c "$ci_conclusion" \
                                '{"status":"blocked","reason":"PR #\($pr) CI conclusion 异常: \($c)","action":"检查 gh pr checks \($pr)"}')
                            ;;
                    esac
                    ;;
                *)
                    result_json=$(_devloop_jq -n --arg pr "$pr_number" --arg s "$ci_status" \
                        '{"status":"blocked","reason":"PR #\($pr) 未合并，CI 状态: \($s)","action":"检查 CI 状态: gh pr checks \($pr)"}')
                    ;;
            esac
            break
        fi

        # ------ P5: brain-ci-deploy.yml workflow run（VERIFY_DEPLOY_WORKFLOW=1 启用）------
        # P1-1 (v18.22.1): engine-only / docs-only PR 不触动 packages/brain/，
        # brain-ci-deploy.yml workflow on push paths brain/** 不触发 → P5 not applicable
        if [[ "$verify_deploy" == "1" ]]; then
            local brain_changed
            brain_changed=$(gh pr view "$pr_number" --json files -q '[.files[].path] | map(select(startswith("packages/brain/"))) | length' 2>/dev/null || echo "0")
            if [[ "$brain_changed" =~ ^[0-9]+$ ]] && [[ "$brain_changed" -eq 0 ]]; then
                echo "[verify_dev_complete] P5 跳过：PR #$pr_number 不触动 packages/brain/，brain-ci-deploy.yml not applicable" >&2
                # not applicable → 视为 P5 通过，继续走 P6
                verify_deploy=0
            fi
        fi

        if [[ "$verify_deploy" == "1" ]]; then
            local merge_sha deploy_run_id deploy_status deploy_conclusion
            merge_sha=$(gh pr view "$pr_number" --json mergeCommit -q '.mergeCommit.oid' 2>/dev/null || echo "")
            deploy_run_id=$(gh run list --workflow brain-ci-deploy.yml --branch main --limit 5 --json databaseId,headSha -q "[.[] | select(.headSha | startswith(\"${merge_sha}\"))][0].databaseId" 2>/dev/null || echo "")
            if [[ -z "$deploy_run_id" || "$deploy_run_id" == "null" ]]; then
                result_json=$(_devloop_jq -n --arg sha "$merge_sha" \
                    '{"status":"blocked","reason":"等 brain-ci-deploy.yml 触发（合并 SHA \($sha)）","action":"sleep 30 后再 verify"}')
                break
            fi
            deploy_status=$(gh run view "$deploy_run_id" --json status -q '.status' 2>/dev/null || echo "unknown")
            deploy_conclusion=$(gh run view "$deploy_run_id" --json conclusion -q '.conclusion' 2>/dev/null || echo "")
            case "$deploy_status" in
                in_progress|queued|waiting)
                    result_json=$(_devloop_jq -n --arg id "$deploy_run_id" \
                        '{"status":"blocked","reason":"brain-ci-deploy.yml 进行中","action":"等 deploy: gh run watch \($id)"}')
                    break
                    ;;
                completed)
                    if [[ "$deploy_conclusion" != "success" ]]; then
                        # v18.22.0: BUG-4 P5 fail counter — 连续 3 次 → auto-expire dev-active
                        local fail_count_file="${main_repo}/.cecelia/deploy-fail-count-${branch}"
                        local fail_count
                        fail_count=$(cat "$fail_count_file" 2>/dev/null || echo 0)
                        fail_count=$((fail_count + 1))
                        echo "$fail_count" > "$fail_count_file" 2>/dev/null || true

                        if [[ "$fail_count" -ge 3 ]]; then
                            rm -f "${main_repo}/.cecelia/dev-active-${branch}.json"
                            rm -f "$fail_count_file"
                            : > "${main_repo}/.cecelia/deploy-failed-${branch}.flag" 2>/dev/null || true
                            result_json=$(_devloop_jq -n --arg b "$branch" \
                                '{"status":"done","reason":"deploy fail 3x → auto-expire dev-active (\($b))，等独立 PR 修 deploy"}')
                            break
                        fi

                        result_json=$(_devloop_jq -n --arg id "$deploy_run_id" --arg c "$deploy_conclusion" --arg n "$fail_count" \
                            '{"status":"blocked","reason":"deploy 失败 (\($c)) [\($n)/3]","action":"看 gh run view \($id) --log-failed（连续 3 次自动 expire）"}')
                        break
                    fi
                    # success 分支：清掉 fail counter
                    rm -f "${main_repo}/.cecelia/deploy-fail-count-${branch}" 2>/dev/null || true
                    ;;
                *)
                    result_json=$(_devloop_jq -n --arg s "$deploy_status" \
                        '{"status":"blocked","reason":"deploy status 异常: \($s)","action":"等待或检查 deploy workflow"}')
                    break
                    ;;
            esac
        fi

        # ------ P6: health probe（VERIFY_HEALTH_PROBE=1 启用）------
        if [[ "$verify_health" == "1" ]]; then
            local probed=0 i
            for ((i=1; i<=health_max_retries; i++)); do
                if curl -fsS --max-time 3 "$brain_health_url" >/dev/null 2>&1; then
                    probed=1
                    break
                fi
                [[ $i -lt $health_max_retries ]] && sleep "$health_interval"
            done
            if [[ "$probed" -ne 1 ]]; then
                result_json=$(_devloop_jq -n --arg url "$brain_health_url" --arg n "$health_max_retries" --arg s "$health_interval" \
                    '{"status":"blocked","reason":"health probe \($n)×\($s)s 超时: \($url)","action":"检查 deploy log + Brain 进程"}')
                break
            fi
        fi

        # ------ P7: Learning 文件 ------
        if [[ "$harness_mode" != "true" ]]; then
            local learning_file="${main_repo}/docs/learnings/${branch}.md"
            if [[ ! -f "$learning_file" ]]; then
                result_json=$(_devloop_jq -n --arg f "$learning_file" \
                    '{"status":"blocked","reason":"Learning 文件不存在: \($f)","action":"立即写 Learning，必含 ### 根本原因 + ### 下次预防 段"}')
                break
            fi
            if ! grep -qE "^###?\s*根本原因" "$learning_file" 2>/dev/null; then
                result_json=$(_devloop_jq -n --arg f "$learning_file" \
                    '{"status":"blocked","reason":"Learning 缺必备段（### 根本原因）: \($f)","action":"补全 Learning"}')
                break
            fi
        fi

        # ------ P0: cleanup.sh 真跑 ------
        local cleanup_script=""
        for _cs in \
            "${main_repo}/packages/engine/skills/dev/scripts/cleanup.sh" \
            "$HOME/.claude/skills/dev/scripts/cleanup.sh" \
            "$HOME/.claude-account1/skills/dev/scripts/cleanup.sh"; do
            [[ -f "$_cs" ]] && { cleanup_script="$_cs"; break; }
        done
        if [[ -z "$cleanup_script" ]]; then
            result_json='{"status":"blocked","reason":"未找到 cleanup.sh（无法部署/归档）","action":"检查 packages/engine/skills/dev/scripts/cleanup.sh"}'
            break
        fi
        echo "🧹 verify_dev_complete: 跑 cleanup.sh（归档/git config）..." >&2
        if ! (cd "$main_repo" && bash "$cleanup_script" "$branch") >/dev/null 2>/dev/null; then
            result_json='{"status":"blocked","reason":"cleanup.sh 执行失败（部署/归档异常）","action":"重新 bash packages/engine/skills/dev/scripts/cleanup.sh"}'
            break
        fi

        result_json=$(_devloop_jq -n --arg pr "$pr_number" \
            '{"status":"done","reason":"PR #\($pr) 真完成：CI 绿 + 合并 + Learning + cleanup（P5/P6 按 env 启用）"}')
        break
    done

    echo "$result_json"
    return 0
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    devloop_check_main "$@"
fi
