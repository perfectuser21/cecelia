#!/usr/bin/env bash
# Smoke: codex-bridge-health — goals.js /health 新增 codex_bridge_status 字段验证
#
# 验证点：
#   1. goals.js 包含 codex_bridge_status 字段写入逻辑
#   2. goals.js 包含 XIAN_CODEX_BRIDGE_URL 或默认 IP 探活 URL
#   3. goals.js 包含 offline fallback（catch + 'offline' 字符串）
#
# 退出码：0 = PASS，1 = FAIL
set -uo pipefail

GOALS="packages/brain/src/routes/goals.js"
if [ ! -f "$GOALS" ]; then
  echo "SKIP: $GOALS 不存在"
  exit 0
fi

CONTENT=$(cat "$GOALS")
FAIL=0

if ! echo "$CONTENT" | grep -q 'codex_bridge_status'; then
  echo "FAIL: goals.js 未包含 codex_bridge_status 字段"
  FAIL=1
fi

if ! echo "$CONTENT" | grep -qE 'XIAN_CODEX_BRIDGE_URL|100\.86\.57\.69'; then
  echo "FAIL: goals.js 未包含 XIAN_CODEX_BRIDGE_URL 或默认探活 IP"
  FAIL=1
fi

if ! echo "$CONTENT" | grep -q "'offline'"; then
  echo "FAIL: goals.js 未包含 offline fallback"
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  echo "PASS: codex_bridge_status 探活逻辑完整"
fi

exit $FAIL
