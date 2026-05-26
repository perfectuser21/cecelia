#!/bin/bash
# notion-brain-first-smoke.sh — Brain-first journeys/issues 写入验证
# 环境变量：DATABASE_URL（默认 postgresql://cecelia@localhost:5432/cecelia）
set -e

DB="${DATABASE_URL:-postgresql://cecelia@localhost:5432/cecelia}"
BRAIN="${BRAIN_URL:-http://localhost:5221}"

if ! psql "$DB" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "[smoke] SKIP — 无 DB 连接"
  exit 0
fi

echo "[smoke] 测试 POST /api/brain/journeys..."
RESP=$(curl -sf -X POST "$BRAIN/api/brain/journeys" \
  -H "Content-Type: application/json" \
  -d '{"name":"_smoke_journey_test_","journey_type":"dev_pipeline","description":"smoke test"}' 2>&1 || echo "CURL_FAIL")

if echo "$RESP" | grep -q "CURL_FAIL\|html\|<!"; then
  echo "FAIL: POST /api/brain/journeys 端点不存在（端点未实现）"
  exit 1
fi

JOURNEY_ID=$(echo "$RESP" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(d.id||'')" 2>/dev/null || true)
[ -n "$JOURNEY_ID" ] || { echo "FAIL: 响应无 id 字段"; exit 1; }

DB_COUNT=$(psql "$DB" -tAc "SELECT COUNT(*) FROM journeys WHERE id='$JOURNEY_ID' AND notion_synced_at IS NULL")
[ "$DB_COUNT" = "1" ] || { echo "FAIL: journeys 行不存在或 notion_synced_at 不为 NULL"; exit 1; }

# 清理
psql "$DB" -tAc "DELETE FROM journeys WHERE id='$JOURNEY_ID'" >/dev/null

echo "[smoke] 测试 POST /api/brain/issues..."
IRESP=$(curl -sf -X POST "$BRAIN/api/brain/issues" \
  -H "Content-Type: application/json" \
  -d '{"title":"_smoke_issue_test_","priority":"P2"}' 2>&1 || echo "CURL_FAIL")

if echo "$IRESP" | grep -q "CURL_FAIL"; then
  echo "FAIL: POST /api/brain/issues 端点不存在"
  exit 1
fi

ISSUE_ID=$(echo "$IRESP" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(d.id||'')" 2>/dev/null || true)
[ -n "$ISSUE_ID" ] || { echo "FAIL: issues 响应无 id 字段"; exit 1; }

IDB_COUNT=$(psql "$DB" -tAc "SELECT COUNT(*) FROM issues WHERE id='$ISSUE_ID' AND notion_synced_at IS NULL")
[ "$IDB_COUNT" = "1" ] || { echo "FAIL: issues 行不存在或 notion_synced_at 不为 NULL"; exit 1; }

psql "$DB" -tAc "DELETE FROM issues WHERE id='$ISSUE_ID'" >/dev/null

echo "✅ notion-brain-first smoke 全部通过"
