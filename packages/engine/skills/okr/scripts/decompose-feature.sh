#!/usr/bin/env bash
# OKR Feature Decomposition Script (Strategy C: Hybrid Planning)
#
# 功能：初始拆解用户需求为 Feature + Tasks
# 策略：混合规划（初始规划 3-5 个 Tasks，只详细写 Task 1）
#
# Usage:
#   bash decompose-feature.sh "用户需求描述"
#
# Output (JSON):
#   {
#     "feature": {
#       "title": "Feature 标题",
#       "description": "Feature 大 PRD（总体规划）",
#       "complexity": "single" | "multiple"
#     },
#     "tasks": [
#       {
#         "id": "task-001",
#         "title": "Task 1 标题",
#         "prd_status": "detailed",
#         "prd_content": "完整的 PRD 内容...",
#         "order": 1
#       },
#       {
#         "id": "task-002",
#         "title": "Task 2 标题",
#         "prd_status": "draft",
#         "prd_content": "简短描述...",
#         "order": 2
#       }
#     ]
#   }

set -euo pipefail

# ===== Configuration =====
REQUIREMENT="${1:-}"
OUTPUT_FORMAT="${2:-json}"  # json | text

# ===== Colors =====
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ===== Helper Functions =====

log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}" >&2
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}" >&2
}

log_warn() {
    echo -e "${YELLOW}⚠️  $1${NC}" >&2
}

log_error() {
    echo -e "${RED}❌ $1${NC}" >&2
}

# ===== Input Validation =====

if [ -z "$REQUIREMENT" ]; then
    log_error "需求描述不能为空"
    echo "Usage: $0 \"需求描述\""
    exit 1
fi

# ===== Complexity Analysis =====

# 判断单 Task vs 多 Task
# 简单关键词：修复、优化、添加（单个动作）
# 复杂关键词：实现、系统、完整、功能集

is_simple_requirement() {
    local req="$1"

    # 简单需求关键词（中文）
    if echo "$req" | grep -qE '修复|优化|调整|改进|删除|移除'; then
        return 0  # 简单
    fi

    # 复杂需求关键词（中文）
    if echo "$req" | grep -qE '实现.*系统|完整.*功能|.*和.*和|.*、.*、'; then
        return 1  # 复杂
    fi

    # 长度判断（>20 个中文字符可能是复杂需求）
    local char_count=$(echo "$req" | wc -m)
    if [ "$char_count" -gt 60 ]; then
        return 1  # 复杂
    fi

    # 默认简单
    return 0
}

# 判断复杂度
if is_simple_requirement "$REQUIREMENT"; then
    COMPLEXITY="single"
    log_info "判断为简单需求（单 Task 模式）"
else
    COMPLEXITY="multiple"
    log_info "判断为复杂需求（多 Task 迭代模式）"
fi

# ===== Feature Title & Description Generation =====

# 生成 Feature 标题（简化版，实际应调用 LLM）
# 这里使用简单规则生成标题
generate_feature_title() {
    local req="$1"

    # 提取前 20 个字符作为标题
    echo "$req" | head -c 60 | sed 's/[[:space:]]*$//'
}

FEATURE_TITLE=$(generate_feature_title "$REQUIREMENT")

# 生成 Feature 大 PRD（简化版）
FEATURE_DESCRIPTION="# $FEATURE_TITLE

## 需求背景

$REQUIREMENT

## 总体目标

根据需求分析，本 Feature 旨在实现上述功能。

## 实现策略

- 复杂度：$COMPLEXITY
- 预计 Tasks：$([ "$COMPLEXITY" = "single" ] && echo "1 个" || echo "3-5 个")

## 验收标准

- 功能完整实现
- 测试通过
- 文档更新
"

# ===== Task Generation =====

# 单 Task 模式
if [ "$COMPLEXITY" = "single" ]; then
    log_info "生成单 Task..."

    TASK_1_TITLE="$FEATURE_TITLE"
    TASK_1_PRD="# $TASK_1_TITLE

## 需求描述

$REQUIREMENT

## 实现方案

1. 分析需求
2. 实现功能
3. 编写测试
4. 验证完成

## 验收标准

- 功能实现完成
- 测试覆盖 >80%
- CI 通过
"

    TASKS_JSON='[
  {
    "id": "task-001",
    "title": "'"$TASK_1_TITLE"'",
    "prd_status": "detailed",
    "prd_content": '"$(echo "$TASK_1_PRD" | jq -Rs .)"',
    "order": 1
  }
]'

# 多 Task 模式
else
    log_info "生成多 Tasks（1 详细 + 2-4 草稿）..."

    # Task 1: 详细 PRD
    TASK_1_TITLE="第一步：基础实现"
    TASK_1_PRD="# $TASK_1_TITLE

## 需求描述

实现 $FEATURE_TITLE 的基础功能。

## 实现方案

1. 搭建基础架构
2. 实现核心逻辑
3. 编写基础测试

## 验收标准

- 基础功能可用
- 核心逻辑正确
- 测试覆盖 >70%
"

    # Task 2: 草稿
    TASK_2_TITLE="第二步：功能完善"
    TASK_2_BRIEF="基于 Task 1 的实现，完善功能细节和错误处理"

    # Task 3: 草稿
    TASK_3_TITLE="第三步：集成测试"
    TASK_3_BRIEF="编写集成测试，验证整体功能"

    TASKS_JSON='[
  {
    "id": "task-001",
    "title": "'"$TASK_1_TITLE"'",
    "prd_status": "detailed",
    "prd_content": '"$(echo "$TASK_1_PRD" | jq -Rs .)"',
    "order": 1
  },
  {
    "id": "task-002",
    "title": "'"$TASK_2_TITLE"'",
    "prd_status": "draft",
    "prd_content": "草稿：'"$TASK_2_BRIEF"'",
    "order": 2
  },
  {
    "id": "task-003",
    "title": "'"$TASK_3_TITLE"'",
    "prd_status": "draft",
    "prd_content": "草稿：'"$TASK_3_BRIEF"'",
    "order": 3
  }
]'
fi

# ===== Output JSON =====

OUTPUT_JSON=$(cat <<EOF
{
  "feature": {
    "title": "$FEATURE_TITLE",
    "description": $(echo "$FEATURE_DESCRIPTION" | jq -Rs .),
    "complexity": "$COMPLEXITY"
  },
  "tasks": $TASKS_JSON
}
EOF
)

# ===== Output =====

if [ "$OUTPUT_FORMAT" = "text" ]; then
    log_success "Feature 拆解完成"
    echo ""
    echo "Feature: $FEATURE_TITLE"
    echo "复杂度: $COMPLEXITY"
    echo "Tasks: $(echo "$TASKS_JSON" | jq length)"
    echo ""
else
    # JSON 输出（供后续脚本处理）
    echo "$OUTPUT_JSON"
fi

log_success "拆解完成" >&2
