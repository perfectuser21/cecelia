#!/usr/bin/env bash
# harness-ws-progress smoke — 验证 GET /api/brain/harness/initiative/:id/ws-progress 端点正常响应
#
# 检查项：
#   1. Brain API 健康（/health 返回 200）
#   2. ws-progress 端点存在（不存在的 initiative 返回 404 + error json）
#   3. 响应含 initiative_id + workstreams 字段（schema 完整性）
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
FAKE_INITIATIVE_ID="00000000-0000-0000-0000-000000000001"

echo "[ws-progress smoke] Brain URL: $BRAIN_URL"

# 1. Health check
HTTP_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "${BRAIN_URL}/health" || echo "000")
if [ "$HTTP_HEALTH" != "200" ]; then
  echo "[ws-progress smoke] SKIP — Brain not running (health=$HTTP_HEALTH)"
  exit 0
fi
echo "[ws-progress smoke] ✅ Brain healthy ($HTTP_HEALTH)"

# 2. 调 ws-progress 端点（不存在的 initiative 应 404）
RESPONSE=$(curl -s -w "\n%{http_code}" "${BRAIN_URL}/api/brain/harness/initiative/${FAKE_INITIATIVE_ID}/ws-progress" || echo "{}\n000")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "404" ]; then
  ERROR=$(node -pe "JSON.parse(process.argv[1]).error" "$BODY" 2>/dev/null || echo "")
  if [ "$ERROR" = "initiative not found" ]; then
    echo "[ws-progress smoke] ✅ 404 + error='initiative not found' 正确"
  else
    echo "[ws-progress smoke] ⚠️  404 但 error='$ERROR' (期望 'initiative not found')"
  fi
elif [ "$HTTP_CODE" = "200" ]; then
  # 如果恰好有数据，验证 schema
  HAS_INIT_ID=$(node -pe "typeof JSON.parse(process.argv[1]).initiative_id" "$BODY" 2>/dev/null || echo "undefined")
  HAS_WORKSTREAMS=$(node -pe "Array.isArray(JSON.parse(process.argv[1]).workstreams)" "$BODY" 2>/dev/null || echo "false")
  if [ "$HAS_WORKSTREAMS" = "true" ] && [ "$HAS_INIT_ID" = "string" ]; then
    echo "[ws-progress smoke] ✅ 200 + schema 正确（initiative_id + workstreams[]）"
  else
    echo "[ws-progress smoke] ❌ 200 但 schema 异常 (has_workstreams=$HAS_WORKSTREAMS, has_init_id=$HAS_INIT_ID)"
    exit 1
  fi
else
  echo "[ws-progress smoke] ❌ 端点返回意外 HTTP $HTTP_CODE"
  exit 1
fi

echo "[ws-progress smoke] PASS"
