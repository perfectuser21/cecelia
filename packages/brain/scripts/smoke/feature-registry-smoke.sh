#!/bin/bash
set -e
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "=== feature-registry smoke ==="

# 先 seed，确保有数据（ON CONFLICT DO UPDATE，幂等）
SEED_RESULT=$(curl -sf -X POST "$BRAIN_URL/api/brain/features/seed" \
  -H "Content-Type: application/json" 2>/dev/null)
echo "Seed: $SEED_RESULT"
echo "$SEED_RESULT" | jq -e '.total > 0' > /dev/null
echo "✅ POST /seed — OK"

# 验证 GET 返回非空 P0 数组
RESULT=$(curl -sf "$BRAIN_URL/api/brain/features?priority=P0" 2>/dev/null)
echo "$RESULT" | jq -e 'type == "object" and .features != null and (.features | length) > 0' > /dev/null
echo "✅ GET /api/brain/features?priority=P0 — OK ($(echo "$RESULT" | jq '.total') features)"

# 验证 PATCH 更新 smoke_status
SAMPLE_ID=$(echo "$RESULT" | jq -r '.features[0].id')
[ -n "$SAMPLE_ID" ] && [ "$SAMPLE_ID" != "null" ] || { echo "❌ No P0 feature found for PATCH test"; exit 1; }
curl -sf -X PATCH "$BRAIN_URL/api/brain/features/$SAMPLE_ID" \
  -H "Content-Type: application/json" \
  -d '{"smoke_status":"passing","smoke_last_run":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}' \
  | jq -e '.smoke_status == "passing"' > /dev/null
echo "✅ PATCH /api/brain/features/:id — OK"

echo "✅ feature-registry smoke PASSED"
