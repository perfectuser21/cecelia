#!/usr/bin/env bash
# ZenithJoy Engine - 生成任务质检报告
# 在 cleanup 前调用，生成 txt 和 json 两种格式的报告
#
# 用法: bash skills/dev/scripts/generate-report.sh <cp-分支名> <base-分支名>
# 例如: bash skills/dev/scripts/generate-report.sh cp-01191030-task develop

set -euo pipefail

# 参数
CP_BRANCH="${1:-}"
BASE_BRANCH="${2:-develop}"
PROJECT_ROOT="${3:-$(pwd)}"
# L3 fix: 环境变量文档化
# CLAUDE_MODE: 运行模式，可选值:
#   - interactive: 有头模式（默认），用户交互
#   - headless: 无头模式（Cecelia），自动执行
MODE="${CLAUDE_MODE:-interactive}"

if [[ -z "$CP_BRANCH" ]]; then
    echo "错误: 请提供 cp-* 分支名"
    echo "用法: bash generate-report.sh <cp-分支名> [base-分支名] [project-root]"
    exit 1
fi

# 创建 .dev-runs 目录
mkdir -p "$PROJECT_ROOT/.dev-runs"

# 获取任务信息
TASK_ID="$CP_BRANCH"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M')
DATE_ONLY=$(date '+%Y-%m-%d')

# 读取质检报告（如果存在）
QUALITY_REPORT="$PROJECT_ROOT/.quality-report.json"
if [[ -f "$QUALITY_REPORT" ]]; then
    L1_STATUS=$(jq -r '.layers.L1_automated.status // "unknown"' "$QUALITY_REPORT" 2>/dev/null || echo "unknown")
    L2_STATUS=$(jq -r '.layers.L2_verification.status // "unknown"' "$QUALITY_REPORT" 2>/dev/null || echo "unknown")
    L3_STATUS=$(jq -r '.layers.L3_acceptance.status // "unknown"' "$QUALITY_REPORT" 2>/dev/null || echo "unknown")
    OVERALL_STATUS=$(jq -r '.overall // "unknown"' "$QUALITY_REPORT" 2>/dev/null || echo "unknown")
else
    L1_STATUS="unknown"
    L2_STATUS="unknown"
    L3_STATUS="unknown"
    OVERALL_STATUS="unknown"
fi

# 读取项目信息（从 package.json）
if [[ -f "$PROJECT_ROOT/package.json" ]]; then
    PROJECT_NAME=$(jq -r '.name // "unknown"' "$PROJECT_ROOT/package.json" 2>/dev/null || echo "unknown")
else
    PROJECT_NAME=$(basename "$PROJECT_ROOT")
fi

# L2 fix: 获取 git 信息，区分无 PR 和 API 错误
PR_URL=""
PR_MERGED="false"
PR_API_ERROR=""

# 尝试获取已合并的 PR
PR_RESULT=$(gh pr list --head "$CP_BRANCH" --state merged --json url -q '.[0].url' 2>&1)
PR_EXIT=$?
if [[ $PR_EXIT -eq 0 && -n "$PR_RESULT" && "$PR_RESULT" != "null" ]]; then
    PR_URL="$PR_RESULT"
    PR_MERGED="true"
elif [[ $PR_EXIT -ne 0 ]]; then
    PR_API_ERROR="$PR_RESULT"
fi

# 如果没有已合并的 PR，检查是否有任何 PR
if [[ -z "$PR_URL" && -z "$PR_API_ERROR" ]]; then
    PR_RESULT=$(gh pr list --head "$CP_BRANCH" --state all --json url -q '.[0].url' 2>&1)
    PR_EXIT=$?
    if [[ $PR_EXIT -eq 0 && -n "$PR_RESULT" && "$PR_RESULT" != "null" ]]; then
        PR_URL="$PR_RESULT"
    elif [[ $PR_EXIT -ne 0 ]]; then
        PR_API_ERROR="$PR_RESULT"
    fi
fi

# 设置默认值
if [[ -z "$PR_URL" ]]; then
    if [[ -n "$PR_API_ERROR" ]]; then
        PR_URL="API Error: $PR_API_ERROR"
    else
        PR_URL="N/A"
    fi
fi

# v8: 不再使用步骤状态机，报告在 cleanup 阶段生成表示流程已完成

# L2 fix: 获取变更文件，处理 git diff 失败
FILES_CHANGED=""
GIT_DIFF_ERROR=""

if git rev-parse --verify "$CP_BRANCH" &>/dev/null; then
    # 检查 BASE_BRANCH 是否存在
    if git rev-parse --verify "$BASE_BRANCH" &>/dev/null; then
        DIFF_RESULT=$(git diff --name-only "$BASE_BRANCH"..."$CP_BRANCH" 2>&1)
        DIFF_EXIT=$?
        if [[ $DIFF_EXIT -eq 0 ]]; then
            FILES_CHANGED=$(echo "$DIFF_RESULT" | head -20)
        else
            GIT_DIFF_ERROR="$DIFF_RESULT"
        fi
    else
        GIT_DIFF_ERROR="Base branch $BASE_BRANCH not found"
    fi
fi

# 如果 git diff 为空或失败，从 PR API 获取
if [[ -z "$FILES_CHANGED" ]]; then
    PR_FILES=$(gh pr list --head "$CP_BRANCH" --state all --json files -q '.[0].files[].path' 2>/dev/null | head -20 || echo "")
    if [[ -n "$PR_FILES" ]]; then
        FILES_CHANGED="$PR_FILES"
    elif [[ -n "$GIT_DIFF_ERROR" ]]; then
        # 如果 git diff 失败且 PR API 也没数据，记录错误
        FILES_CHANGED="(Error: $GIT_DIFF_ERROR)"
    fi
fi

# 获取版本变更（从 package.json）
CURRENT_VERSION=$(jq -r '.version // "unknown"' "$PROJECT_ROOT/package.json" 2>/dev/null || echo "unknown")

# 生成 TXT 报告
TXT_REPORT="$PROJECT_ROOT/.dev-runs/${TASK_ID}-report.txt"
cat > "$TXT_REPORT" << EOF
================================================================================
                          任务完成报告
================================================================================

任务ID:     $TASK_ID
项目:       $PROJECT_NAME
分支:       $CP_BRANCH -> $BASE_BRANCH
模式:       $MODE
时间:       $TIMESTAMP

--------------------------------------------------------------------------------
质检详情 (重点)
--------------------------------------------------------------------------------

Layer 1: 自动化测试
  - 状态: $L1_STATUS

Layer 2: 效果验证
  - 状态: $L2_STATUS

Layer 3: 需求验收 (DoD)
  - 状态: $L3_STATUS

质检结论: $OVERALL_STATUS

--------------------------------------------------------------------------------
CI/CD
--------------------------------------------------------------------------------
PR:         $PR_URL
PR 状态:    $([ "$PR_MERGED" = "true" ] && echo "已合并" || echo "未合并")

--------------------------------------------------------------------------------
变更文件
--------------------------------------------------------------------------------
$FILES_CHANGED

--------------------------------------------------------------------------------
版本
--------------------------------------------------------------------------------
当前版本:   $CURRENT_VERSION

================================================================================
EOF

echo "已生成报告: $TXT_REPORT"

# 生成 JSON 报告（供 Cecilia 读取）
JSON_REPORT="$PROJECT_ROOT/.dev-runs/${TASK_ID}-report.json"
cat > "$JSON_REPORT" << EOF
{
  "task_id": "$TASK_ID",
  "project": "$PROJECT_NAME",
  "branch": "$CP_BRANCH",
  "base_branch": "$BASE_BRANCH",
  "mode": "$MODE",
  "timestamp": "$TIMESTAMP",
  "date": "$DATE_ONLY",
  "quality_report": {
    "L1_automated": "$L1_STATUS",
    "L2_verification": "$L2_STATUS",
    "L3_acceptance": "$L3_STATUS",
    "overall": "$OVERALL_STATUS"
  },
  "ci_cd": {
    "pr_url": "$PR_URL",
    "pr_merged": $PR_MERGED
  },
  "version": "$CURRENT_VERSION",
  "files_changed": $(
    if [[ -n "$FILES_CHANGED" ]]; then
      # L1 fix: 安全处理空行和特殊字符，使用 jq 构建数组
      echo "$FILES_CHANGED" | jq -R -s 'split("\n") | map(select(length > 0))'
    else
      echo "[]"
    fi
  )
}
EOF

echo "已生成报告: $JSON_REPORT"
