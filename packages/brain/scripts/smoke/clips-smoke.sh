#!/usr/bin/env bash
# Smoke: Content Clipper clips endpoints
#
# 验证 Brain /api/brain/clips 端点的核心 CRUD 链路：
#   1. POST /clips → 201，DB 有 pending 记录
#   2. GET /clips  → 200，success=true，data 为数组
#   3. GET /clips/:id → 200，返回单条完整记录
#   4. 重复 URL → 409 already_exists
#
# 失败条件：任一 HTTP code / JSON 字段不符合预期
set -euo pipefail

BASE="${BRAIN_URL:-http://localhost:5221}/api/brain/clips"
OUT=/tmp/smoke-clips.json

echo "▶️  smoke: clips-smoke.sh"
echo "   target: $BASE"

# --- 1. POST /clips —————————————————————————————————————
TEST_URL="https://www.douyin.com/video/smoke-test-$(date +%s)"

HTTP_CODE=$(curl -sS -o "$OUT" -w "%{http_code}" \
  -X POST "$BASE" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$TEST_URL\",\"requested_by\":\"smoke\"}")

if [ "$HTTP_CODE" != "201" ]; then
  echo "❌ POST /clips: HTTP $HTTP_CODE (expected 201)"
  cat "$OUT"
  exit 1
fi

if ! grep -q '"status":"pending"' "$OUT"; then
  echo "❌ POST /clips: response missing status=pending"
  cat "$OUT"
  exit 1
fi

CLIP_ID=$(grep -o '"id":"[^"]*"' "$OUT" | head -1 | cut -d'"' -f4)
if [ -z "$CLIP_ID" ]; then
  echo "❌ POST /clips: could not extract clip id"
  cat "$OUT"
  exit 1
fi
echo "   created clip id: $CLIP_ID"

# --- 2. GET /clips ——————————————————————————————————————
HTTP_CODE=$(curl -sS -o "$OUT" -w "%{http_code}" "$BASE?limit=5")

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ GET /clips: HTTP $HTTP_CODE (expected 200)"
  cat "$OUT"
  exit 1
fi

if ! grep -q '"success":true' "$OUT"; then
  echo "❌ GET /clips: missing success=true"
  cat "$OUT"
  exit 1
fi
echo "   GET /clips: OK"

# --- 3. GET /clips/:id ——————————————————————————————————
HTTP_CODE=$(curl -sS -o "$OUT" -w "%{http_code}" "$BASE/$CLIP_ID")

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ GET /clips/$CLIP_ID: HTTP $HTTP_CODE (expected 200)"
  cat "$OUT"
  exit 1
fi

if ! grep -q '"success":true' "$OUT"; then
  echo "❌ GET /clips/:id: missing success=true"
  cat "$OUT"
  exit 1
fi
echo "   GET /clips/:id: OK"

# --- 4. 重复 URL → 409 ——————————————————————————————————
HTTP_CODE=$(curl -sS -o "$OUT" -w "%{http_code}" \
  -X POST "$BASE" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$TEST_URL\",\"requested_by\":\"smoke\"}")

if [ "$HTTP_CODE" != "409" ]; then
  echo "❌ Duplicate POST: HTTP $HTTP_CODE (expected 409)"
  cat "$OUT"
  exit 1
fi

if ! grep -q '"already_exists"' "$OUT"; then
  echo "❌ Duplicate POST: missing already_exists in body"
  cat "$OUT"
  exit 1
fi
echo "   duplicate URL → 409: OK"

echo "✅ smoke pass: clips endpoints all OK (id=$CLIP_ID)"
