#!/bin/bash
# BEHAVIOR 3: headless/缺省路径零回归（不走 headed 分支）
set -e

DB="${DB:-postgresql://localhost/cecelia}"

RESP=$(curl -sf -X POST http://localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","title":"headless-regression","payload":{"orchestrator":"skill-relay","executor":"codex"}}')

TASK_ID=$(echo "$RESP" | jq -r ".id")
[ -n "$TASK_ID" ] || { echo "FAIL: headless 任务创建失败"; exit 1; }
echo "TASK_ID=$TASK_ID"

for i in $(seq 1 30); do
  ROW=$(psql "$DB" -t -c \
    "SELECT orchestrator_host FROM initiative_runs WHERE initiative_id='${TASK_ID}' AND orchestrator_version='v2' AND created_at > NOW() - interval '5 minutes'" \
    | tr -d ' ')
  [ -n "$ROW" ] && break
  [ "$i" = "30" ] && break
  sleep 1
done

[ "$ROW" = "skill-relay-codex-headed" ] && { echo "FAIL: 缺省路径误走 headed 分支"; exit 1; }
echo "headless 零回归 OK orchestrator_host=${ROW:-<未落行或非headed>}"
