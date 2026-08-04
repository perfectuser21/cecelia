#!/bin/bash
# b8-nonvaluable-skip.sh — 边界：非 VALUABLE_TASK_TYPES 任务（code_review）failed → 不产 learning（高频低价值过滤不回退）
set -euo pipefail
DB="${DB:-cecelia}"
MARK="e2e-78e812c0-b8-$(date +%s)-$$"

curl -sf -m 5 localhost:5221/api/brain/health >/dev/null || { echo "FAIL: Brain 5221 不可达"; exit 1; }

TID=$(psql "$DB" -t -A -c "INSERT INTO tasks (title, task_type, status, payload) VALUES ('${MARK}-nonvaluable', 'code_review', 'in_progress', '{}') RETURNING id" | head -n1)
[ -n "$TID" ] || { echo "FAIL: 任务创建失败"; exit 1; }

cleanup() {
  psql "$DB" -q -c "DELETE FROM learnings WHERE task_id = '$TID'::uuid" || true
  psql "$DB" -q -c "DELETE FROM tasks WHERE id = '$TID'::uuid" || true
}
trap cleanup EXIT

curl -sf -X POST localhost:5221/api/brain/execution-callback \
  -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TID\",\"status\":\"failed\",\"exit_code\":1,\"stderr\":\"${MARK} 非 valuable 类型失败\"}" \
  | jq -e '.success == true' >/dev/null || { echo "FAIL: execution-callback 未成功"; exit 1; }
sleep 2

LC=$(psql "$DB" -t -A -c "SELECT count(*) FROM learnings WHERE task_id = '$TID'::uuid AND created_at > NOW() - interval '5 minutes'")
[ "$LC" -eq 0 ] || { echo "FAIL: code_review 不在 VALUABLE_TASK_TYPES，不应产 learning，实际 $LC 条"; exit 1; }

echo "OK b8: 非 valuable 类型不产 learning"
