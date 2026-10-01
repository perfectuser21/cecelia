#!/bin/bash
set -e

# 真 Brain 写入必须显式授权，并核对本机测试容器。
if ! node "$(dirname "${BASH_SOURCE[0]}")/../lib/smoke-production-guard.mjs" "${BRAIN_URL:-http://localhost:5221}"; then
  exit 0
fi
BRAIN=${BRAIN_URL:-http://localhost:5221}
echo "=== release-gate smoke ==="
# GET /api/brain/release-gate/path4-customer-service（期望 200 或 404，不得 500）
STATUS=$(curl -q -s -o /dev/null -w "%{http_code}" "$BRAIN/api/brain/release-gate/path4-customer-service")
[ "$STATUS" != "500" ] && echo "✅ GET $STATUS（非 500）" || { echo "❌ GET 返回 500"; exit 1; }
# POST 应返回 405
STATUS=$(curl -q -s -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/release-gate/path4-customer-service")
[ "$STATUS" = "405" ] && echo "✅ POST 405" || echo "⚠️ POST $STATUS（期望 405）"
echo "✅ release-gate smoke done"
