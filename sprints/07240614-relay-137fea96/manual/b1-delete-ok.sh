#!/usr/bin/env bash
# DoD BEHAVIOR 1 — 存在的非终态任务发起 DELETE → HTTP 200，响应体 status=cancelled，
# 且 DB 行 status 真实变为 cancelled（不信任响应体自证，双重校验）
set -e
DB="${DB:-postgresql://localhost/cecelia}"
TID=$(psql "$DB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','pending_postdeploy','dod-b1-delete-ok','{}'::jsonb) RETURNING id" | tr -d ' \n')
RESP=$(curl -sf -X DELETE "localhost:5221/api/brain/tasks/$TID")
echo "$RESP" | jq -e '.status == "cancelled"'
echo "$RESP" | jq -e 'has("id") and has("status")'
DBSTATUS=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$TID'" | tr -d ' \n')
[ "$DBSTATUS" = "cancelled" ]
echo OK
