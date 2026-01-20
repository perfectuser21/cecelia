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

# 获取 git 信息
PR_URL=$(gh pr list --head "$CP_BRANCH" --state merged --json url -q '.[0].url' 2>/dev/null || echo "")
PR_MERGED="false"
if [[ -n "$PR_URL" ]]; then
    PR_MERGED="true"
else
    # 如果没有已合并的 PR，检查是否有任何 PR
    PR_URL=$(gh pr list --head "$CP_BRANCH" --state all --json url -q '.[0].url' 2>/dev/null || echo "")
    if [[ -z "$PR_URL" ]]; then
        PR_URL="N/A"
    fi
fi

# v8: 不再使用步骤状态机，报告在 cleanup 阶段生成表示流程已完成

# 获取变更文件（先尝试 git diff，如果为空则从 PR API 获取）
FILES_CHANGED=""
if git rev-parse --verify "$CP_BRANCH" &>/dev/null; then
    FILES_CHANGED=$(git diff --name-only "$BASE_BRANCH"..."$CP_BRANCH" 2>/dev/null | head -20 || echo "")
fi

# 如果 git diff 为空（PR 已合并或分支不存在），从 PR API 获取
if [[ -z "$FILES_CHANGED" ]]; then
    FILES_CHANGED=$(gh pr list --head "$CP_BRANCH" --state all --json files -q '.[0].files[].path' 2>/dev/null | head -20 || echo "")
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
  "files_changed": [
$(echo "$FILES_CHANGED" | sed 's/^/    "/; s/$/",/' | sed '$ s/,$//')
  ]
}
EOF

echo "已生成报告: $JSON_REPORT"
