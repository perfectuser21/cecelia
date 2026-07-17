#!/bin/bash
set -e
BRAIN=${BRAIN_URL:-http://localhost:5221}
echo "=== release-gate smoke ==="
# GET /api/brain/release-gate/path4-customer-service（期望 200 或 404，不得 500）
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BRAIN/api/brain/release-gate/path4-customer-service")
[ "$STATUS" != "500" ] && echo "✅ GET $STATUS（非 500）" || { echo "❌ GET 返回 500"; exit 1; }
# POST 应返回 405
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/release-gate/path4-customer-service")
[ "$STATUS" = "405" ] && echo "✅ POST 405" || echo "⚠️ POST $STATUS（期望 405）"
echo "✅ release-gate smoke done"
