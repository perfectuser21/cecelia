#!/usr/bin/env bash
# conversations-smoke.sh
# Task 264b8c8d — PR1 对话会话基础层 冒烟测试
# 前提：Brain 已启动于 localhost:5221

set -e
BRAIN="http://localhost:5221"

# ── 1. POST 缺 journey_id → 400 ───────────────────────────
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/conversations" \
  -H "Content-Type: application/json" \
  -d '{}')
if [ "$CODE" != "400" ]; then
  echo "[FAIL] 缺 journey_id 预期 400，得到 $CODE"
  exit 1
fi
echo "[PASS] POST 缺 journey_id → 400"

# ── 2. POST 非法 journey_id → 400 ────────────────────────
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/conversations" \
  -H "Content-Type: application/json" \
  -d '{"journey_id":"not-a-uuid"}')
if [ "$CODE" != "400" ]; then
  echo "[FAIL] 非法 journey_id 预期 400，得到 $CODE"
  exit 1
fi
echo "[PASS] POST 非法 journey_id → 400"

# ── 3. GET 不传 journey_id → 400 ─────────────────────────
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BRAIN/api/brain/conversations")
if [ "$CODE" != "400" ]; then
  echo "[FAIL] GET 不传 journey_id 预期 400，得到 $CODE"
  exit 1
fi
echo "[PASS] GET 不传 journey_id → 400"

# ── 4. PATCH 无效 status → 400 ───────────────────────────
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BRAIN/api/brain/conversations/00000000-0000-4000-a000-000000000001" \
  -H "Content-Type: application/json" \
  -d '{"status":"invalid_status"}')
if [ "$CODE" != "400" ]; then
  echo "[FAIL] PATCH 无效 status 预期 400，得到 $CODE"
  exit 1
fi
echo "[PASS] PATCH 无效 status → 400"

echo "[OK] conversations-smoke 全部通过（4/4 纯参数校验，无需真实 DB）"
