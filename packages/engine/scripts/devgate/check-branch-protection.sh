#!/bin/bash
set -e

# CI 压力测试修复 #1: 分支保护验证脚本
# 由于 gh api 可能返回 404（权限问题），改用 gh repo view 验证

REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null || echo "unknown/unknown")

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  分支保护验证 (Branch Protection Check)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Repository: $REPO"
echo ""

# 检查 main 分支保护
echo "检查 main 分支保护..."
echo ""

# 尝试使用 API（可能失败）
MAIN_PROTECTION=$(gh api "repos/$REPO/branches/main/protection" 2>&1 || echo "API_FAILED")

if [[ "$MAIN_PROTECTION" == *"API_FAILED"* ]] || [[ "$MAIN_PROTECTION" == *"404"* ]]; then
  echo "⚠️  无法通过 API 获取分支保护状态（可能需要 admin 权限）"
  echo ""
  echo "手动验证步骤："
  echo "  1. 访问: https://github.com/$REPO/settings/branches"
  echo "  2. 确认 main 分支保护规则："
  echo "     - Require status checks before merging: ✓"
  echo "     - Required check: ci-passed"
  echo "     - Do not allow bypassing the above settings: ✓ (enforce_admins)"
  echo "     - Restrict force pushes: ✓"
  echo "     - Restrict branch deletion: ✓"
  echo ""
  echo "状态: ⚠️  需要手动验证"
else
  echo "✅ API 访问成功"
  echo ""
  echo "main 分支保护状态:"
  echo "$MAIN_PROTECTION" | jq '{
    required_status_checks: .required_status_checks,
    enforce_admins: .enforce_admins,
    restrictions: .restrictions,
    required_pull_request_reviews: .required_pull_request_reviews,
    allow_force_pushes: .allow_force_pushes,
    allow_deletions: .allow_deletions
  }' || echo "$MAIN_PROTECTION"
  echo ""

  # 检查关键配置
  ENFORCE_ADMINS=$(echo "$MAIN_PROTECTION" | jq -r '.enforce_admins.enabled // false')
  if [[ "$ENFORCE_ADMINS" == "true" ]]; then
    echo "✅ enforce_admins: enabled"
  else
    echo "❌ enforce_admins: disabled（Admin 可以绕过 CI）"
  fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 检查 develop 分支保护
echo "检查 develop 分支保护..."
echo ""

DEVELOP_PROTECTION=$(gh api "repos/$REPO/branches/develop/protection" 2>&1 || echo "API_FAILED")

if [[ "$DEVELOP_PROTECTION" == *"API_FAILED"* ]] || [[ "$DEVELOP_PROTECTION" == *"404"* ]]; then
  echo "⚠️  无法通过 API 获取分支保护状态（可能需要 admin 权限）"
  echo ""
  echo "手动验证步骤："
  echo "  1. 访问: https://github.com/$REPO/settings/branches"
  echo "  2. 确认 develop 分支保护规则同 main"
  echo ""
  echo "状态: ⚠️  需要手动验证"
else
  echo "✅ API 访问成功"
  echo ""
  echo "develop 分支保护状态:"
  echo "$DEVELOP_PROTECTION" | jq '{
    required_status_checks: .required_status_checks,
    enforce_admins: .enforce_admins,
    restrictions: .restrictions,
    required_pull_request_reviews: .required_pull_request_reviews,
    allow_force_pushes: .allow_force_pushes,
    allow_deletions: .allow_deletions
  }' || echo "$DEVELOP_PROTECTION"
  echo ""

  ENFORCE_ADMINS=$(echo "$DEVELOP_PROTECTION" | jq -r '.enforce_admins.enabled // false')
  if [[ "$ENFORCE_ADMINS" == "true" ]]; then
    echo "✅ enforce_admins: enabled"
  else
    echo "❌ enforce_admins: disabled（Admin 可以绕过 CI）"
  fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  验证完成"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "建议："
echo "  - 如果看到 ⚠️ 需要手动验证，请访问 GitHub Web UI 确认"
echo "  - enforce_admins 必须启用，防止 Admin 绕过 CI"
echo "  - 定期运行此脚本检查分支保护状态"
echo ""
