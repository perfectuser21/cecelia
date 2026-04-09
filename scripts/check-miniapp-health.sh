#!/usr/bin/env bash
# check-miniapp-health.sh — ZenithJoy 微信小程序健康检查
# KR3: 微信小程序上线 — 基础功能可用，无重大bug
# 用法: bash scripts/check-miniapp-health.sh [miniapp-path]

set -euo pipefail

MINIAPP_PATH="${1:-$HOME/perfect21/zenithjoy-miniapp}"
APP_JSON="$MINIAPP_PATH/miniprogram/app.json"
PAGES_ROOT="$MINIAPP_PATH/miniprogram/pages"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

pass() { echo -e "${GREEN}✅ $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; FAILED=$((FAILED + 1)); }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }

FAILED=0
TOTAL=0

echo "=== ZenithJoy Miniapp 健康检查 ==="
echo "路径: $MINIAPP_PATH"
echo ""

# 1. 检查 app.json 存在
TOTAL=$((TOTAL + 1))
if [[ -f "$APP_JSON" ]]; then
  pass "app.json 存在"
else
  fail "app.json 不存在 — $APP_JSON"
  exit 1
fi

# 2. 读取并验证注册的页面
echo ""
echo "--- 页面注册检查 ---"
REGISTERED_PAGES=$(node -e "
const cfg = JSON.parse(require('fs').readFileSync('$APP_JSON','utf8'));
const pages = cfg.pages || [];
console.log(pages.join('\n'));
")

PAGE_COUNT=$(echo "$REGISTERED_PAGES" | wc -l | tr -d ' ')
echo "已注册页面数: $PAGE_COUNT"

while IFS= read -r page; do
  [[ -z "$page" ]] && continue
  TOTAL=$((TOTAL + 1))
  # 找到对应的目录和 JS 文件
  PAGE_DIR="$MINIAPP_PATH/miniprogram/$page"
  PAGE_JS="${PAGE_DIR}.js"
  PAGE_DIR_JS="$MINIAPP_PATH/miniprogram/$(dirname "$page")/$(basename "$page").js"

  if [[ -f "$PAGE_JS" ]] || [[ -f "$PAGE_DIR_JS" ]]; then
    pass "页面存在: $page"
  else
    fail "页面注册但目录/JS 不存在: $page"
  fi
done <<< "$REGISTERED_PAGES"

# 3. 检查页面目录是否有未注册的页面
echo ""
echo "--- 未注册页面检查 ---"
if [[ -d "$PAGES_ROOT" ]]; then
  for dir in "$PAGES_ROOT"/*/; do
    dir_name=$(basename "$dir")
    # 检查该目录下是否有 JS 文件
    if ls "$dir"*.js &>/dev/null 2>&1; then
      # 检查是否在 app.json 中注册
      registered=false
      while IFS= read -r page; do
        if [[ "$page" == "pages/$dir_name/"* ]]; then
          registered=true
          break
        fi
      done <<< "$REGISTERED_PAGES"

      if [[ "$registered" == "false" ]]; then
        warn "页面目录存在但未注册: pages/$dir_name"
      fi
    fi
  done
fi

# 4. 检查安全问题
echo ""
echo "--- 安全检查 ---"
TOTAL=$((TOTAL + 1))
HARDCODED_KEY=$(grep -r "pat_[A-Za-z0-9]\{20,\}" "$MINIAPP_PATH/miniprogram" 2>/dev/null || true)
if [[ -z "$HARDCODED_KEY" ]]; then
  pass "无硬编码 API Key（pat_ 模式）"
else
  fail "发现硬编码 API Key: $HARDCODED_KEY"
fi

# 5. 检查 chatHistory openid 字面字符串 bug
TOTAL=$((TOTAL + 1))
OPENID_BUG=$(grep -r "'{openid}'" "$MINIAPP_PATH/miniprogram" 2>/dev/null || true)
if [[ -z "$OPENID_BUG" ]]; then
  pass "无 openid 字面字符串 bug"
else
  fail "发现 openid 字面字符串 bug: $OPENID_BUG"
fi

# 6. 检查 cloud 函数目录
echo ""
echo "--- 云函数检查 ---"
TOTAL=$((TOTAL + 1))
if [[ -d "$MINIAPP_PATH/cloudfunctions" ]]; then
  CF_COUNT=$(ls "$MINIAPP_PATH/cloudfunctions" | wc -l | tr -d ' ')
  pass "云函数目录存在（$CF_COUNT 个函数）"
else
  fail "云函数目录不存在"
fi

# 7. 汇总
echo ""
echo "=== 检查结果 ==="
echo "总检查项: $TOTAL | 通过: $((TOTAL - FAILED)) | 失败: $FAILED"
echo ""

if [[ $FAILED -eq 0 ]]; then
  echo -e "${GREEN}🟢 Miniapp 健康状态：PASS — 可部署${NC}"
  exit 0
else
  echo -e "${RED}🔴 Miniapp 健康状态：FAIL — 需修复 $FAILED 项${NC}"
  exit 1
fi
