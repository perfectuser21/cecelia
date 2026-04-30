#!/usr/bin/env bash
# all-features-smoke.sh
# 从 Brain API 动态拉取所有 feature 的 smoke_cmd，逐个执行，写回结果。
# exit 1 if any feature fails.
set -uo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "=== all-features-smoke ==="
echo "Brain: $BRAIN_URL"
echo "Time:  $NOW"
echo ""

# 拉取所有 feature（limit=500 保证一次全取）
FEATURES_JSON=$(curl -sf "$BRAIN_URL/api/brain/features?limit=500")
TOTAL=$(echo "$FEATURES_JSON" | jq '.features | length')
echo "Features: $TOTAL"
echo ""

# 解析 feature 列表，提前检查 jq 错误
FEATURES_ARRAY=$(echo "$FEATURES_JSON" | jq -c '.features[]') || {
  echo "❌ Failed to parse features JSON from Brain API"
  exit 1
}

PASSED=0
FAILED=0
FAILED_IDS=()

while IFS= read -r row; do
  ID=$(echo "$row" | jq -r '.id')
  CMD=$(echo "$row" | jq -r '.smoke_cmd')

  # smoke_cmd 为空则跳过
  if [ -z "$CMD" ] || [ "$CMD" = "null" ]; then
    echo "⏭️  $ID — no smoke_cmd, skip"
    continue
  fi

  # 执行 smoke_cmd，捕获退出码
  if bash -c "$CMD" > /dev/null 2>&1; then
    STATUS="passing"
    PASSED=$((PASSED + 1))
    echo "✅ $ID"
  else
    STATUS="failing"
    FAILED=$((FAILED + 1))
    FAILED_IDS=("${FAILED_IDS[@]}" "$ID")
    echo "❌ $ID"
  fi

  # 写回 smoke_status（PATCH 失败只警告，不中止）
  if ! curl -sf -X PATCH "$BRAIN_URL/api/brain/features/$ID" \
    -H "Content-Type: application/json" \
    -d "{\"smoke_status\":\"$STATUS\",\"smoke_last_run\":\"$NOW\"}" \
    > /dev/null 2>&1; then
    echo "⚠️  Failed to write back smoke_status for $ID" >&2
  fi

done <<< "$FEATURES_ARRAY"

echo ""
echo "=== 结果 ==="
echo "✅ passed: $PASSED"
echo "❌ failed: $FAILED"

if [ "${#FAILED_IDS[@]:-0}" -gt 0 ]; then
  echo ""
  echo "失败列表:"
  for id in "${FAILED_IDS[@]}"; do
    echo "  - $id"
  done
fi

echo ""
if [ "$FAILED" -gt 0 ]; then
  echo "❌ all-features-smoke FAILED ($FAILED failures)"
  exit 1
fi

echo "✅ all-features-smoke PASSED"
