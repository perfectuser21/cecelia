#!/bin/bash
# BEHAVIOR 2: headed spawn 后 initiative_runs 落行 orchestrator_host='skill-relay-codex-headed'
set -e

DB="${DB:-postgresql://localhost/cecelia}"

RESP=$(curl -sf -X POST http://localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","title":"dod-runs-check","payload":{"orchestrator":"skill-relay","executor":"codex","mode":"headed"}}')

TASK_ID=$(echo "$RESP" | jq -r ".id")
[ -n "$TASK_ID" ] || { echo "FAIL: 任务创建失败"; exit 1; }
echo "TASK_ID=$TASK_ID"

for i in $(seq 1 30); do
  ROW=$(psql "$DB" -t -c \
    "SELECT orchestrator_host FROM initiative_runs WHERE initiative_id='${TASK_ID}' AND orchestrator_version='v2' AND created_at > NOW() - interval '5 minutes'" \
    | tr -d ' ')
  [ -n "$ROW" ] && break
  sleep 1
done

[ "$ROW" = "skill-relay-codex-headed" ] || { echo "FAIL: orchestrator_host=${ROW:-<未落行>}，期望 skill-relay-codex-headed"; exit 1; }
echo OK
