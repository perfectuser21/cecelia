#!/usr/bin/env bash
#
# extract-learnings.sh
# 从 LEARNINGS.md 和 .dev-incident-log.json 提取结构化知识
# 输出 .dev-learnings-extracted.json（供 generate-feedback-report.sh 合并）
#
# Usage:
#   bash skills/dev/scripts/extract-learnings.sh
#   bash skills/dev/scripts/extract-learnings.sh --test-incident   # 测试 incident 提取
#   bash skills/dev/scripts/extract-learnings.sh --test-learnings  # 测试 LEARNINGS 提取
#
# 输出：.dev-learnings-extracted.json
#   {
#     "issues_found": [...],        # 从 incident-log 和 LEARNINGS 根因提取
#     "next_steps_suggested": [...] # 从 LEARNINGS 预防措施提取
#   }

set -euo pipefail

# ============================================================================
# 常量
# ============================================================================

INCIDENT_FILE=".dev-incident-log.json"
OUTPUT_FILE=".dev-learnings-extracted.json"

# LEARNINGS 搜索路径（优先 per-branch，其次旧格式，最后 engine 层面）
# per-branch 文件在 find_learnings_file() 中动态扫描 docs/learnings/*.md
LEARNINGS_CANDIDATES=(
    "docs/LEARNINGS.md"
    "packages/engine/docs/LEARNINGS.md"
)

# ============================================================================
# 工具函数
# ============================================================================

# 找到 LEARNINGS 文件（优先级：per-branch > 项目层旧格式 > engine 层）
find_learnings_file() {
    # 优先：docs/learnings/ 目录下最新的 .md 文件（per-branch 模式）
    if [[ -d "docs/learnings" ]]; then
        local latest
        latest=$(ls -t docs/learnings/*.md 2>/dev/null | head -1)
        if [[ -n "$latest" && -f "$latest" ]]; then
            echo "$latest"
            return 0
        fi
    fi
    # 兜底：旧格式候选列表
    for f in "${LEARNINGS_CANDIDATES[@]}"; do
        if [[ -f "$f" ]]; then
            echo "$f"
            return 0
        fi
    done
    echo ""
}

# 从 .dev-incident-log.json 提取问题描述列表（JSON 数组字符串）
extract_issues_from_incident() {
    if [[ ! -f "$INCIDENT_FILE" ]]; then
        echo "[]"
        return
    fi

    local count
    count=$(jq 'length' "$INCIDENT_FILE" 2>/dev/null || echo "0")

    if [[ "$count" -eq 0 ]]; then
        echo "[]"
        return
    fi

    jq -r '[.[] | "[" + (.step // "unknown") + "] " + (.description // "") + (if (.resolution // "") != "" then " → 修复: " + .resolution else " → 未记录修复" end)]' \
        "$INCIDENT_FILE" 2>/dev/null || echo "[]"
}

# 从 LEARNINGS.md 末尾段落提取预防措施
# 策略：找最后一个 ### 标题开始的段落，提取"预防措施"部分的列表项
extract_next_steps_from_learnings() {
    local learnings_file
    learnings_file=$(find_learnings_file)

    if [[ -z "$learnings_file" || ! -f "$learnings_file" ]]; then
        echo "[]"
        return
    fi

    # 用 awk 提取最后一个 ### 段落的内容
    local last_section
    last_section=$(awk '
        /^### / { section = ""; in_section = 1 }
        in_section { section = section "\n" $0 }
        END { print section }
    ' "$learnings_file")

    if [[ -z "$last_section" ]]; then
        echo "[]"
        return
    fi

    # 在最后段落中找"预防措施"关键字后的列表项
    local items=()
    local in_prevention=0

    while IFS= read -r line; do
        # 检测预防措施段落开始
        if echo "$line" | grep -qiE '预防措施|prevention|下次.*注意|建议.*注意'; then
            in_prevention=1
            continue
        fi

        # 检测下一个段落标题（退出预防措施区域）
        if [[ "$in_prevention" -eq 1 ]] && echo "$line" | grep -qE '^(#+|---|\*\*[^*]+\*\*)'; then
            # 若遇到新的粗体标题或分隔线，结束预防区域
            if echo "$line" | grep -qE '^(#+|---)'; then
                in_prevention=0
            fi
        fi

        # 提取列表项（- 开头的行）
        if [[ "$in_prevention" -eq 1 ]] && echo "$line" | grep -qE '^\s*[-*]\s+.+'; then
            local item
            item=$(echo "$line" | sed 's/^\s*[-*]\s*//')
            if [[ -n "$item" ]]; then
                items+=("$item")
            fi
        fi
    done <<< "$last_section"

    if [[ ${#items[@]} -eq 0 ]]; then
        echo "[]"
    else
        printf '%s\n' "${items[@]}" | jq -R . | jq -s .
    fi
}

# ============================================================================
# 测试模式
# ============================================================================

# --test-incident: 仅测试 incident 提取（不写文件）
test_incident_mode() {
    echo "=== 测试模式：从 .dev-incident-log.json 提取 ==="

    # 创建临时测试 incident log
    local tmp_incident
    tmp_incident=$(mktemp /tmp/test-incident-XXXXXX.json)
    printf '%s' '[
  {
    "step": "07-verify",
    "type": "test_failure",
    "description": "单元测试 TypeScript 类型错误",
    "error": "Type '\''string'\'' is not assignable to type '\''number'\''",
    "resolution": "修正参数类型为 string"
  },
  {
    "step": "09-ci",
    "type": "ci_failure",
    "description": "CI engine-ci 失败：版本未同步",
    "error": "version mismatch in .hook-core-version",
    "resolution": "手动更新 .hook-core-version"
  }
]' > "$tmp_incident"

    # 临时替换 INCIDENT_FILE
    local orig_incident="$INCIDENT_FILE"
    INCIDENT_FILE="$tmp_incident"

    local result
    result=$(extract_issues_from_incident)
    echo "提取结果："
    echo "$result" | jq .

    INCIDENT_FILE="$orig_incident"
    rm -f "$tmp_incident"

    local count
    count=$(echo "$result" | jq 'length')
    if [[ "$count" -ge 1 ]]; then
        echo "✅ --test-incident 通过（提取到 $count 条）"
        exit 0
    else
        echo "❌ --test-incident 失败（未提取到任何条目）"
        exit 1
    fi
}

# --test-learnings: 仅测试 LEARNINGS 提取（不写文件）
test_learnings_mode() {
    echo "=== 测试模式：从 LEARNINGS.md 末尾段落提取预防措施 ==="

    # 创建临时 LEARNINGS.md
    local tmp_dir
    tmp_dir=$(mktemp -d /tmp/test-learnings-XXXXXX)
    local tmp_learnings="$tmp_dir/LEARNINGS.md"
    printf '%s\n' '# Engine LEARNINGS' '' '### [2026-02-28] 测试任务' '' '**失败统计**：CI 失败 2 次，本地测试失败 1 次' '' '**CI 失败记录**：' '- 失败 #1：版本文件未同步 → 更新 .hook-core-version → 下次先检查版本文件' '' '**预防措施**：' '- 改 engine 版本时，同步检查 .hook-core-version 和 regression-contract.yaml' '- 运行 `bash scripts/generate-path-views.sh` 确保路径视图一致' '- 提交前用 `bash scripts/check-version-sync.sh` 验证版本' '' '**影响程度**: Medium' > "$tmp_learnings"

    # 临时添加到候选列表
    LEARNINGS_CANDIDATES=("$tmp_learnings")

    local result
    result=$(extract_next_steps_from_learnings)
    echo "提取结果："
    echo "$result" | jq .

    rm -rf "$tmp_dir"

    local count
    count=$(echo "$result" | jq 'length')
    if [[ "$count" -ge 1 ]]; then
        echo "✅ --test-learnings 通过（提取到 $count 条预防措施）"
        exit 0
    else
        echo "❌ --test-learnings 失败（未提取到任何预防措施）"
        exit 1
    fi
}

# ============================================================================
# 主函数
# ============================================================================

main() {
    # 处理测试模式参数
    if [[ "${1:-}" == "--test-incident" ]]; then
        test_incident_mode
        return
    fi

    if [[ "${1:-}" == "--test-learnings" ]]; then
        test_learnings_mode
        return
    fi

    echo "📖 提取 LEARNINGS 结构化内容..."

    # 1. 从 incident log 提取 issues
    local issues_from_incident
    issues_from_incident=$(extract_issues_from_incident)

    # 2. 从 LEARNINGS.md 提取预防措施
    local next_steps_from_learnings
    next_steps_from_learnings=$(extract_next_steps_from_learnings)

    # 3. 统计
    local issue_count next_count
    issue_count=$(echo "$issues_from_incident" | jq 'length')
    next_count=$(echo "$next_steps_from_learnings" | jq 'length')

    echo "  - issues_found（来自 incident log）: $issue_count 条"
    echo "  - next_steps_suggested（来自 LEARNINGS）: $next_count 条"

    # 4. 写输出文件
    jq -n \
        --argjson issues "$issues_from_incident" \
        --argjson next_steps "$next_steps_from_learnings" \
        '{
            issues_found: $issues,
            next_steps_suggested: $next_steps
        }' > "$OUTPUT_FILE"

    echo "✅ 已写入 $OUTPUT_FILE"
}

# ============================================================================
# 入口
# ============================================================================

main "$@"
