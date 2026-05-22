#!/bin/bash
# Sprint D — 7张表集成 Smoke Test
set -e
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
TIMEOUT_CONNECT=5
TIMEOUT_MAX=15

echo "=== Sprint D 7-table smoke ==="

# Helper: fetch with timeout and capture response body
fetch_with_timeout() {
  local method=$1
  local url=$2
  local data=$3
  local resp_file="/tmp/smoke_resp_$$.txt"

  if [ -z "$data" ]; then
    HTTP_CODE=$(curl -s --connect-timeout "$TIMEOUT_CONNECT" --max-time "$TIMEOUT_MAX" \
      -o "$resp_file" -w "%{http_code}" "$url")
  else
    HTTP_CODE=$(curl -s --connect-timeout "$TIMEOUT_CONNECT" --max-time "$TIMEOUT_MAX" \
      -X "$method" -H "Content-Type: application/json" \
      -d "$data" -o "$resp_file" -w "%{http_code}" "$url")
  fi

  cat "$resp_file"
  rm -f "$resp_file"
  echo "$HTTP_CODE" >&2
}

# 1. GET /registry 不报 500
echo "[1] GET /registry?type=skill 返回 200..."
RESP=$(fetch_with_timeout GET "$BRAIN_URL/api/brain/registry?type=skill" "" 2>&1)
HTTP_CODE=$(echo "$RESP" | tail -1)
[ "$HTTP_CODE" = "200" ] || {
  echo "FAIL: registry returned $HTTP_CODE"
  echo "Response: $(echo "$RESP" | head -n -1)"
  exit 1
}
echo "  OK: $HTTP_CODE"

# 2. GET /journey_features 路由存在
echo "[2] GET /journey_features 返回 200..."
RESP=$(fetch_with_timeout GET "$BRAIN_URL/api/brain/journey_features" "" 2>&1)
HTTP_CODE=$(echo "$RESP" | tail -1)
[ "$HTTP_CODE" = "200" ] || {
  echo "FAIL: journey_features returned $HTTP_CODE"
  echo "Response: $(echo "$RESP" | head -n -1)"
  exit 1
}
echo "  OK: $HTTP_CODE"

# 3. 创建测试 journey
echo "[3] 创建测试 journey..."
RESP=$(fetch_with_timeout POST "$BRAIN_URL/api/brain/journeys" \
  '{"name":"Smoke Journey D","journey_type":"autonomous","description":"smoke test","e2e_test_path":"none"}' 2>&1)
HTTP_CODE=$(echo "$RESP" | tail -1)
JOURNEY=$(echo "$RESP" | head -n -1)
[ "$HTTP_CODE" = "201" ] || {
  echo "FAIL: journey creation returned $HTTP_CODE"
  echo "Response: $JOURNEY"
  exit 1
}
JOURNEY_ID=$(echo "$JOURNEY" | jq -r '.id // empty')
[ -n "$JOURNEY_ID" ] || {
  echo "FAIL: journey creation returned no id"
  echo "Response: $JOURNEY"
  exit 1
}
echo "  journey_id=$JOURNEY_ID"

# 4. 创建测试 feature
echo "[4] 创建测试 feature..."
RESP=$(fetch_with_timeout POST "$BRAIN_URL/api/brain/journey_features" \
  "{\"name\":\"Smoke Feature D\",\"journey_id\":\"$JOURNEY_ID\",\"thickness\":\"thin\"}" 2>&1)
HTTP_CODE=$(echo "$RESP" | tail -1)
FEATURE=$(echo "$RESP" | head -n -1)
[ "$HTTP_CODE" = "201" ] || {
  echo "FAIL: feature creation returned $HTTP_CODE"
  echo "Response: $FEATURE"
  exit 1
}
FEATURE_ID=$(echo "$FEATURE" | jq -r '.id // empty')
[ -n "$FEATURE_ID" ] || {
  echo "FAIL: feature creation returned no id"
  echo "Response: $FEATURE"
  exit 1
}
echo "  feature_id=$FEATURE_ID"

# 5. GET /journey_features?journey_id 过滤
echo "[5] GET /journey_features?journey_id=$JOURNEY_ID 过滤..."
RESP=$(fetch_with_timeout GET "$BRAIN_URL/api/brain/journey_features?journey_id=$JOURNEY_ID" "" 2>&1)
HTTP_CODE=$(echo "$RESP" | tail -1)
FEATURES=$(echo "$RESP" | head -n -1)
[ "$HTTP_CODE" = "200" ] || {
  echo "FAIL: journey_features query returned $HTTP_CODE"
  echo "Response: $FEATURES"
  exit 1
}
COUNT=$(echo "$FEATURES" | jq 'length // 0')
[ "$COUNT" -ge 1 ] || {
  echo "FAIL: expected >=1 features, got $COUNT"
  echo "Response: $FEATURES"
  exit 1
}
echo "  OK: $COUNT feature(s)"

# 6. PATCH thickness → medium
echo "[6] PATCH thickness → medium..."
RESP=$(fetch_with_timeout PATCH "$BRAIN_URL/api/brain/journey_features/$FEATURE_ID" \
  '{"thickness":"medium"}' 2>&1)
HTTP_CODE=$(echo "$RESP" | tail -1)
PATCHED=$(echo "$RESP" | head -n -1)
[ "$HTTP_CODE" = "200" ] || {
  echo "FAIL: PATCH returned $HTTP_CODE"
  echo "Response: $PATCHED"
  exit 1
}
THICK=$(echo "$PATCHED" | jq -r '.thickness // empty')
[ "$THICK" = "medium" ] || {
  echo "FAIL: thickness=$THICK expected medium"
  echo "Response: $PATCHED"
  exit 1
}
echo "  OK: thickness=$THICK"

echo "✅ Sprint D 7-table smoke 全部通过"
