#!/usr/bin/env bash
# DoD BEHAVIOR 4 — 已 cancelled 的任务再次发起 DELETE → HTTP 409，响应体含 error/details
# （均为 string）（幂等边界，TERMINAL_STATUSES 同时覆盖 completed 与 cancelled）
set -e
DB="${DB:-postgresql://localhost/cecelia}"
TID3=$(psql "$DB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','cancelled','dod-b4-delete-already-cancelled','{}'::jsonb) RETURNING id" | tr -d ' \n')
CODE=$(curl -s -o /tmp/dod_del_409_cancelled.json -w "%{http_code}" -X DELETE "localhost:5221/api/brain/tasks/$TID3")
[ "$CODE" = "409" ]
jq -e '.error | type == "string"' /tmp/dod_del_409_cancelled.json
jq -e '.details | type == "string"' /tmp/dod_del_409_cancelled.json
psql "$DB" -c "DELETE FROM tasks WHERE id='$TID3'" >/dev/null
echo OK
