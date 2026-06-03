#!/usr/bin/env bash
# harness-echo-smoke.sh
# Smoke test: GET /api/brain/harness/echo 端点存在且返回正确 schema
# exit 1 if any check fails
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "=== harness-echo smoke ==="
echo "Brain: $BRAIN_URL"

# 健康检查
curl -sf "$BRAIN_URL/api/brain/health" > /dev/null || {
  echo "❌ Brain 未运行在 $BRAIN_URL"
  exit 1
}

# Happy path
RESP=$(curl -sf "$BRAIN_URL/api/brain/harness/echo?msg=smoke") || {
  echo "❌ GET /api/brain/harness/echo?msg=smoke 返回非 200"
  exit 1
}

echo "$RESP" | jq -e '.ok == true' > /dev/null || { echo "❌ ok 不为 true"; exit 1; }
echo "$RESP" | jq -e '.echo == "smoke"' > /dev/null || { echo "❌ echo 不等于 smoke"; exit 1; }
echo "$RESP" | jq -e 'keys == ["echo","ok"]' > /dev/null || { echo "❌ keys 不合规"; exit 1; }

# 空 msg 边界
RESP2=$(curl -sf "$BRAIN_URL/api/brain/harness/echo") || { echo "❌ 空 msg 返回非 200"; exit 1; }
echo "$RESP2" | jq -e '.ok == true' > /dev/null || { echo "❌ 空 msg ok 不为 true"; exit 1; }

echo "✅ harness-echo smoke 通过"
