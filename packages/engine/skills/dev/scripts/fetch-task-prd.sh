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

# 从 Brain 读取 Initiative（Project）的 DoD
fetch_initiative_dod() {
    local project_id="$1"
    [[ -z "$project_id" || "$project_id" == "null" ]] && return 0

    local url="$BRAIN_URL/api/brain/projects/$project_id"
    local project_json
    project_json=$(curl --fail --silent --max-time "$TIMEOUT" "$url" 2>/dev/null) || return 0

    # 提取 metadata.dod 字段（数组）
    echo "$project_json" | jq -r '.metadata.dod // empty' 2>/dev/null
}

# 查询任务关联的 KR/Initiative/OKR 战略上下文（intent-expand）
# 沿 goal_id → goals(KR) → goals(OKR) → goals(Vision) 链查询
# 输出格式化的上下文字符串，无上下文时返回空字符串
fetch_intent_context() {
    local task_json="$1"
    local goal_id
    local project_id

    goal_id=$(echo "$task_json" | jq -r '.goal_id // empty' 2>/dev/null)
    project_id=$(echo "$task_json" | jq -r '.project_id // empty' 2>/dev/null)

    # 无关联 goal/project 时直接返回
    [[ -z "$goal_id" && -z "$project_id" ]] && return 0

    local context_lines=()

    # 查询 Project/Initiative 信息
    if [[ -n "$project_id" ]]; then
        local project_json
        project_json=$(curl --silent --max-time "$TIMEOUT" \
            "$BRAIN_URL/api/brain/projects/$project_id" 2>/dev/null) || true
        if [[ -n "$project_json" ]]; then
            local project_name
            project_name=$(echo "$project_json" | jq -r '.name // .title // empty' 2>/dev/null)
            [[ -n "$project_name" ]] && context_lines+=("**Initiative/Project**: $project_name")

            # 如果 goal_id 为空，尝试从 project 的 kr_id 获取
            if [[ -z "$goal_id" ]]; then
                goal_id=$(echo "$project_json" | jq -r '.kr_id // empty' 2>/dev/null)
            fi
        fi
    fi

    # 查询 KR（goal）信息并向上追溯 OKR → Vision
    if [[ -n "$goal_id" ]]; then
        local kr_json
        kr_json=$(curl --silent --max-time "$TIMEOUT" \
            "$BRAIN_URL/api/brain/goals/$goal_id" 2>/dev/null) || true
        if [[ -n "$kr_json" ]]; then
            local kr_title kr_desc parent_id
            kr_title=$(echo "$kr_json" | jq -r '.title // empty' 2>/dev/null)
            kr_desc=$(echo "$kr_json" | jq -r '.description // empty' 2>/dev/null)
            parent_id=$(echo "$kr_json" | jq -r '.parent_id // empty' 2>/dev/null)

            [[ -n "$kr_title" ]] && context_lines+=("**KR**: $kr_title")
            [[ -n "$kr_desc" ]] && context_lines+=("**KR 描述**: $kr_desc")

            # 向上查询 OKR
            if [[ -n "$parent_id" ]]; then
                local okr_json
                okr_json=$(curl --silent --max-time "$TIMEOUT" \
                    "$BRAIN_URL/api/brain/goals/$parent_id" 2>/dev/null) || true
                if [[ -n "$okr_json" ]]; then
                    local okr_title okr_parent_id
                    okr_title=$(echo "$okr_json" | jq -r '.title // empty' 2>/dev/null)
                    okr_parent_id=$(echo "$okr_json" | jq -r '.parent_id // empty' 2>/dev/null)

                    [[ -n "$okr_title" ]] && context_lines+=("**OKR/Objective**: $okr_title")

                    # 向上查询 Vision/Mission
                    if [[ -n "$okr_parent_id" ]]; then
                        local vision_json
                        vision_json=$(curl --silent --max-time "$TIMEOUT" \
                            "$BRAIN_URL/api/brain/goals/$okr_parent_id" 2>/dev/null) || true
                        local vision_title
                        vision_title=$(echo "$vision_json" | jq -r '.title // empty' 2>/dev/null)
                        [[ -n "$vision_title" ]] && context_lines+=("**Vision/Mission**: $vision_title")
                    fi
                fi
            fi
        fi
    fi

    # 无内容时返回空
    [[ ${#context_lines[@]} -eq 0 ]] && return 0

    # 输出格式化上下文
    printf '%s\n' "${context_lines[@]}"
}

# 搜索 docs/learnings/ 中与任务相关的历史 Learning
# 从任务标题提取关键词，返回最多 5 个相关文件路径（每行一个）
search_related_learnings() {
    local task_title="$1"
    local learnings_dir="${2:-docs/learnings}"

    [[ ! -d "$learnings_dir" ]] && return 0

    # 提取关键词：去除常见停用词，取前 5 个有效词
    local keywords=()
    while IFS= read -r word; do
        # 过滤长度 < 2 的词和纯标点
        [[ ${#word} -ge 2 ]] && keywords+=("$word")
        [[ ${#keywords[@]} -ge 5 ]] && break
    done < <(echo "$task_title" | tr ' ' '\n' | \
        grep -vE '^(的|是|在|了|和|与|or|and|the|for|with|to|a|an|from|修复|实现|添加|更新|优化|重构|P0|P1|P2|PR)$' \
        2>/dev/null || true)

    [[ ${#keywords[@]} -eq 0 ]] && return 0

    # 搜索每个关键词，收集匹配文件
    local found_files=()
    for kw in "${keywords[@]}"; do
        while IFS= read -r f; do
            found_files+=("$f")
        done < <(grep -Frl "$kw" "$learnings_dir" 2>/dev/null | head -3)
    done

    # 去重并限制最多 5 个
    local unique_files=()
    while IFS= read -r f; do
        unique_files+=("$f")
        [[ ${#unique_files[@]} -ge 5 ]] && break
    done < <(printf '%s\n' "${found_files[@]}" | sort -u)

    [[ ${#unique_files[@]} -eq 0 ]] && return 0

    printf '%s\n' "${unique_files[@]}"
}

# 生成 PRD 文件
# $4: intent_context — 战略上下文字符串（可为空）
# $5: related_learnings — 相关 Learning 文件列表（可为空，每行一个路径）
generate_prd() {
    local task_id="$1"
    local task_json="$2"
    local prev_feedback="$3"
    local intent_context="${4:-}"
    local related_learnings="${5:-}"

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

    # 添加战略上下文（intent-expand）
    if [[ -n "$intent_context" ]]; then
        cat >> "$prd_file" <<EOF
## 战略上下文

> 此任务关联的 KR/OKR/Vision 链路，确保实现方向与战略目标对齐。

$intent_context

EOF
    fi

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

    # 添加相关 Learning 推荐
    if [[ -n "$related_learnings" ]]; then
        cat >> "$prd_file" <<EOF

## 📖 相关历史 Learning（避免重复踩坑）

EOF
        while IFS= read -r learning_file; do
            [[ -z "$learning_file" ]] && continue
            echo "- \`$learning_file\`" >> "$prd_file"
        done <<< "$related_learnings"
    fi

    echo "✅ 已生成 PRD: $prd_file"
}

# 生成 DoD 文件
# $3: initiative_dod_json — Initiative 的 DoD（JSON 数组，每项含 item+test），可为空
generate_dod() {
    local task_id="$1"
    local task_json="$2"
    local initiative_dod_json="${3:-}"

    local dod_file=".dod-task-${task_id}.md"
    local title

    title=$(echo "$task_json" | jq -r '.title // "未命名任务"')

    # 有 Initiative DoD 时：用行为级条目生成 DoD
    if [[ -n "$initiative_dod_json" && "$initiative_dod_json" != "null" && "$initiative_dod_json" != "[]" ]]; then
        echo "📋 使用 Initiative DoD 生成行为级验收标准..."

        cat > "$dod_file" <<EOF
# DoD: $title

## 验收标准

### 功能验收
EOF

        # 遍历每个 DoD 条目，生成带 Test 字段的 checkbox
        local item_count
        item_count=$(echo "$initiative_dod_json" | jq 'length' 2>/dev/null || echo 0)

        for i in $(seq 0 $((item_count - 1))); do
            local item test_cmd
            item=$(echo "$initiative_dod_json" | jq -r ".[$i].item // .[$i] // "条目 $((i+1))"")
            test_cmd=$(echo "$initiative_dod_json" | jq -r ".[$i].test // "manual:TODO"")
            cat >> "$dod_file" <<EOF
- [ ] $item
      Test: $test_cmd
EOF
        done

        cat >> "$dod_file" <<EOF

### 测试验收
- [ ] CI 全部通过
      Test: contract:C2-001
EOF
        echo "✅ 已生成 DoD（来源：Initiative DoD，$item_count 条）: $dod_file"
        return 0
    fi

    # 无 Initiative DoD 时：使用通用模板
    echo "ℹ️  无 Initiative DoD，使用通用模板..."
    cat > "$dod_file" <<EOF
# DoD: $title

## 功能验收

- [ ] 功能按 PRD 实现
      Test: manual:TODO
- [ ] 手动测试通过
      Test: manual:TODO

## 测试验收

- [ ] 测试脚本存在且通过
      Test: manual:TODO

## 质量验收

- [ ] CI 全部通过
      Test: contract:C2-001
EOF

    echo "✅ 已生成 DoD（通用模板）: $dod_file"
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

    # 3. 读取 Initiative DoD（如有）
    local project_id
    project_id=$(echo "$task_json" | jq -r '.project_id // ""')
    local initiative_dod_json=""
    if [[ -n "$project_id" && "$project_id" != "null" ]]; then
        echo "📥 读取 Initiative DoD（project_id: $project_id）..."
        initiative_dod_json=$(fetch_initiative_dod "$project_id") || true
        if [[ -n "$initiative_dod_json" ]]; then
            echo "✅ 找到 Initiative DoD"
        else
            echo "ℹ️  Initiative 无 DoD，使用模板"
        fi
        echo ""
    fi

    # 4. 查询战略上下文（intent-expand）
    echo "📍 查询战略上下文（intent-expand）..."
    local intent_context=""
    intent_context=$(fetch_intent_context "$task_json") || true
    if [[ -n "$intent_context" ]]; then
        echo "✅ 找到战略上下文"
        echo "$intent_context" | while IFS= read -r line; do echo "   $line"; done
    else
        echo "ℹ️  任务无关联 KR/Initiative，跳过上下文注入"
    fi
    echo ""

    # 5. 搜索相关 Learning
    local task_title
    task_title=$(echo "$task_json" | jq -r '.title // ""')
    echo "📚 搜索相关 Learning..."
    local related_learnings=""
    related_learnings=$(search_related_learnings "$task_title") || true
    if [[ -n "$related_learnings" ]]; then
        echo "✅ 找到相关 Learning："
        echo "$related_learnings" | while IFS= read -r f; do echo "   - $f"; done
    else
        echo "ℹ️  未找到相关 Learning"
    fi
    echo ""

    # 6. 生成 PRD 和 DoD
    generate_prd "$TASK_ID" "$task_json" "$prev_feedback" "$intent_context" "$related_learnings"
    generate_dod "$TASK_ID" "$task_json" "$initiative_dod_json"

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  ✅ PRD/DoD 生成完成"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

main "$@"
