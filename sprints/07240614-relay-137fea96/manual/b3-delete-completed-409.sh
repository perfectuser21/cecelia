#!/usr/bin/env bash
# DoD BEHAVIOR 3 — 已 completed 的任务发起 DELETE → HTTP 409，响应体含 error/details（均为 string），
# DB 行 status 保持 completed（未被误改，防误删历史记录）
set -e
DB="${DB:-postgresql://localhost/cecelia}"
TID2=$(psql "$DB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','completed','dod-b3-delete-terminal','{}'::jsonb) RETURNING id" | tr -d ' \n')
CODE=$(curl -s -o /tmp/dod_del_409_completed.json -w "%{http_code}" -X DELETE "localhost:5221/api/brain/tasks/$TID2")
[ "$CODE" = "409" ]
jq -e '.error | type == "string"' /tmp/dod_del_409_completed.json
jq -e '.details | type == "string"' /tmp/dod_del_409_completed.json
DBSTATUS2=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$TID2'" | tr -d ' \n')
[ "$DBSTATUS2" = "completed" ]
psql "$DB" -c "DELETE FROM tasks WHERE id='$TID2'" >/dev/null
echo OK
