#!/bin/bash
# replay-incident.sh — 事故形态重放（task 94ee0ec4 / 事故任务 b35bfa0c）
# 形态：status=queued、payload.headed_manual=true、无进程、无 /tmp/cecelia-<id>.log、零留痕。
# 断言：跨两次真实 tick（双确认探测窗口）后不被判 never_started 假杀、不被无头派发。
# 真目标：本机真实 Brain（localhost:5221）+ 真实 cecelia 库。零 mock。
set -euo pipefail

DB="${DB_URL:-postgresql://localhost/cecelia}"
BRAIN="${BRAIN_URL:-http://localhost:5221}"

# 0. 前置守卫 —— Brain 不可达 = 环境未就绪 = FAIL（禁止兜底放行）
curl -sf -m 10 "$BRAIN/api/brain/health" >/dev/null || { echo "FAIL: Brain 不可达"; exit 1; }

# 1. 插入事故同形态任务（marker 唯一化；spec 声明为重放 fixture）
MARKER="e2e-replay-94ee0ec4-$(date +%s)"
TID=$(psql "$DB" -t -A -c "INSERT INTO tasks (title, task_type, status, priority, payload)
  VALUES ('${MARKER}', 'dev', 'queued', 'P0',
          '{\"headed_manual\": true, \"e2e_replay\": true, \"spec\": \"E2E replay fixture - do not execute\"}'::jsonb)
  RETURNING id")
[ -n "$TID" ] || { echo "FAIL: 插入重放任务失败"; exit 1; }

cleanup() {
  psql "$DB" -c "DELETE FROM learnings WHERE task_id = '$TID'" >/dev/null 2>&1 || true
  psql "$DB" -c "DELETE FROM task_events WHERE task_id = '$TID'" >/dev/null 2>&1 || true
  psql "$DB" -c "DELETE FROM tasks WHERE id = '$TID'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# 2. 跨 >=2 个 liveness 探测周期：触发两次真实 tick（既有生产端点，非 mock）
curl -sf -m 300 -X POST "$BRAIN/api/brain/tick" >/dev/null || { echo "FAIL: tick 1 触发失败"; exit 1; }
sleep 15
curl -sf -m 300 -X POST "$BRAIN/api/brain/tick" >/dev/null || { echo "FAIL: tick 2 触发失败"; exit 1; }
sleep 15

# 3. 断言：不被假杀（status 非 failed、无 watchdog_kill payload、error_message 未被写）
ROW=$(psql "$DB" -t -A -c "SELECT status || '|' || COALESCE(payload->'watchdog_kill'->>'reason','none') || '|' || COALESCE(error_message,'null') FROM tasks WHERE id = '$TID'")
[ -n "$ROW" ] || { echo "FAIL: 重放任务行消失"; exit 1; }
STATUS="${ROW%%|*}"
REST="${ROW#*|}"
KILL_REASON="${REST%%|*}"
ERRMSG="${REST#*|}"

[ "$STATUS" != "failed" ] || { echo "FAIL: 重放任务被置 failed - $ROW"; exit 1; }
[ "$KILL_REASON" = "none" ] || { echo "FAIL: 重放任务被打 watchdog_kill reason=$KILL_REASON - $ROW"; exit 1; }
[ "$ERRMSG" = "null" ] || { echo "FAIL: error_message 被写入 - $ROW"; exit 1; }

# 4. 断言：headed_manual 消费语义 —— 未被无头派发（不被翻 in_progress/dispatched）
case "$STATUS" in
  in_progress|dispatched)
    echo "FAIL: headed_manual 任务被无头派发 status=$STATUS"; exit 1 ;;
esac

echo "REPLAY-PASS: status=$STATUS kill=none error_message=null"
