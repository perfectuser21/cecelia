#!/bin/bash
# Sprint D — 7张表集成 Smoke Test
set -e
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
CT=5    # connect-timeout
MT=15   # max-time

echo "=== Sprint D 7-table smoke ==="

# Helper: curl → (HTTP_CODE, BODY) via temp file（避免 body+code 黏行 bug）
do_curl() {
  local method="$1" url="$2" data="$3"
  local tmp; tmp=$(mktemp)
  if [ -z "$data" ]; then
    HTTP_CODE=$(curl -s --connect-timeout "$CT" --max-time "$MT" \
      -o "$tmp" -w "%{http_code}" "$url")
  else
    HTTP_CODE=$(curl -s --connect-timeout "$CT" --max-time "$MT" \
      -X "$method" -H "Content-Type: application/json" \
      -d "$data" -o "$tmp" -w "%{http_code}" "$url")
  fi
  BODY=$(cat "$tmp"); rm -f "$tmp"
}

# 1. GET /registry 不报 500
echo "[1] GET /registry?type=skill 返回 200..."
do_curl GET "$BRAIN_URL/api/brain/registry?type=skill" ""
[ "$HTTP_CODE" = "200" ] || { echo "FAIL: registry returned $HTTP_CODE — $BODY"; exit 1; }
echo "  OK: $HTTP_CODE"

# 2. GET /journey_features 路由存在
echo "[2] GET /journey_features 返回 200..."
do_curl GET "$BRAIN_URL/api/brain/journey_features" ""
[ "$HTTP_CODE" = "200" ] || { echo "FAIL: journey_features returned $HTTP_CODE — $BODY"; exit 1; }
echo "  OK: $HTTP_CODE"

# 3. 创建测试 journey
echo "[3] 创建测试 journey..."
do_curl POST "$BRAIN_URL/api/brain/journeys" \
  '{"name":"Smoke Journey D","journey_type":"autonomous","description":"smoke test","e2e_test_path":"none"}'
[ "$HTTP_CODE" = "201" ] || { echo "FAIL: journey creation returned $HTTP_CODE — $BODY"; exit 1; }
JOURNEY_ID=$(echo "$BODY" | jq -r '.id // empty')
[ -n "$JOURNEY_ID" ] || { echo "FAIL: journey creation returned no id — $BODY"; exit 1; }
echo "  journey_id=$JOURNEY_ID"

# 4. 创建测试 feature
echo "[4] 创建测试 feature..."
do_curl POST "$BRAIN_URL/api/brain/journey_features" \
  "{\"name\":\"Smoke Feature D\",\"journey_id\":\"$JOURNEY_ID\",\"thickness\":\"thin\"}"
[ "$HTTP_CODE" = "201" ] || { echo "FAIL: feature creation returned $HTTP_CODE — $BODY"; exit 1; }
FEATURE_ID=$(echo "$BODY" | jq -r '.id // empty')
[ -n "$FEATURE_ID" ] || { echo "FAIL: feature creation returned no id — $BODY"; exit 1; }
echo "  feature_id=$FEATURE_ID"

# 5. GET /journey_features?journey_id 过滤
echo "[5] GET /journey_features?journey_id=$JOURNEY_ID 过滤..."
do_curl GET "$BRAIN_URL/api/brain/journey_features?journey_id=$JOURNEY_ID" ""
[ "$HTTP_CODE" = "200" ] || { echo "FAIL: journey_features query returned $HTTP_CODE — $BODY"; exit 1; }
COUNT=$(echo "$BODY" | jq 'length // 0')
[ "$COUNT" -ge 1 ] || { echo "FAIL: expected >=1 features, got $COUNT — $BODY"; exit 1; }
echo "  OK: $COUNT feature(s)"

# 6. PATCH thickness → medium
echo "[6] PATCH thickness → medium..."
do_curl PATCH "$BRAIN_URL/api/brain/journey_features/$FEATURE_ID" '{"thickness":"medium"}'
[ "$HTTP_CODE" = "200" ] || { echo "FAIL: PATCH returned $HTTP_CODE — $BODY"; exit 1; }
THICK=$(echo "$BODY" | jq -r '.thickness // empty')
[ "$THICK" = "medium" ] || { echo "FAIL: thickness=$THICK expected medium — $BODY"; exit 1; }
echo "  OK: thickness=$THICK"

echo "✅ Sprint D 7-table smoke 全部通过"
