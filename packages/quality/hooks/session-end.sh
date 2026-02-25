#!/usr/bin/env bash
# ============================================================================
# SessionEnd Hook: CI 状态检查
# ============================================================================
# 会话结束时检查最近的 PR 的 CI 状态
# 如果 CI 失败，提示用户
# ============================================================================

set -euo pipefail

# ===== 获取项目根目录 =====
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# ===== 检查是否在 git 仓库中 =====
if ! git rev-parse --git-dir &>/dev/null; then
    exit 0  # 不在 git 仓库，跳过
fi

# ===== 获取当前分支 =====
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

if [[ -z "$CURRENT_BRANCH" ]]; then
    exit 0  # 无法获取分支，跳过
fi

# ===== 只检查功能分支 =====
if [[ ! "$CURRENT_BRANCH" =~ ^cp- ]] && [[ ! "$CURRENT_BRANCH" =~ ^feature/ ]]; then
    exit 0  # 不是功能分支，跳过
fi

# ===== 检查是否有 PR =====
PR_NUMBER=$(gh pr list --head "$CURRENT_BRANCH" --state open --json number -q '.[0].number' 2>/dev/null || echo "")

if [[ -z "$PR_NUMBER" ]]; then
    exit 0  # 没有 PR，跳过
fi

# ===== 检查 CI 状态 =====
echo "" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "  [CI 状态检查]" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "" >&2
echo "  分支: $CURRENT_BRANCH" >&2
echo "  PR #$PR_NUMBER" >&2
echo "" >&2

# 获取 CI 检查状态
CI_CHECKS=$(gh pr checks "$PR_NUMBER" --json name,state,conclusion 2>/dev/null || echo "[]")

if [[ "$CI_CHECKS" == "[]" || -z "$CI_CHECKS" ]]; then
    echo "  ⏳ CI 检查尚未运行或尚未完成" >&2
    echo "" >&2
    echo "  查看 PR: gh pr view $PR_NUMBER --web" >&2
    exit 0
fi

# 解析检查结果
TOTAL_CHECKS=$(echo "$CI_CHECKS" | jq 'length')
PENDING_CHECKS=$(echo "$CI_CHECKS" | jq '[.[] | select(.state == "PENDING")] | length')
SUCCESS_CHECKS=$(echo "$CI_CHECKS" | jq '[.[] | select(.conclusion == "SUCCESS")] | length')
FAILURE_CHECKS=$(echo "$CI_CHECKS" | jq '[.[] | select(.conclusion == "FAILURE")] | length')

echo "  CI 检查统计:" >&2
echo "    总计: $TOTAL_CHECKS" >&2
echo "    成功: $SUCCESS_CHECKS" >&2
echo "    失败: $FAILURE_CHECKS" >&2
echo "    进行中: $PENDING_CHECKS" >&2
echo "" >&2

# 如果有失败的检查
if [[ $FAILURE_CHECKS -gt 0 ]]; then
    echo "  ❌ CI 检查失败！" >&2
    echo "" >&2
    echo "  失败的检查:" >&2
    echo "$CI_CHECKS" | jq -r '.[] | select(.conclusion == "FAILURE") | "    - \(.name): \(.state)"' >&2
    echo "" >&2
    echo "  修复步骤:" >&2
    echo "    1. 查看失败详情: gh pr checks $PR_NUMBER" >&2
    echo "    2. 或访问 PR 页面: gh pr view $PR_NUMBER --web" >&2
    echo "    3. 修复问题后重新提交" >&2
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2

    # 注意：这里 exit 0 而不是 exit 2
    # 因为 SessionEnd Hook 的 exit 2 不会阻止会话结束
    # 只是提示用户
    exit 0
fi

# 如果还有进行中的检查
if [[ $PENDING_CHECKS -gt 0 ]]; then
    echo "  ⏳ CI 检查进行中..." >&2
    echo "" >&2
    echo "  查看进度: gh pr checks $PR_NUMBER --watch" >&2
    echo "  或访问: gh pr view $PR_NUMBER --web" >&2
    exit 0
fi

# 全部成功
if [[ $SUCCESS_CHECKS -eq $TOTAL_CHECKS ]]; then
    echo "  ✅ 所有 CI 检查通过！" >&2
    echo "" >&2
    echo "  PR 状态: gh pr view $PR_NUMBER" >&2
    exit 0
fi

exit 0
