#!/usr/bin/env bash
#
# generate-feedback-report.sh
# 生成 /dev workflow 的反馈报告
#
# Usage:
#   bash skills/dev/scripts/generate-feedback-report.sh [task_id]
#
# 输出：.dev-feedback-report.json
#
# 字段：
#   - task_id: 任务 ID（从参数或 .dev-mode 读取）
#   - branch: 当前分支名
#   - pr_number: PR 号码（如果有）
#   - completed_at: 完成时间（ISO 8601）
#   - summary: 总结
#   - issues_found: 发现的问题（数组）
#   - next_steps_suggested: 建议的下一步（数组）
#   - technical_notes: 技术笔记
#   - code_changes: 代码变更统计
#   - test_coverage: 测试覆盖率
#   - performance_notes: 性能笔记

set -euo pipefail

# ============================================================================
# 常量
# ============================================================================

REPORT_FILE=".dev-feedback-report.json"
DEV_MODE_FILE=".dev-mode"
QUALITY_SUMMARY="quality-summary.json"

# ============================================================================
# 工具函数
# ============================================================================

# 从 .dev-mode 读取 task_id
get_task_id_from_dev_mode() {
    if [[ -f "$DEV_MODE_FILE" ]]; then
        grep "^task_id:" "$DEV_MODE_FILE" 2>/dev/null | cut -d' ' -f2 || echo "N/A"
    else
        echo "N/A"
    fi
}

# 获取当前分支
get_branch() {
    git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "N/A"
}

# 获取 PR 号码
get_pr_number() {
    if command -v gh &>/dev/null; then
        gh pr view --json number -q '.number' 2>/dev/null || echo "N/A"
    else
        echo "N/A"
    fi
}

# 获取完成时间（ISO 8601）
get_completed_at() {
    date -u +"%Y-%m-%dT%H:%M:%SZ"
}

# 生成总结（基于 incident log 统计 + quality-summary.json）
generate_summary() {
    local summary="功能实现完成"
    local INCIDENT_FILE=".dev-incident-log.json"

    # 从 incident log 统计失败次数
    if [[ -f "$INCIDENT_FILE" ]]; then
        local ci_failures test_failures
        ci_failures=$(jq '[.[] | select(.type == "ci_failure")] | length' "$INCIDENT_FILE" 2>/dev/null || echo "0")
        test_failures=$(jq '[.[] | select(.type == "test_failure")] | length' "$INCIDENT_FILE" 2>/dev/null || echo "0")

        if [[ "$ci_failures" -gt 0 || "$test_failures" -gt 0 ]]; then
            summary="功能实现完成（CI 失败 ${ci_failures} 次，本地测试失败 ${test_failures} 次）"
        fi
    fi

    # 尝试从 quality-summary.json 读取（覆盖上面的默认值）
    if [[ -f "$QUALITY_SUMMARY" ]]; then
        local note
        note=$(jq -r '.note // ""' "$QUALITY_SUMMARY" 2>/dev/null || echo "")
        if [[ -n "$note" && "$note" != "null" ]]; then
            summary="$note"
        fi
    fi

    echo "$summary"
}

# 从 .dev-incident-log.json 提取真实问题（优先）
# 降级：从 quality-summary.json 关键词提取（兼容旧流程）
extract_issues() {
    local INCIDENT_FILE=".dev-incident-log.json"

    # 优先从 incident log 读取真实数据
    if [[ -f "$INCIDENT_FILE" ]]; then
        local count
        count=$(jq 'length' "$INCIDENT_FILE" 2>/dev/null || echo "0")

        if [[ "$count" -gt 0 ]]; then
            # 将每条 incident 转成可读字符串
            jq -r '[.[] | "[" + .step + "] " + .description + (if .resolution != "" then " → 修复: " + .resolution else " → 未记录修复" end)]' \
                "$INCIDENT_FILE" 2>/dev/null || echo "[]"
            return
        fi
    fi

    # 降级：从 quality-summary.json 关键词提取
    local issues=()
    if [[ -f "$QUALITY_SUMMARY" ]]; then
        local changes
        changes=$(jq -r '.changes // {}' "$QUALITY_SUMMARY" 2>/dev/null || echo "{}")
        if echo "$changes" | grep -qiE '修复|fix|bug'; then
            issues+=("代码中存在需要修复的问题（来源：quality-summary 关键词）")
        fi
    fi

    if [[ ${#issues[@]} -eq 0 ]]; then
        echo "[]"
    else
        printf '%s\n' "${issues[@]}" | jq -R . | jq -s .
    fi
}

# 生成下一步建议
generate_next_steps() {
    local steps=()

    # 基于 issues 生成建议
    local issues
    issues=$(extract_issues)

    if [[ "$issues" != "[]" ]]; then
        steps+=("解决发现的问题")
        steps+=("增加测试覆盖率")
    fi

    # 默认建议
    if [[ ${#steps[@]} -eq 0 ]]; then
        steps+=("继续后续功能开发")
    fi

    printf '%s\n' "${steps[@]}" | jq -R . | jq -s .
}

# 生成技术笔记
generate_technical_notes() {
    local notes="实现符合 PRD 要求"

    # 尝试从 git diff 分析
    local files_count
    files_count=$(git diff develop --name-only 2>/dev/null | wc -l || echo "0")

    if [[ "$files_count" -gt 10 ]]; then
        notes="$notes。变更文件较多（$files_count 个），建议拆分提交。"
    fi

    echo "$notes"
}

# 获取代码变更统计
get_code_changes() {
    local files_modified=()
    local lines_added=0
    local lines_deleted=0
    local net_lines=0

    # 获取修改的文件列表
    while IFS= read -r file; do
        files_modified+=("$file")
    done < <(git diff develop --name-only 2>/dev/null || echo "")

    # 获取行数统计
    local shortstat
    shortstat=$(git diff develop --shortstat 2>/dev/null || echo "")

    if [[ -n "$shortstat" ]]; then
        # 解析格式："3 files changed, 123 insertions(+), 45 deletions(-)"
        lines_added=$(echo "$shortstat" | grep -oP '\d+(?= insertion)' || echo "0")
        lines_deleted=$(echo "$shortstat" | grep -oP '\d+(?= deletion)' || echo "0")
        net_lines=$((lines_added - lines_deleted))
    fi

    # 生成 JSON
    jq -n \
        --argjson files "$(printf '%s\n' "${files_modified[@]}" | jq -R . | jq -s .)" \
        --argjson added "$lines_added" \
        --argjson deleted "$lines_deleted" \
        --argjson net "$net_lines" \
        '{
            files_modified: $files,
            lines_added: $added,
            lines_deleted: $deleted,
            net_lines: $net
        }'
}

# 获取测试覆盖率
get_test_coverage() {
    # 尝试从 quality-summary.json 读取，如果没有则返回 N/A
    local percentage="N/A"
    local files_covered="N/A"
    local files_total="N/A"

    if [[ -f "$QUALITY_SUMMARY" ]]; then
        # 检查是否有覆盖率字段
        local coverage
        coverage=$(jq -r '.coverage.percentage // "N/A"' "$QUALITY_SUMMARY" 2>/dev/null || echo "N/A")
        if [[ "$coverage" != "N/A" && "$coverage" != "null" ]]; then
            percentage="$coverage"
            files_covered=$(jq -r '.coverage.files_covered // "N/A"' "$QUALITY_SUMMARY" 2>/dev/null || echo "N/A")
            files_total=$(jq -r '.coverage.files_total // "N/A"' "$QUALITY_SUMMARY" 2>/dev/null || echo "N/A")
        fi
    fi

    jq -n \
        --arg percentage "$percentage" \
        --arg files_covered "$files_covered" \
        --arg files_total "$files_total" \
        '{
            percentage: $percentage,
            files_covered: $files_covered,
            files_total: $files_total
        }'
}

# 生成性能笔记
generate_performance_notes() {
    echo "无性能测试"
}

# ============================================================================
# 主函数
# ============================================================================

main() {
    local task_id="${1:-$(get_task_id_from_dev_mode)}"
    local branch
    local pr_number
    local completed_at
    local summary
    local issues_found
    local next_steps_suggested
    local technical_notes
    local code_changes
    local test_coverage
    local performance_notes

    # 收集所有字段
    branch=$(get_branch)
    pr_number=$(get_pr_number)
    completed_at=$(get_completed_at)
    summary=$(generate_summary)
    issues_found=$(extract_issues)
    next_steps_suggested=$(generate_next_steps)
    technical_notes=$(generate_technical_notes)
    code_changes=$(get_code_changes)
    test_coverage=$(get_test_coverage)
    performance_notes=$(generate_performance_notes)

    # 生成最终 JSON
    jq -n \
        --arg task_id "$task_id" \
        --arg branch "$branch" \
        --arg pr_number "$pr_number" \
        --arg completed_at "$completed_at" \
        --arg summary "$summary" \
        --argjson issues_found "$issues_found" \
        --argjson next_steps_suggested "$next_steps_suggested" \
        --arg technical_notes "$technical_notes" \
        --argjson code_changes "$code_changes" \
        --argjson test_coverage "$test_coverage" \
        --arg performance_notes "$performance_notes" \
        '{
            task_id: $task_id,
            branch: $branch,
            pr_number: $pr_number,
            completed_at: $completed_at,
            summary: $summary,
            issues_found: $issues_found,
            next_steps_suggested: $next_steps_suggested,
            technical_notes: $technical_notes,
            code_changes: $code_changes,
            test_coverage: $test_coverage,
            performance_notes: $performance_notes
        }' > "$REPORT_FILE"

    echo "✅ 反馈报告已生成: $REPORT_FILE"
}

# ============================================================================
# 入口
# ============================================================================

main "$@"
