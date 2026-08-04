#!/bin/bash
# b5-autolearn.sh — harness_initiative failed → auto-learning → capture_atom 溯源落库
# 真 Brain (localhost:5221) + 真 psql，时间窗防历史数据冒充；结束清理本轮数据。
set -euo pipefail
DB="${DB:-cecelia}"
MARK="e2e-78e812c0-b5-$(date +%s)-$$"

curl -sf -m 5 localhost:5221/api/brain/health >/dev/null || { echo "FAIL: Brain 5221 不可达"; exit 1; }

TID=$(psql "$DB" -t -A -c "INSERT INTO tasks (title, task_type, status, payload) VALUES ('${MARK}-autolearn', 'harness_initiative', 'in_progress', '{}') RETURNING id" | head -n1)
[ -n "$TID" ] || { echo "FAIL: 任务创建失败"; exit 1; }

cleanup() {
  psql "$DB" -q -c "DELETE FROM captures WHERE content LIKE '%${MARK}%' AND created_at > NOW() - interval '15 minutes'" || true
  psql "$DB" -q -c "DELETE FROM learnings WHERE task_id = '$TID'::uuid" || true
  psql "$DB" -q -c "DELETE FROM tasks WHERE id = '$TID'::uuid" || true
}
trap cleanup EXIT

curl -sf -X POST localhost:5221/api/brain/execution-callback \
  -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TID\",\"status\":\"failed\",\"exit_code\":1,\"stderr\":\"${MARK} 模拟失败教训 $TID\"}" \
  | jq -e '.success == true' >/dev/null || { echo "FAIL: execution-callback 未成功"; exit 1; }
sleep 2

LID=$(psql "$DB" -t -A -c "SELECT id FROM learnings WHERE task_id = '$TID'::uuid AND created_at > NOW() - interval '5 minutes' LIMIT 1")
[ -n "$LID" ] || { echo "FAIL: harness_initiative failed 未产生 learning（VALUABLE_TASK_TYPES 未纳入）"; exit 1; }

AC=$(psql "$DB" -t -A -c "SELECT count(*) FROM capture_atoms WHERE target_type = 'learning' AND routed_to_table = 'learnings' AND routed_to_id = '$LID'::uuid AND created_at > NOW() - interval '5 minutes'")
[ "$AC" -ge 1 ] || { echo "FAIL: learning atom 的 routed_to_table/routed_to_id 未落库（签名断裂未修）"; exit 1; }

echo "OK b5: learning=$LID atom 溯源落库"
