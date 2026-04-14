#!/usr/bin/env bash
# ============================================================================
# check-geo-website.sh — geo SEO 网站健康检查脚本
# 用于 KR4 验收和日常巡检：zenithjoyai.com 可访问性 + 内容 + SEO 基础
#
# 用法：bash scripts/check-geo-website.sh [--json]
# 返回：0 = 全部通过，1 = 有失败项
# ============================================================================

set -euo pipefail

SITE="https://zenithjoyai.com"
JSON_MODE="${1:-}"
FAIL_COUNT=0

_check() {
  local label="$1"
  local url="$2"
  local expected_code="${3:-200}"

  local actual
  actual=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -L "$url" 2>/dev/null || echo "000")

  if [[ "$actual" == "$expected_code" ]]; then
    echo "  ✅ $label ($actual)"
  else
    echo "  ❌ $label — 期望 ${expected_code}，实际 $actual"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

_check_content() {
  local label="$1"
  local url="$2"
  local pattern="$3"

  local content
  content=$(curl -s --max-time 15 -L "$url" 2>/dev/null || echo "")

  if echo "$content" | grep -q "$pattern"; then
    echo "  ✅ $label (内容包含: $pattern)"
  else
    echo "  ❌ $label — 内容中未找到: $pattern"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  geo 网站健康检查: $SITE"
echo "  时间: $(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S CST')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "【可访问性】"
_check "首页" "$SITE/"
_check "中文首页" "$SITE/zh/"
_check "英文首页" "$SITE/en/"
_check "博客列表" "$SITE/zh/blog/"
_check "动态列表" "$SITE/zh/posts/"
_check "关于页面" "$SITE/zh/about/"

echo ""
echo "【SEO 基础设施】"
_check "robots.txt" "$SITE/robots.txt"
_check "sitemap-index.xml" "$SITE/sitemap-index.xml"
_check "sitemap-0.xml" "$SITE/sitemap-0.xml"
_check "og-default.png" "$SITE/og-default.png"

echo ""
echo "【内容验收】"
_check "博文 prompt-engineering" "$SITE/zh/blog/prompt-engineering-101"
_check "博文 ai-content-workflow" "$SITE/zh/blog/ai-content-workflow"
_check "博文 automation-with-n8n" "$SITE/zh/blog/automation-with-n8n"
_check_content "动态页有内容" "$SITE/zh/posts/" "whitespace-pre-wrap"

echo ""
if [[ $FAIL_COUNT -eq 0 ]]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ✅ 全部通过（KR4 验收标准达成）"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
else
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ❌ ${FAIL_COUNT} 项失败"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi
