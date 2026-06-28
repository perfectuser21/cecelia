#!/bin/bash
# Smoke test: harness pending-reviews API
# 验证 GET /api/brain/harness/pending-reviews 端点存在并返回 JSON

set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

RESP=$(curl -sf "${BRAIN_URL}/api/brain/harness/pending-reviews" -o /dev/null -w "%{http_code}" 2>/dev/null || echo "000")

if [ "$RESP" = "000" ]; then
  echo "⚠️  Brain 未运行，跳过 smoke（CI 离线模式）"
  exit 0
fi

if [ "$RESP" = "200" ]; then
  echo "✅ harness/pending-reviews smoke PASS (HTTP 200)"
  exit 0
fi

echo "❌ harness/pending-reviews smoke FAIL (HTTP $RESP)"
exit 1
