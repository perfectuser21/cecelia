#!/usr/bin/env bash
#
# fetch-task-prd.sh
# 从 Brain 数据库读取 Task PRD 并生成本地文件
#
# Usage:
#   bash skills/dev/scripts/fetch-task-prd.sh <task_id>
#
# 输出：
#   .prd-task-<id>.md
#   .dod-task-<id>.md
#   成功时 exit 0，失败时 exit 1

set -euo pipefail

# ============================================================================
# 参数检查
# ============================================================================

if [[ $# -lt 1 ]]; then
    echo "用法: $0 <task_id>" >&2
    exit 1
fi

TASK_ID="$1"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
TIMEOUT=5

# ============================================================================
# 工具函数
# ============================================================================

# 从 Brain 读取 Task 详情
fetch_task() {
    local task_id="$1"
    local url="$BRAIN_URL/api/brain/tasks/$task_id"

    if ! curl --fail --silent --max-time "$TIMEOUT" "$url" 2>/dev/null; then
        echo "❌ 无法从 Brain 读取 Task $task_id" >&2
        echo "   URL: $url" >&2
        echo "   请确认：" >&2
        echo "   1. Brain 服务正在运行 (docker-compose ps brain)" >&2
        echo "   2. Task ID 正确" >&2
        return 1
    fi
}

# 从 Brain 读取 Feature 的所有 Tasks
fetch_feature_tasks() {
    local feature_id="$1"
    local url="$BRAIN_URL/api/brain/tasks?feature_id=$feature_id"

    if ! curl --fail --silent --max-time "$TIMEOUT" "$url" 2>/dev/null; then
        echo "[]"  # 返回空数组
    fi
}

# 生成 PRD 文件
generate_prd() {
    local task_id="$1"
    local task_json="$2"
    local prev_feedback="$3"

    local prd_file=".prd-task-${task_id}.md"
    local title
    local description
    local feature_id
    local order

    title=$(echo "$task_json" | jq -r '.title // "未命名任务"')
    description=$(echo "$task_json" | jq -r '.description // ""')
    feature_id=$(echo "$task_json" | jq -r '.feature_id // "N/A"')
    order=$(echo "$task_json" | jq -r '.order // 0')

    # 开始生成 PRD
    cat > "$prd_file" <<EOF
# PRD: $title

## Task 信息

- **Task ID**: $task_id
- **Feature ID**: $feature_id
- **Order**: $order
- **来源**: Brain 数据库

EOF

    # 添加上一个 Task 反馈（如果有）
    if [[ -n "$prev_feedback" && "$prev_feedback" != "null" ]]; then
        local prev_summary
        local prev_issues
        local prev_next_steps
        local prev_technical_notes

        prev_summary=$(echo "$prev_feedback" | jq -r '.summary // "无"')
        prev_issues=$(echo "$prev_feedback" | jq -r '.issues_found // [] | join(", ") | if . == "" then "无" else . end')
        prev_next_steps=$(echo "$prev_feedback" | jq -r '.next_steps_suggested // [] | join(", ") | if . == "" then "无" else . end')
        prev_technical_notes=$(echo "$prev_feedback" | jq -r '.technical_notes // "无"')

        cat >> "$prd_file" <<EOF
## 上一个 Task 反馈

**Summary**: $prev_summary

**Issues Found**: $prev_issues

**Next Steps Suggested**: $prev_next_steps

**Technical Notes**: $prev_technical_notes

---

EOF
    fi

    # 添加功能描述
    cat >> "$prd_file" <<EOF
## 功能描述

$description

## 成功标准

- [ ] 功能按 PRD 实现
- [ ] 所有测试通过
- [ ] 代码质量良好

## 验收标准

- [ ] 功能验收：实现符合描述
- [ ] 测试验收：测试覆盖完整
- [ ] 质量验收：CI 全部通过
EOF

    echo "✅ 已生成 PRD: $prd_file"
}

# 生成 DoD 文件
generate_dod() {
    local task_id="$1"
    local task_json="$2"

    local dod_file=".dod-task-${task_id}.md"
    local title

    title=$(echo "$task_json" | jq -r '.title // "未命名任务"')

    cat > "$dod_file" <<EOF
# DoD: $title

## 功能验收

- [ ] 功能按 PRD 实现
- [ ] 手动测试通过

## 测试验收

- [ ] 测试脚本存在
- [ ] 所有测试通过

## 质量验收

- [ ] 代码符合规范
- [ ] 无明显 bug
- [ ] CI 全部通过

## CI/CD 验收

- [ ] 版本号更新
- [ ] RCI 覆盖率添加
- [ ] Feature Registry 更新

## 最终验收

- [ ] PR 创建
- [ ] CI 通过
- [ ] PR 合并
EOF

    echo "✅ 已生成 DoD: $dod_file"
}

# ============================================================================
# 主函数
# ============================================================================

main() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  从 Brain 读取 Task PRD"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Task ID: $TASK_ID"
    echo "Brain URL: $BRAIN_URL"
    echo ""

    # 1. 读取 Task 详情
    echo "📥 读取 Task 详情..."
    local task_json
    if ! task_json=$(fetch_task "$TASK_ID"); then
        return 1
    fi

    # 验证 Task 存在
    if [[ -z "$task_json" || "$task_json" == "null" ]]; then
        echo "❌ Task $TASK_ID 不存在" >&2
        return 1
    fi

    # 验证 description 不为空
    local description
    description=$(echo "$task_json" | jq -r '.description // ""')
    if [[ -z "$description" ]]; then
        echo "❌ Task $TASK_ID 的 PRD 内容为空" >&2
        return 1
    fi

    echo "✅ Task 详情读取成功"
    echo ""

    # 2. 读取上一个 Task 的反馈（如果有）
    local feature_id
    local order
    local prev_feedback=""

    feature_id=$(echo "$task_json" | jq -r '.feature_id // ""')
    order=$(echo "$task_json" | jq -r '.order // 0')

    if [[ -n "$feature_id" && "$order" -gt 1 ]]; then
        echo "📥 读取上一个 Task 的反馈..."
        local prev_order=$((order - 1))
        local feature_tasks
        feature_tasks=$(fetch_feature_tasks "$feature_id")

        # 查找 order = prev_order 的 Task
        local prev_task
        prev_task=$(echo "$feature_tasks" | jq ".[] | select(.order == $prev_order)")

        if [[ -n "$prev_task" && "$prev_task" != "null" ]]; then
            # 读取 feedback 字段
            prev_feedback=$(echo "$prev_task" | jq '.feedback // null')
            if [[ -n "$prev_feedback" && "$prev_feedback" != "null" ]]; then
                echo "✅ 找到上一个 Task 的反馈"
            else
                echo "ℹ️  上一个 Task 没有反馈"
            fi
        else
            echo "ℹ️  未找到上一个 Task"
        fi
        echo ""
    fi

    # 3. 生成 PRD 和 DoD
    generate_prd "$TASK_ID" "$task_json" "$prev_feedback"
    generate_dod "$TASK_ID" "$task_json"

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  ✅ PRD/DoD 生成完成"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

main "$@"
