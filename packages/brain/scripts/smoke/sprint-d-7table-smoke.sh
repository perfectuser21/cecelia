#!/bin/bash
# Sprint D — 7张表集成 Smoke Test
set -e
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
echo "=== Sprint D 7-table smoke ==="

# 1. GET /registry 不报 500
echo "[1] GET /registry?type=skill 返回 200..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BRAIN_URL/api/brain/registry?type=skill")
[ "$HTTP_CODE" = "200" ] || { echo "FAIL: registry returned $HTTP_CODE"; exit 1; }
echo "  OK: $HTTP_CODE"

# 2. GET /journey_features 路由存在
echo "[2] GET /journey_features 返回 200..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BRAIN_URL/api/brain/journey_features")
[ "$HTTP_CODE" = "200" ] || { echo "FAIL: journey_features returned $HTTP_CODE"; exit 1; }
echo "  OK: $HTTP_CODE"

# 3. 创建测试 journey
echo "[3] 创建测试 journey..."
JOURNEY=$(curl -sf -X POST "$BRAIN_URL/api/brain/journeys" \
  -H "Content-Type: application/json" \
  -d '{"name":"Smoke Journey D","journey_type":"autonomous","description":"smoke test","e2e_test_path":"none"}')
JOURNEY_ID=$(echo "$JOURNEY" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).id))")
echo "  journey_id=$JOURNEY_ID"

# 4. 创建测试 feature
echo "[4] 创建测试 feature..."
FEATURE=$(curl -sf -X POST "$BRAIN_URL/api/brain/journey_features" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Smoke Feature D\",\"journey_id\":\"$JOURNEY_ID\",\"thickness\":\"thin\"}")
FEATURE_ID=$(echo "$FEATURE" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).id))")
echo "  feature_id=$FEATURE_ID"

# 5. GET /journey_features?journey_id 过滤
echo "[5] GET /journey_features?journey_id=$JOURNEY_ID 过滤..."
FEATURES=$(curl -sf "$BRAIN_URL/api/brain/journey_features?journey_id=$JOURNEY_ID")
COUNT=$(echo "$FEATURES" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).length))")
[ "$COUNT" -ge 1 ] || { echo "FAIL: expected >=1 features, got $COUNT"; exit 1; }
echo "  OK: $COUNT feature(s)"

# 6. PATCH thickness → medium
echo "[6] PATCH thickness → medium..."
PATCHED=$(curl -sf -X PATCH "$BRAIN_URL/api/brain/journey_features/$FEATURE_ID" \
  -H "Content-Type: application/json" \
  -d '{"thickness":"medium"}')
THICK=$(echo "$PATCHED" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).thickness))")
[ "$THICK" = "medium" ] || { echo "FAIL: thickness=$THICK expected medium"; exit 1; }
echo "  OK: thickness=$THICK"

echo "✅ Sprint D 7-table smoke 全部通过"
