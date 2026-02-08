#!/usr/bin/env bash
#
# generate-feedback-report-v2.sh
# 生成 /dev workflow 的反馈报告（4 维度分析版）
#
# 维度：
#   1. 质量维度：期望 vs 实际对比
#   2. 效率维度：每步耗时记录
#   3. 稳定性维度：重试次数、CI 通过率
#   4. 自动化维度：人工干预次数
#
# Usage:
#   bash skills/dev/scripts/generate-feedback-report-v2.sh
#
# 输出：docs/dev-reports/YYYY-MM-DD-HH-MM-SS.md
#

set -euo pipefail

# ============================================================================
# 常量
# ============================================================================

LOG_FILE=".dev-execution-log.jsonl"
EXPECTATIONS_FILE="skills/dev/lib/step-expectations.json"
REPORT_DIR="docs/dev-reports"
DEV_MODE_FILE=".dev-mode"

# ============================================================================
# 工具函数
# ============================================================================

# 确保报告目录存在
ensure_report_dir() {
    mkdir -p "$REPORT_DIR"
}

# 生成报告文件名
get_report_filename() {
    local timestamp
    timestamp=$(date +"%Y-%m-%d-%H-%M-%S")
    echo "$REPORT_DIR/${timestamp}.md"
}

# 获取分支名
get_branch() {
    git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "N/A"
}

# 获取 PR 号
get_pr_number() {
    if command -v gh &>/dev/null; then
        gh pr view --json number -q '.number' 2>/dev/null || echo "N/A"
    else
        echo "N/A"
    fi
}

# 计算总耗时
calculate_total_duration() {
    if [[ ! -f "$LOG_FILE" ]]; then
        echo "0"
        return
    fi

    jq -s 'map(.duration) | add // 0' "$LOG_FILE"
}

# 生成效率维度数据（Markdown 表格）
generate_efficiency_table() {
    if [[ ! -f "$LOG_FILE" ]]; then
        echo "无执行记录"
        return
    fi

    echo "| Step | Duration | Status |"
    echo "|------|----------|--------|"

    jq -r '.step as $step | .duration as $dur | .status as $st |
        "\($step) | \($dur)s | \($st)"' "$LOG_FILE"
}

# 生成稳定性维度数据
generate_stability_metrics() {
    if [[ ! -f "$LOG_FILE" ]]; then
        echo "{\"total_retries\": 0, \"ci_pass_rate\": \"N/A\", \"stop_hook_triggers\": 0}"
        return
    fi

    local total_retries
    total_retries=$(jq -s 'map(.retries) | add // 0' "$LOG_FILE")

    # CI 通过率（假设 09-ci 步骤的 status）
    local ci_status
    ci_status=$(jq -r 'select(.step == "09-ci") | .status' "$LOG_FILE" | head -1 || echo "N/A")
    local ci_pass_rate="N/A"
    if [[ "$ci_status" == "success" ]]; then
        ci_pass_rate="100%"
    elif [[ "$ci_status" == "failure" ]]; then
        ci_pass_rate="0%"
    fi

    jq -n \
        --argjson total_retries "$total_retries" \
        --arg ci_pass_rate "$ci_pass_rate" \
        '{
            total_retries: $total_retries,
            ci_pass_rate: $ci_pass_rate,
            stop_hook_triggers: 0
        }'
}

# 生成自动化维度数据
generate_automation_metrics() {
    if [[ ! -f "$EXPECTATIONS_FILE" ]]; then
        echo "{\"fully_automated\": 0, \"mostly_automated\": 0, \"semi_automated\": 0}"
        return
    fi

    local fully=0
    local mostly=0
    local semi=0

    # 统计每个步骤的自动化程度
    while IFS= read -r level; do
        case "$level" in
            fully_automated) fully=$((fully + 1)) ;;
            mostly_automated) mostly=$((mostly + 1)) ;;
            semi_automated) semi=$((semi + 1)) ;;
        esac
    done < <(jq -r '.[] | .automation_level' "$EXPECTATIONS_FILE")

    local total=$((fully + mostly + semi))
    local auto_rate=0
    if [[ $total -gt 0 ]]; then
        auto_rate=$(( (fully * 100 + mostly * 50 + semi * 25) / total ))
    fi

    jq -n \
        --argjson fully "$fully" \
        --argjson mostly "$mostly" \
        --argjson semi "$semi" \
        --argjson total "$total" \
        --argjson auto_rate "$auto_rate" \
        '{
            fully_automated: $fully,
            mostly_automated: $mostly,
            semi_automated: $semi,
            total_steps: $total,
            automation_rate: "\($auto_rate)%"
        }'
}

# 调用 LLM 分析质量维度
analyze_quality_with_llm() {
    local log_content=""
    local expectations_content=""

    if [[ -f "$LOG_FILE" ]]; then
        log_content=$(cat "$LOG_FILE")
    fi

    if [[ -f "$EXPECTATIONS_FILE" ]]; then
        expectations_content=$(cat "$EXPECTATIONS_FILE")
    fi

    local prompt="你是一个开发流程分析专家。请基于以下数据分析本次 /dev 工作流的质量维度：

# 执行日志
\`\`\`jsonl
$log_content
\`\`\`

# 期望标准
\`\`\`json
$expectations_content
\`\`\`

请分析：
1. 每个步骤的质量对比（期望 vs 实际）
2. 发现的主要问题
3. 质量评分（0-100）

输出格式（Markdown）：
### 质量对比

| Step | Expected | Actual | Score | Issues |
|------|----------|--------|-------|--------|
| ... | ... | ... | .../100 | ... |

### 主要问题

1. ...
2. ...
"

    # 调用 claude CLI（如果可用）
    if command -v claude &>/dev/null; then
        echo "$prompt" | claude -m sonnet-4-5 2>/dev/null || echo "### 质量分析

无法调用 LLM 分析，请手动检查日志。"
    else
        echo "### 质量分析

无法调用 LLM（claude CLI 未安装），请手动检查日志。"
    fi
}

# 生成改进建议
generate_improvement_suggestions() {
    local stability_json
    stability_json=$(generate_stability_metrics)

    local total_retries
    total_retries=$(echo "$stability_json" | jq -r '.total_retries')

    echo "## 改进建议（按优先级）"
    echo ""
    echo "### P0 - 质量问题"
    echo ""
    echo "（由 LLM 分析生成，见上方质量维度）"
    echo ""
    echo "### P1 - 效率提升"
    echo ""

    if [[ "$total_retries" -gt 2 ]]; then
        echo "- 本次执行有 $total_retries 次重试，建议分析重试原因并优化"
    else
        echo "- 无明显效率问题"
    fi

    echo ""
    echo "### P2 - 自动化增强"
    echo ""
    echo "- 当前自动化程度较高，继续保持"
}

# ============================================================================
# 主函数
# ============================================================================

main() {
    ensure_report_dir

    local report_file
    report_file=$(get_report_filename)

    local branch
    branch=$(get_branch)

    local pr_number
    pr_number=$(get_pr_number)

    local total_duration
    total_duration=$(calculate_total_duration)

    local stability_json
    stability_json=$(generate_stability_metrics)

    local automation_json
    automation_json=$(generate_automation_metrics)

    # 生成报告
    cat > "$report_file" << EOF
# /dev 执行报告

**Date**: $(date +"%Y-%m-%d %H:%M:%S")
**Branch**: $branch
**PR**: #$pr_number
**Total Duration**: ${total_duration}s

---

## 效率维度

$(generate_efficiency_table)

**总耗时**: ${total_duration}s

---

## 稳定性维度

\`\`\`json
$stability_json
\`\`\`

- **重试次数**: $(echo "$stability_json" | jq -r '.total_retries')
- **CI 通过率**: $(echo "$stability_json" | jq -r '.ci_pass_rate')

---

## 自动化维度

\`\`\`json
$automation_json
\`\`\`

- **自动化程度**: $(echo "$automation_json" | jq -r '.automation_rate')

---

## 质量维度

$(analyze_quality_with_llm)

---

$(generate_improvement_suggestions)

---

## 原始数据

### 执行日志
\`\`\`jsonl
$(cat "$LOG_FILE" 2>/dev/null || echo "无日志")
\`\`\`

### 期望标准
\`\`\`json
$(cat "$EXPECTATIONS_FILE" 2>/dev/null || echo "{}")
\`\`\`

---

*Generated by /dev feedback report system*
EOF

    echo "✅ 反馈报告已生成: $report_file"
}

# ============================================================================
# 入口
# ============================================================================

main "$@"
