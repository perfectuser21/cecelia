#!/bin/bash
# inbox-p1-smoke.sh — Inbox P1 冒烟测试
# task_id: 07b2fd3b-724b-4da3-bdf3-827821b66ba5
set -e

# 真 Brain 写入必须显式授权，并核对本机测试容器。
if ! node "$(dirname "${BASH_SOURCE[0]}")/../lib/smoke-production-guard.mjs" "${BRAIN_URL:-http://localhost:5221}"; then
  exit 0
fi

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DEDUPE_KEY="smoke-inbox-$(date +%s)"

echo "[smoke] 测试 POST /api/brain/captures..."
RESULT=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BRAIN_URL}/api/brain/captures" \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"smoke test\",\"source\":\"harness\",\"dedupe_key\":\"${DEDUPE_KEY}\"}")
[ "$RESULT" = "201" ] && echo "[smoke] PASS: POST 201" || { echo "[smoke] FAIL: POST ${RESULT}"; exit 1; }

echo "[smoke] 测试 GET /api/brain/captures..."
RESULT=$(curl -s -o /dev/null -w "%{http_code}" "${BRAIN_URL}/api/brain/captures?limit=1")
[ "$RESULT" = "200" ] && echo "[smoke] PASS: GET 200" || { echo "[smoke] FAIL: GET ${RESULT}"; exit 1; }

echo "[smoke] Inbox P1 smoke PASS"
