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
# 版本: v3.6.0
# 创建: 2026-03-13
# 更新: 2026-03-20 — 4-Stage Pipeline 重构
# 更新: 2026-03-21 — Pipeline 死锁修复（#1286/#1294）
# 更新: 2026-03-22 — spec_review/code_review_gate 改为 Agent subagent 同步审查（原 Codex 异步 Gate 改为同步）
# 更新: 2026-03-22 — 加回条件 1.5/2.5：读 .dev-mode 中 subagent 写入的 status 字段（不查 Brain API）
# 更新: 2026-03-22 — 清理误导性注释，blocked 状态为 subagent FAIL 写入，需分析 root cause 修复
# 更新: 2026-03-22 — P0 修复：cleanup 失败后加 return 2 触发重试，避免 PR 合并后工作流卡死
# 更新: 2026-03-22 — P0 安全：seal 文件机制（#seal-gate），条件 1.5/2.5 读 seal 文件，自认证检测
# 更新: 2026-03-30 — 移除条件 4.5：Playwright Evaluator（改为 post-merge 触发）
# 更新: 2026-03-30 — 新增条件 1.6/2.8：Planner→Generator seal 三阶段对齐检查
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
#   条件 1.6: planner seal 文件验证（Sprint Contract 前置检查）
#     → .dev-gate-planner.{branch} 存在 → 继续
#     → 不存在 → exit 2（Planner subagent 尚未完成，禁止进入 Stage 2）
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
#   条件 2.8: generator seal 文件验证（Stage 3 前置检查）
#     → .dev-gate-generator.{branch} 存在 → 继续
#     → 不存在 → exit 2（Generator subagent 尚未完成，禁止进入 Stage 3）
#
#   PR 创建了?
#   CI 过了?
#
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
# check_divergence_count: 检查 Evaluator 独立性门禁
# ============================================================================
# 参数: $1 = divergence_count（Evaluator 独立发现的问题数，与 Planner 的分歧数）
# 返回: 0 = 通过（count >= 1，Evaluator 真正独立思考）
#       1 = 拒绝（count == 0，Evaluator 是橡皮图章）
#
# divergence_count = Evaluator 独立发现的、Planner 未发现的问题数量
# >= 1 证明 Evaluator 真正挑战了 Planner（不是无脑认可）
# == 0 说明 Evaluator 没有任何独立判断，形同虚设
check_divergence_count() {
    local count=${1:-0}
    [[ "$count" -ge 1 ]]
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
    # LITE 模式豁免：task_track=lite 且 .dev-gate-lite.{branch} 存在 → 跳过此条件
    if [[ -f "$dev_mode_file" ]]; then
        local _task_track_15
        _task_track_15=$(grep "^task_track:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "full")
        local _lite_seal_15
        _lite_seal_15="$(dirname "$dev_mode_file")/.dev-gate-lite.${branch}"
        if [[ "$_task_track_15" == "lite" && -f "$_lite_seal_15" ]]; then
            # LITE mode: 跳过 spec_review seal check（Planner/Sprint Contract 未运行）
            :
        else
        local spec_review_status spec_seal_file spec_seal_verdict
        spec_review_status=$(grep "^spec_review_status:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
        spec_seal_file="$(dirname "$dev_mode_file")/.dev-gate-spec.${branch}"
        if [[ -f "$spec_seal_file" ]]; then
            spec_seal_verdict=$(jq -r '.verdict // ""' "$spec_seal_file" 2>/dev/null | tr '[:upper:]' '[:lower:]' || echo "")
            # v3.7.0: 内容验证 — 不只检查文件存在，必须验证 verdict 字段值为 pass（防伪造 seal）
            # spec_seal_verdict == FAIL 或任何非 pass 值 → blocked（explicit: FAIL → blocked）
            if [[ "$spec_seal_verdict" != "pass" ]]; then
                if command -v _devlog_event &>/dev/null; then
                    _devlog_event "devloop-check" "spec_review" "blocked" "spec_review seal verdict 非 PASS（值: $spec_seal_verdict），拦截伪造 seal"
                fi
                _devloop_jq -n --arg v "$spec_seal_verdict" '{"status":"blocked","reason":"spec_review seal 文件 verdict 非 PASS（当前值: \($v)），可能是伪造 seal 文件","action":"确保 spec-review subagent 正常运行并写入 verdict=PASS 的 seal 文件"}'
                return 2
            fi
            # seal 存在且 verdict=PASS → 检查 divergence_count（存在性 + 非空验证）
            # ===== 条件 1.5b: divergence_count 门禁（Evaluator 独立性检查）=====
            # divergence_count = Evaluator 独立发现的与 Planner 分歧的问题数
            # 0 = Evaluator 橡皮图章（无价值），必须拦截；>= 1 = 真正独立思考，放行
            # v3.7.0: 额外检查 divergence_count 字段存在且非 null/empty（防伪造 seal）
            local spec_seal_divergence
            spec_seal_divergence=$(jq -r '.divergence_count // empty' "$spec_seal_file" 2>/dev/null || echo "")
            if [[ -z "$spec_seal_divergence" || "$spec_seal_divergence" == "null" ]]; then
                if command -v _devlog_event &>/dev/null; then
                    _devlog_event "devloop-check" "spec_review_divergence" "blocked" "spec_review seal divergence_count 字段缺失，可能是伪造 seal"
                fi
                _devloop_jq -n '{"status":"blocked","reason":"spec_review seal 文件 divergence_count 字段缺失或为 null，seal 文件无效","action":"确保 spec-review subagent 写入包含 divergence_count 字段的完整 seal 文件"}'
                return 2
            fi
            if ! check_divergence_count "$spec_seal_divergence"; then
                if command -v _devlog_event &>/dev/null; then
                    _devlog_event "devloop-check" "spec_review_divergence" "blocked" "spec_review divergence_count=0：Evaluator 未发现任何与 Planner 的分歧（橡皮图章检测）"
                fi
                _devloop_jq -n '{"status":"blocked","reason":"spec_review divergence_count=0：Evaluator 未发现任何与 Planner 的分歧（橡皮图章检测）","action":"重新调用 spec-review subagent，Evaluator 必须独立思考并发现至少 1 个 Planner 遗漏的问题"}'
                return 2
            fi
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
        fi  # end LITE mode else branch for condition 1.5
    fi

    # ===== 条件 1.6: planner seal 文件验证（Sprint Contract 前置检查）=====
    # Planner subagent 完成后必须写入 .dev-gate-planner.{branch}
    # 无此文件 → Sprint Contract 尚未生效，禁止进入 Stage 2
    # LITE 模式豁免：task_track=lite → 跳过此条件（LITE 路径不运行 Planner）
    if [[ -f "$dev_mode_file" ]]; then
        local _task_track_16
        _task_track_16=$(grep "^task_track:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "full")
        if [[ "$_task_track_16" != "lite" ]]; then
        local planner_seal_file
        planner_seal_file="$(dirname "$dev_mode_file")/.dev-gate-planner.${branch}"
        local step_1_done
        step_1_done=$(grep "^step_1_spec:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "pending")
        if [[ "$step_1_done" == "done" && ! -f "$planner_seal_file" ]]; then
            if command -v _devlog_event &>/dev/null; then
                _devlog_event "devloop-check" "planner_seal" "blocked" "Planner seal 文件缺失，Sprint Contract 未生效"
            fi
            _devloop_jq -n '{"status":"blocked","reason":"Planner seal 缺失：.dev-gate-planner.<branch> 不存在，Sprint Contract 尚未生效","action":"Stage 1 Spec 完成后必须由 Planner subagent 写入 .dev-gate-planner.<branch> seal 文件，再进入 Stage 2"}'
            return 2
        fi
        fi  # end FULL-only check for condition 1.6
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
            local _crg_seal_verdict
            _crg_seal_verdict=$(jq -r '.verdict // ""' "$crg_seal_file" 2>/dev/null | tr '[:upper:]' '[:lower:]' || echo "")
            # v3.7.0: 内容验证 — 不只检查文件存在，必须验证 verdict 字段值为 pass（防伪造 seal）
            if [[ "$_crg_seal_verdict" != "pass" ]]; then
                if command -v _devlog_event &>/dev/null; then
                    _devlog_event "devloop-check" "code_review_gate" "blocked" "code_review_gate seal verdict 非 PASS（值: $_crg_seal_verdict），拦截伪造 seal"
                fi
                _devloop_jq -n --arg v "$_crg_seal_verdict" '{"status":"blocked","reason":"code_review_gate seal 文件 verdict 非 PASS（当前值: \($v)），可能是伪造 seal 文件","action":"确保 code-review-gate subagent 正常运行并写入 verdict=PASS 的 seal 文件"}'
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

    # ===== 条件 2.6: DoD 完整性检查（镜像 CI check-dod-mapping）=====
    # 检查 task card 无残留 [ ] 条目，与 CI 对齐（dod_complete）
    # 若有未验证条目 → blocked，要求先跑 verify-step Gate 2
    if [[ -f "$dev_mode_file" ]]; then
        local _task_card_rel _task_card_abs _worktree_root _dod_unchecked
        _task_card_rel=$(grep "^task_card:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
        _worktree_root=$(dirname "$dev_mode_file")
        _task_card_abs="$_worktree_root/$_task_card_rel"
        if [[ -n "$_task_card_rel" && -f "$_task_card_abs" ]]; then
            _dod_unchecked=$(grep -cE '^\s*-\s+\[ \]\s+\[' "$_task_card_abs" 2>/dev/null || echo "0")
            if [[ "$_dod_unchecked" -gt 0 ]]; then
                if command -v _devlog_event &>/dev/null; then
                    _devlog_event "devloop-check" "dod_complete" "blocked" "DoD 有 ${_dod_unchecked} 条未验证"
                fi
                _devloop_jq -n --argjson n "$_dod_unchecked" \
                    '{"status":"blocked","reason":"DoD 有 \($n) 条未验证（[ ] 未改为 [x]），状态机与 CI 不同步","action":"运行 verify-step.sh step2，Gate 2 自动标记 [x]；若已跑过则检查 Test 命令是否实际通过"}'
                return 2
            fi
        fi
    fi

    # ===== 条件 2.7: drift check（Stage 3 前：scope 偏移检测，非阻断）=====
    # 检查实际改动文件是否超出 Task Card 声明的 Scope（warning only，不 return 2）
    if [[ -f "$dev_mode_file" ]]; then
        local _task_card_scope_rel _task_card_scope_abs _wt_root
        _task_card_scope_rel=$(grep "^task_card:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "")
        _wt_root=$(dirname "$dev_mode_file")
        _task_card_scope_abs="$_wt_root/$_task_card_scope_rel"
        if [[ -n "$_task_card_scope_rel" && -f "$_task_card_scope_abs" ]]; then
            # 从 task card 提取"要改的文件"列表
            local _declared_files
            _declared_files=$(grep -A 20 '## 实现方案' "$_task_card_scope_abs" 2>/dev/null \
                | grep -E '^\s*[-*]\s+`?packages/' \
                | sed 's/.*`\(packages\/[^`]*\)`.*/\1/;s/^\s*[-*]\s*//' \
                | awk '{print $1}' | head -20)
            # 获取实际改动文件（相对于仓库根）
            local _actual_files
            _actual_files=$(git -C "$_wt_root" diff --name-only HEAD~1 2>/dev/null \
                || git -C "$_wt_root" diff --name-only --cached 2>/dev/null \
                || echo "")
            if [[ -n "$_declared_files" && -n "$_actual_files" ]]; then
                local _drift_files=""
                while IFS= read -r _afile; do
                    local _matched=false
                    while IFS= read -r _dfile; do
                        [[ -z "$_dfile" ]] && continue
                        if echo "$_afile" | grep -q "$(echo "$_dfile" | cut -d' ' -f1 | sed 's|—.*||')"; then
                            _matched=true
                            break
                        fi
                    done <<< "$_declared_files"
                    if [[ "$_matched" == "false" ]]; then
                        # 排除 .task-/ .dev-mode 等工作流文件
                        if ! echo "$_afile" | grep -qE '^\.(task-|dev-mode|dev-lock|dev-gate|dev-seal)'; then
                            _drift_files="$_drift_files $_afile"
                        fi
                    fi
                done <<< "$_actual_files"
                if [[ -n "$_drift_files" ]]; then
                    echo "⚠️  [drift check] 以下文件的改动未在 Task Card Scope 中声明（仅 warning，不阻断）:" >&2
                    for _df in $_drift_files; do
                        echo "   - $_df" >&2
                    done
                    if command -v _devlog_event &>/dev/null; then
                        _devlog_event "devloop-check" "drift" "warning" "scope drift detected: $_drift_files"
                    fi
                fi
            fi
        fi
    fi

    # ===== 条件 2.8: generator seal 文件验证（Stage 3 前置检查）=====
    # Generator subagent 完成后必须写入 .dev-gate-generator.{branch}
    # 无此文件 → Generator 尚未完成，禁止进入 Stage 3（push/PR）
    if [[ -f "$dev_mode_file" ]]; then
        local generator_seal_file
        generator_seal_file="$(dirname "$dev_mode_file")/.dev-gate-generator.${branch}"
        local step_2_done_check
        step_2_done_check=$(grep "^step_2_code:" "$dev_mode_file" 2>/dev/null | awk '{print $2}' || echo "pending")
        if [[ "$step_2_done_check" == "done" && ! -f "$generator_seal_file" ]]; then
            if command -v _devlog_event &>/dev/null; then
                _devlog_event "devloop-check" "generator_seal" "blocked" "Generator seal 文件缺失，Stage 2 未完全提交"
            fi
            _devloop_jq -n '{"status":"blocked","reason":"Generator seal 缺失：.dev-gate-generator.<branch> 不存在，Generator subagent 尚未完成","action":"Stage 2 Code 完成后必须由 Generator subagent 写入 .dev-gate-generator.<branch> seal 文件，再进入 Stage 3"}'
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

    # ===== 条件 5: PR 是否已合并？且合并到了 main？=====
    if [[ "$pr_state" == "merged" ]]; then
        # 验证 PR 合并目标为 main（防止误合并到非 main 分支）
        local pr_base_ref=""
        if [[ -n "$pr_number" ]]; then
            pr_base_ref=$(gh pr view "$pr_number" --json baseRefName -q '.baseRefName' 2>/dev/null || echo "")
        fi
        if [[ -n "$pr_base_ref" && "$pr_base_ref" != "main" ]]; then
            _devloop_jq -n                 --arg base "$pr_base_ref"                 '{"status":"blocked","reason":"PR 已合并但目标分支不是 main（目标：\($base)）","action":"检查是否误合并到错误分支，如需要请重新开 PR 合并到 main"}'
            return 2
        fi
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
    # v3.7.0: 合并前最终确认 — 重新检查 PR mergeable 状态（防止状态窗口期）
    local _pre_merge_state _pre_merge_mergeable _pre_merge_pr_state
    _pre_merge_state=$(gh pr view "$pr_number" --json mergeable,state -q '{mergeable:.mergeable, state:.state}' 2>/dev/null || echo '{}')
    _pre_merge_mergeable=$(echo "$_pre_merge_state" | jq -r '.mergeable // "UNKNOWN"' 2>/dev/null || echo "UNKNOWN")
    _pre_merge_pr_state=$(echo "$_pre_merge_state" | jq -r '.state // "UNKNOWN"' 2>/dev/null || echo "UNKNOWN")
    if [[ "$_pre_merge_mergeable" == "CONFLICTING" ]]; then
        if command -v _devlog_event &>/dev/null; then
            _devlog_event "devloop-check" "merge" "blocked" "PR 合并前检查：存在冲突（CONFLICTING），需要 rebase"
        fi
        _devloop_jq -n --arg pr "$pr_number" '{"status":"blocked","reason":"PR #\($pr) 合并前检查：存在冲突（CONFLICTING），需要 rebase","action":"解决冲突后重新 push"}'
        return 2
    fi
    if [[ "$_pre_merge_pr_state" != "OPEN" ]]; then
        if command -v _devlog_event &>/dev/null; then
            _devlog_event "devloop-check" "merge" "blocked" "PR 合并前检查：PR 状态异常（$_pre_merge_pr_state），非 OPEN"
        fi
        _devloop_jq -n --arg pr "$pr_number" --arg s "$_pre_merge_pr_state" '{"status":"blocked","reason":"PR #\($pr) 合并前检查：PR 状态异常（\($s)，非 OPEN）","action":"检查 PR 状态"}'
        return 2
    fi
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

# smoke-test-20260323

# ============================================================================
# 直接执行入口（会话压缩恢复诊断）
# ============================================================================
# 使用方式：bash packages/engine/lib/devloop-check.sh
#
# 会话压缩重启后，agent 不知道自己在哪个 stage。
# 直接执行此脚本即可获得当前 stage 状态 + 缺失文件 + 下一步 action。
#
# 输出格式（人类可读）：
#   === Cecelia Dev Session Status ===
#   分支: cp-MMDDHHNN-xxx
#   .dev-mode: /path/to/.dev-mode.cp-xxx
#   Stage 状态:
#     step_1_spec: done
#     step_2_code: pending  ← 当前卡在这里
#   状态: blocked
#   原因: Stage 2 Code 未完成
#   下一步: 立即读取 skills/dev/steps/02-code.md 并执行 Stage 2
# ============================================================================
devloop_check_main() {
    local search_root
    search_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

    # 搜索所有 worktree 中的 .dev-mode.* 文件
    local dev_mode_files=()
    local search_dirs=()

    # 收集主仓库 + 所有 worktree 路径
    while IFS= read -r _wt_line; do
        if [[ "$_wt_line" == "worktree "* ]]; then
            local _wt_path="${_wt_line#worktree }"
            [[ -d "$_wt_path" ]] && search_dirs+=("$_wt_path")
        fi
    done < <(git -C "$search_root" worktree list --porcelain 2>/dev/null)

    # 如果 worktree list 失败，至少搜索当前目录
    if [[ ${#search_dirs[@]} -eq 0 ]]; then
        search_dirs+=("$search_root")
    fi

    # 收集所有 .dev-mode.* 文件（排除 .dev-mode.lock 和临时文件）
    for _dir in "${search_dirs[@]}"; do
        while IFS= read -r -d '' _f; do
            dev_mode_files+=("$_f")
        done < <(find "$_dir" -maxdepth 1 -name '.dev-mode.*' ! -name '*.lock' ! -name '*.cleanup.*' -print0 2>/dev/null)
    done

    echo "=== Cecelia Dev Session Status ==="
    echo ""

    if [[ ${#dev_mode_files[@]} -eq 0 ]]; then
        echo "状态: NO_ACTIVE_SESSION"
        echo "未找到 .dev-mode.* 文件（没有活跃的 /dev 会话）"
        echo ""
        echo "如需启动新任务: /dev --task-id <id>"
        echo "如需恢复已有任务: 检查 ~/worktrees/ 下是否有残留 worktree"
        return 0
    fi

    local found_count=0
    for _dmf in "${dev_mode_files[@]}"; do
        found_count=$(( found_count + 1 ))

        # 从文件名提取 branch
        local _fname
        _fname=$(basename "$_dmf")
        local _branch="${_fname#.dev-mode.}"

        echo "--- 会话 $found_count ---"
        echo "分支: $_branch"
        echo ".dev-mode: $_dmf"
        echo ""

        # 读取各 stage 状态
        local _s1 _s2 _s3 _s4 _track _cleanup
        _s1=$(grep "^step_1_spec:" "$_dmf" 2>/dev/null | awk '{print $2}' || echo "pending")
        _s2=$(grep "^step_2_code:" "$_dmf" 2>/dev/null | awk '{print $2}' || echo "pending")
        _s3=$(grep "^step_3_integrate:" "$_dmf" 2>/dev/null | awk '{print $2}' || echo "pending")
        _s4=$(grep "^step_4_ship:" "$_dmf" 2>/dev/null | awk '{print $2}' || echo "pending")
        _track=$(grep "^task_track:" "$_dmf" 2>/dev/null | awk '{print $2}' || echo "full")
        _cleanup=$(grep "^cleanup_done:" "$_dmf" 2>/dev/null | awk '{print $2}' || echo "")

        echo "Stage 状态:"
        echo "  step_1_spec:      $_s1"
        echo "  step_2_code:      $_s2"
        echo "  step_3_integrate: $_s3"
        echo "  step_4_ship:      $_s4"
        echo "  task_track:       $_track"
        [[ -n "$_cleanup" ]] && echo "  cleanup_done:     $_cleanup"
        echo ""

        # 调用 devloop_check 获取详细状态
        local _result _status _reason _action
        _result=$(devloop_check "$_branch" "$_dmf" 2>/dev/null || echo '{"status":"error"}')
        _status=$(echo "$_result" | _devloop_jq -r '.status // "unknown"' 2>/dev/null || echo "unknown")
        _reason=$(echo "$_result" | _devloop_jq -r '.reason // ""' 2>/dev/null || echo "")
        _action=$(echo "$_result" | _devloop_jq -r '.action // ""' 2>/dev/null || echo "")

        echo "devloop 状态: $_status"
        if [[ -n "$_reason" ]]; then
            echo "原因: $_reason"
        fi
        if [[ -n "$_action" ]]; then
            echo ""
            echo "下一步:"
            echo "  $_action"
        fi

        # 检查 seal 文件状态
        local _wt_root
        _wt_root=$(dirname "$_dmf")
        echo ""
        echo "Seal 文件:"
        for _seal_name in ".dev-gate-lite" ".dev-gate-planner" ".dev-gate-spec" ".dev-gate-generator" ".dev-gate-crg"; do
            local _sf="$_wt_root/${_seal_name}.${_branch}"
            if [[ -f "$_sf" ]]; then
                local _verdict
                _verdict=$(command -v jq &>/dev/null && jq -r '.verdict // .routing_decision // "present"' "$_sf" 2>/dev/null || echo "present")
                echo "  ✅ ${_seal_name}: $_verdict"
            else
                echo "  ⬜ ${_seal_name}: 不存在"
            fi
        done

        echo ""
    done

    if [[ $found_count -gt 0 ]]; then
        echo "提示: 会话恢复后，先确认 worktree 路径存在，再继续对应 Stage。"
        echo "      worktree 路径通常在 ~/worktrees/cecelia/<task-name>/"
    fi
}

# 直接执行时调用 devloop_check_main（source 引入时跳过）
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    devloop_check_main "$@"
fi
