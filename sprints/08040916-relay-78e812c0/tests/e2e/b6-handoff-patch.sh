#!/bin/bash
# b6-handoff-patch.sh — relay 侧 PATCH tasks result.handoff → 产生 handoff capture_atom（与 saveHandoff 同口径）
# 真 Brain (localhost:5221) + 真 psql，时间窗防历史数据冒充；结束清理本轮数据。
set -euo pipefail
DB="${DB:-cecelia}"
MARK="e2e-78e812c0-b6-$(date +%s)-$$"

curl -sf -m 5 localhost:5221/api/brain/health >/dev/null || { echo "FAIL: Brain 5221 不可达"; exit 1; }

TID=$(psql "$DB" -t -A -c "INSERT INTO tasks (title, task_type, status, payload) VALUES ('${MARK}-handoff', 'dev', 'queued', '{}') RETURNING id" | head -n1)
[ -n "$TID" ] || { echo "FAIL: 任务创建失败"; exit 1; }

cleanup() {
  psql "$DB" -q -c "DELETE FROM captures WHERE content LIKE '%${MARK}%' AND created_at > NOW() - interval '15 minutes'" || true
  psql "$DB" -q -c "DELETE FROM tasks WHERE id = '$TID'::uuid" || true
}
trap cleanup EXIT

curl -sf -X PATCH "localhost:5221/api/brain/tasks/$TID" \
  -H "Content-Type: application/json" \
  -d "{\"result\":{\"handoff\":{\"schema_version\":1,\"task_id\":\"$TID\",\"title\":\"${MARK} handoff\",\"verdict\":\"PASS\",\"done\":[\"${MARK} 完成项\"],\"not_done\":[],\"next_steps\":[\"完成，无下一步\"],\"data_sources\":[],\"decision_refs\":[],\"artifacts\":{\"pr_urls\":[],\"sprint_dir\":null,\"branch\":null,\"docs\":[]},\"created_at\":\"2026-01-01T00:00:00.000Z\"}}}" \
  | jq -e '.success == true' >/dev/null || { echo "FAIL: PATCH result.handoff 未成功"; exit 1; }
sleep 2

HC=$(psql "$DB" -t -A -c "SELECT count(*) FROM capture_atoms WHERE target_type = 'handoff' AND routed_to_table = 'tasks' AND routed_to_id = '$TID'::uuid AND created_at > NOW() - interval '5 minutes'")
[ "$HC" -ge 1 ] || { echo "FAIL: relay PATCH handoff 路径未登记 capture_atom（登记缺口未修）"; exit 1; }

echo "OK b6: handoff atom 登记 task=$TID"
