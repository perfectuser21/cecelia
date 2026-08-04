#!/bin/bash
# b7-handoff-empty.sh — 边界：result.handoff 为空对象 → PATCH 主流程不受阻断（200）且不产 atom
set -euo pipefail
DB="${DB:-cecelia}"
MARK="e2e-78e812c0-b7-$(date +%s)-$$"

curl -sf -m 5 localhost:5221/api/brain/health >/dev/null || { echo "FAIL: Brain 5221 不可达"; exit 1; }

TID=$(psql "$DB" -t -A -c "INSERT INTO tasks (title, task_type, status, payload) VALUES ('${MARK}-empty-handoff', 'dev', 'queued', '{}') RETURNING id" | head -n1)
[ -n "$TID" ] || { echo "FAIL: 任务创建失败"; exit 1; }

cleanup() {
  psql "$DB" -q -c "DELETE FROM capture_atoms WHERE routed_to_id = '$TID'::uuid" || true
  psql "$DB" -q -c "DELETE FROM tasks WHERE id = '$TID'::uuid" || true
}
trap cleanup EXIT

curl -sf -X PATCH "localhost:5221/api/brain/tasks/$TID" \
  -H "Content-Type: application/json" \
  -d '{"result":{"handoff":{}}}' \
  | jq -e '.success == true' >/dev/null || { echo "FAIL: 空 handoff 阻断了 PATCH 主流程"; exit 1; }
sleep 2

EC=$(psql "$DB" -t -A -c "SELECT count(*) FROM capture_atoms WHERE routed_to_id = '$TID'::uuid AND created_at > NOW() - interval '5 minutes'")
[ "$EC" -eq 0 ] || { echo "FAIL: 空 handoff 不应产 atom，实际 $EC 条"; exit 1; }

echo "OK b7: 空 handoff 不产 atom 且 PATCH 200"
