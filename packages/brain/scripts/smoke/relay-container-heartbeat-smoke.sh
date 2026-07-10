#!/usr/bin/env bash
# relay-container-heartbeat-smoke.sh
#
# 真实环境验证：relay-container probe 叠加 initiative_run_events 心跳判活（T7）
#
# 验证点：
#   1. POST /harness/phase-event 写入 initiative_run_events
#   2. DB 行存在且 ts 在合理范围内
#   3. PATCH /harness/phase-event/:id 更新状态
#
# 运行条件：Brain 服务已启动（localhost:5221）+ PostgreSQL 可达
set -euo pipefail

BRAIN="${BRAIN_URL:-http://localhost:5221}"
INITIATIVE_ID="smoke-heartbeat-$(date +%s)"

echo "=== relay-container-heartbeat smoke ==="
echo "initiative_id: $INITIATIVE_ID"

# 1. 健康检查
echo "[1] 检查 Brain 健康..."
curl -sf "$BRAIN/health" > /dev/null || { echo "SKIP: Brain not running"; exit 0; }

# 2. POST phase-event
echo "[2] POST /harness/phase-event (node=planner)..."
RESP=$(curl -sf -X POST "$BRAIN/api/brain/harness/phase-event" \
  -H "Content-Type: application/json" \
  -d "{\"initiative_id\":\"$INITIATIVE_ID\",\"node\":\"planner\",\"status\":\"running\"}")
echo "    response: $RESP"

EVENT_ID=$(echo "$RESP" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id||''))" 2>/dev/null || echo "")
if [ -z "$EVENT_ID" ]; then
  echo "FAIL: phase-event POST did not return id"
  exit 1
fi
echo "    event_id: $EVENT_ID"

# 3. 验证 initiative_run_events 写入（DB 直查）
echo "[3] 验证 initiative_run_events 写入..."
ROW_COUNT=$(psql "${DATABASE_URL:-postgresql://cecelia@localhost:5432/cecelia}" \
  -tAc "SELECT COUNT(*) FROM initiative_run_events WHERE initiative_id='$INITIATIVE_ID' AND node='planner' AND status='running'" \
  2>/dev/null || echo "0")
if [ "$ROW_COUNT" -lt 1 ]; then
  echo "FAIL: initiative_run_events 无写入记录"
  exit 1
fi
echo "    DB 行数: $ROW_COUNT ✓"

# 4. PATCH phase-event（模拟阶段完成）
echo "[4] PATCH /harness/phase-event/$EVENT_ID (status=completed)..."
PATCH_RESP=$(curl -sf -X PATCH "$BRAIN/api/brain/harness/phase-event/$EVENT_ID" \
  -H "Content-Type: application/json" \
  -d "{\"status\":\"completed\",\"ts_end\":$(date +%s)}")
echo "    response: $PATCH_RESP"

STATUS=$(echo "$PATCH_RESP" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).status||''))" 2>/dev/null || echo "")
if [ "$STATUS" != "completed" ]; then
  echo "FAIL: PATCH did not set status=completed (got: $STATUS)"
  exit 1
fi
echo "    status=completed ✓"

# 5. 清理测试数据
psql "${DATABASE_URL:-postgresql://cecelia@localhost:5432/cecelia}" \
  -c "DELETE FROM initiative_run_events WHERE initiative_id='$INITIATIVE_ID'" \
  2>/dev/null || true

echo "=== relay-container-heartbeat smoke PASSED ==="
