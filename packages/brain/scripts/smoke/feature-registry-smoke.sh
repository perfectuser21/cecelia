#!/bin/bash
set -e
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
SMOKE_ID="smoke-test-feature"

echo "=== feature-registry smoke ==="

# 插入测试 feature（ON CONFLICT DO UPDATE 幂等）
curl -sf -X POST "$BRAIN_URL/api/brain/features" \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"$SMOKE_ID\",\"name\":\"Smoke Test Feature\",\"priority\":\"P0\",\"status\":\"active\"}" \
  2>/dev/null | jq -e '.id != null' > /dev/null \
  || curl -sf -X PATCH "$BRAIN_URL/api/brain/features/$SMOKE_ID" \
     -H "Content-Type: application/json" \
     -d '{"status":"active"}' 2>/dev/null | jq -e '.id != null' > /dev/null
echo "✅ POST|PATCH /api/brain/features — OK (upsert)"

# GET 返回 P0 features（含刚插入的）
RESULT=$(curl -sf "$BRAIN_URL/api/brain/features?priority=P0" 2>/dev/null)
echo "$RESULT" | jq -e 'type == "object" and .features != null and (.features | length) > 0' > /dev/null
echo "✅ GET /api/brain/features?priority=P0 — OK ($(echo "$RESULT" | jq '.total') features)"

# PATCH 回填 smoke_status
curl -sf -X PATCH "$BRAIN_URL/api/brain/features/$SMOKE_ID" \
  -H "Content-Type: application/json" \
  -d '{"smoke_status":"passing","smoke_last_run":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}' \
  | jq -e '.smoke_status == "passing"' > /dev/null
echo "✅ PATCH /api/brain/features/:id — OK"

# GET /:id 验证单条
curl -sf "$BRAIN_URL/api/brain/features/$SMOKE_ID" \
  | jq -e '.smoke_status == "passing"' > /dev/null
echo "✅ GET /api/brain/features/:id — OK"

echo "✅ feature-registry smoke PASSED"
