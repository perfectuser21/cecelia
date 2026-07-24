#!/usr/bin/env bash
# DoD BEHAVIOR 2 — 不存在的任务 id 发起 DELETE → HTTP 404，响应体含 error 字段 (string)
# 且 id 字段回显请求的任务 id，不产生任何 DB 变更
set -e
CODE=$(curl -s -o /tmp/dod_del_404.json -w "%{http_code}" -X DELETE "localhost:5221/api/brain/tasks/00000000-0000-0000-0000-000000000099")
[ "$CODE" = "404" ]
jq -e '.error | type == "string"' /tmp/dod_del_404.json
jq -e '.id == "00000000-0000-0000-0000-000000000099"' /tmp/dod_del_404.json
echo OK
