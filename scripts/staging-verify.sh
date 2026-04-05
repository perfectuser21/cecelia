#!/usr/bin/env bash
# staging-verify.sh — 验证 Staging Brain 健康状态
#
# 退出码：
#   0 = STAGING_OK（所有检查通过）
#   1 = STAGING_FAIL（一个或多个检查失败）
#
# 在 CI deploy.yml staging_deploy job 中调用，
# 通过后才允许 production deploy job 执行。

set -euo pipefail

STAGING_PORT=5222
STAGING_URL="http://localhost:${STAGING_PORT}"
FAILED=0

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; FAILED=$((FAILED + 1)); }

echo "=== Staging Smoke Test (port ${STAGING_PORT}) ==="
echo ""

# ── 1. 基础健康检查 ───────────────────────────────────────────────────────────
echo "1. 基础健康检查"

HTTP_CODE=$(curl -s -o /tmp/staging_health.txt -w "%{http_code}" \
    "${STAGING_URL}/api/brain/health" \
    --connect-timeout 10 --max-time 20 2>/dev/null || echo "000")

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ] 2>/dev/null; then
    pass "/api/brain/health → HTTP ${HTTP_CODE}"
else
    fail "/api/brain/health → HTTP ${HTTP_CODE}（期望 2xx）"
fi

# ── 2. Tick 状态端点可访问 ────────────────────────────────────────────────────
echo ""
echo "2. Tick 状态端点"

TICK_JSON=$(curl -s "${STAGING_URL}/api/brain/tick/status" \
    --connect-timeout 10 --max-time 20 2>/dev/null || echo "{}")

if echo "$TICK_JSON" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  process.exit(d.hasOwnProperty('enabled') ? 0 : 1);
" 2>/dev/null; then
    TICK_ENABLED=$(echo "$TICK_JSON" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.enabled)" 2>/dev/null || echo "?")
    pass "/api/brain/tick/status 可访问（enabled=${TICK_ENABLED}）"
else
    fail "/api/brain/tick/status 响应缺少 enabled 字段"
fi

# ── 3. 验证 Tick 在 Staging 中为关闭状态（防止 staging 抢任务）─────────────
echo ""
echo "3. Staging Tick 隔离验证"

TICK_ENABLED_VAL=$(echo "$TICK_JSON" | node -e "
  try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log(d.enabled)}catch(e){console.log('error')}" 2>/dev/null || echo "error")

if [ "$TICK_ENABLED_VAL" = "false" ]; then
    pass "Staging tick 已禁用（CECELIA_TICK_ENABLED=false）"
else
    fail "Staging tick 未禁用（enabled=${TICK_ENABLED_VAL}，staging 可能抢 production 任务）"
fi

# ── 4. DB 连接（通过 tasks 端点间接验证）──────────────────────────────────────
echo ""
echo "4. 数据库连接验证"

TASKS_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    "${STAGING_URL}/api/brain/tasks?limit=1" \
    --connect-timeout 10 --max-time 20 2>/dev/null || echo "000")

if [ "$TASKS_CODE" -ge 200 ] && [ "$TASKS_CODE" -lt 300 ] 2>/dev/null; then
    pass "/api/brain/tasks 可访问（DB 连接正常）"
else
    fail "/api/brain/tasks → HTTP ${TASKS_CODE}（DB 连接可能失败）"
fi

# ── 总结 ──────────────────────────────────────────────────────────────────────
echo ""
echo "========================================"
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}STAGING_OK${NC} — 所有 ${STAGING_PORT} 检查通过，可以提升到 production"
    exit 0
else
    echo -e "${RED}STAGING_FAIL${NC} — ${FAILED} 项检查失败，阻止 production deploy"
    echo "  日志: docker logs cecelia-node-brain-staging --tail 50"
    echo "  清理: docker stop cecelia-node-brain-staging && docker rm cecelia-node-brain-staging"
    exit 1
fi
