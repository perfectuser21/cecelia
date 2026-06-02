#!/usr/bin/env bash
# B52 smoke — GET /api/brain/harness/runs/:id/progress 端点冒烟
#
# 验证：
#   1. 无效 UUID → 400
#   2. 不存在的 UUID → 404
#   3. 存在的 initiative_run → 200 + 含 pct/phase/initiative_id 字段
#
# 环境：
#   BRAIN_URL  Brain API 地址，默认 http://localhost:5221
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

# 连通性检查
if ! curl -sf "$BRAIN_URL/api/brain/health" >/dev/null 2>&1; then
  echo "[B52 smoke] SKIP — Brain 未启动 ($BRAIN_URL)"
  exit 0
fi

echo "[B52 smoke] 检查 GET /harness/runs/:id/progress 端点..."

# 1. 非 UUID → 400
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BRAIN_URL/api/brain/harness/runs/not-a-uuid/progress")
if [ "$STATUS" != "400" ]; then
  echo "[B52 smoke] FAIL — 非 UUID 期望 400，实际 $STATUS"
  exit 1
fi
echo "[B52 smoke] ✓ 非 UUID → 400"

# 2. 不存在的 UUID → 404
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BRAIN_URL/api/brain/harness/runs/00000000-0000-0000-0000-000000000000/progress")
if [ "$STATUS" != "404" ]; then
  echo "[B52 smoke] FAIL — 不存在 UUID 期望 404，实际 $STATUS"
  exit 1
fi
echo "[B52 smoke] ✓ 不存在 UUID → 404"

# 3. 最近一条 initiative_run（如果存在）→ 200 含必要字段
RECENT_ID=$(curl -s "$BRAIN_URL/api/brain/harness/runs?limit=1" 2>/dev/null | \
  python3 -c "import sys,json; runs=json.load(sys.stdin); print(runs[0]['initiative_id'] if runs else '')" 2>/dev/null || true)

if [ -n "$RECENT_ID" ]; then
  RESP=$(curl -sf "$BRAIN_URL/api/brain/harness/runs/$RECENT_ID/progress" 2>/dev/null || true)
  if [ -z "$RESP" ]; then
    echo "[B52 smoke] FAIL — 有效 initiative_id=$RECENT_ID 但端点无响应"
    exit 1
  fi
  HAS_PCT=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok' if 'pct' in d and 'phase' in d and 'initiative_id' in d else 'missing')" 2>/dev/null || echo "parse_error")
  if [ "$HAS_PCT" != "ok" ]; then
    echo "[B52 smoke] FAIL — 响应缺少必要字段 pct/phase/initiative_id: $RESP"
    exit 1
  fi
  echo "[B52 smoke] ✓ initiative_id=$RECENT_ID → 200 含 pct/phase/initiative_id"
else
  echo "[B52 smoke] SKIP 字段验证 — 无历史 initiative_run"
fi

echo "[B52 smoke] PASS"
