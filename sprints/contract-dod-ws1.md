---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: Backend SSE stream 端点

**范围**: `packages/brain/src/routes/harness.js` 新增 `GET /stream` 端点；query 参数 `planner_task_id`（UUID）；每 2s 轮询 `task_events` 表推送 `event: node_update`；pipeline 完成/失败时推 `event: done` 关闭连接；每 30s 发 `: keepalive` comment
**大小**: M（100-150 行净增，1 文件）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/harness.js` 含 `router.get('/stream'` 路由
  Test: node -e "const c=require('fs').readFileSync('/workspace/packages/brain/src/routes/harness.js','utf8');if(!c.includes(\"router.get('/stream'\")&&!c.includes('router.get(\"/stream\"'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `GET /stream` 路由使用 query 参数名 `planner_task_id`（不含禁用名 id/taskId/task_id/pipeline_id/tid）
  Test: node -e "const c=require('fs').readFileSync('/workspace/packages/brain/src/routes/harness.js','utf8');const s=c.slice(c.indexOf('/stream'));if(!s.includes('planner_task_id'))process.exit(1);if(/[?&](id|taskId|task_id|pipeline_id|tid)[^_]/.test(s))process.exit(2);console.log('OK')"

- [ ] [ARTIFACT] SSE 响应头正确设置（Content-Type: text/event-stream，Cache-Control: no-cache，Connection: keep-alive）
  Test: node -e "const c=require('fs').readFileSync('/workspace/packages/brain/src/routes/harness.js','utf8');if(!c.includes('text/event-stream'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] GET /stream?planner_task_id=<valid> 返回 HTTP 200 Content-Type: text/event-stream
  Test: manual:bash -c 'TEST_ID=$(PGUSER=cecelia PGHOST=localhost psql -d cecelia -t -c "INSERT INTO tasks (task_type,status,payload,title,created_at) VALUES ('"'"'test_sse_b1'"'"','"'"'in_progress'"'"','"'"'{}'"'"','"'"'B1 Conn Test'"'"',NOW()) RETURNING id" | tr -d " \n"); CT=$(curl -sI --max-time 3 "localhost:5221/api/brain/harness/stream?planner_task_id=$TEST_ID" | grep -i "content-type" | tr -d "\r"); echo "$CT" | grep -q "text/event-stream" && echo OK || { echo "FAIL: $CT"; exit 1; }'
  期望: OK (exit 0)

- [ ] [BEHAVIOR] node_update event — `node` 字段值等于 task_events.payload.nodeName（"proposer"），`attempt` 等于 attemptN（1）
  Test: manual:bash -c 'DB=cecelia; TEST_ID=$(PGUSER=cecelia PGHOST=localhost psql -d $DB -t -c "INSERT INTO tasks (task_type,status,payload,title,created_at) VALUES ('"'"'test_sse_b2'"'"','"'"'completed'"'"','"'"'{}'"'"','"'"'B2 NodeVal'"'"',NOW()) RETURNING id" | tr -d " \n"); PGUSER=cecelia PGHOST=localhost psql -d $DB -c "INSERT INTO task_events (task_id,event_type,payload,created_at) VALUES ('"'"'$TEST_ID'"'"','"'"'graph_node_update'"'"','"'"'{"initiativeId":"t","threadId":"t","nodeName":"proposer","attemptN":1,"payloadSummary":{}}'"'"'::jsonb, NOW()-interval '"'"'1 second'"'"')"; timeout 8 curl -sN -H "Accept: text/event-stream" "localhost:5221/api/brain/harness/stream?planner_task_id=$TEST_ID" > /tmp/b2.txt 2>&1 || true; D=$(grep "^data:" /tmp/b2.txt | grep -v '"status"' | head -1 | sed "s/^data: //"); [ -n "$D" ] || { echo "FAIL: no node_update"; cat /tmp/b2.txt; exit 1; }; echo "$D" | jq -e '"'"'.node == "proposer"'"'"' && echo "$D" | jq -e '"'"'.attempt == 1'"'"' && echo OK || exit 1'
  期望: OK (exit 0)

- [ ] [BEHAVIOR] node_update event — `label` 类型 string，`ts` 类型 string（ISO 8601），keys 恰好 ["attempt","label","node","ts"]
  Test: manual:bash -c 'D=$(grep "^data:" /tmp/b2.txt | grep -v '"'"'"status"'"'"' | head -1 | sed "s/^data: //"); [ -n "$D" ] || { echo "FAIL: 无 SSE 数据（先跑 B2）"; exit 1; }; echo "$D" | jq -e '"'"'.label | type == "string"'"'"' && echo "$D" | jq -e '"'"'.ts | type == "string"'"'"' && echo "$D" | jq -e '"'"'keys == ["attempt","label","node","ts"]'"'"' && echo OK || exit 1'
  期望: OK (exit 0)

- [ ] [BEHAVIOR] node_update event — 禁用字段 `name`/`nodeName`/`timestamp`/`type` 均不存在于 data JSON
  Test: manual:bash -c 'D=$(grep "^data:" /tmp/b2.txt | grep -v '"'"'"status"'"'"' | head -1 | sed "s/^data: //"); [ -n "$D" ] || { echo "FAIL: 无 SSE 数据"; exit 1; }; echo "$D" | jq -e '"'"'has("name") | not'"'"' && echo "$D" | jq -e '"'"'has("nodeName") | not'"'"' && echo "$D" | jq -e '"'"'has("timestamp") | not'"'"' && echo "$D" | jq -e '"'"'has("type") | not'"'"' && echo OK || { echo "FAIL: 禁用字段漏网"; exit 1; }'
  期望: OK (exit 0)

- [ ] [BEHAVIOR] error path — GET /stream（缺少 planner_task_id）返回 HTTP 400，body 含 `error` 字段（string），无 `message`/`msg` 禁用字段
  Test: manual:bash -c 'CODE=$(curl -sf -o /tmp/b5_err.json -w "%{http_code}" "localhost:5221/api/brain/harness/stream"); [ "$CODE" = "400" ] || { echo "FAIL: expected 400 got $CODE"; exit 1; }; jq -e '"'"'has("error") and (.error | type == "string")'"'"' /tmp/b5_err.json && jq -e '"'"'has("message") | not'"'"' /tmp/b5_err.json && jq -e '"'"'has("msg") | not'"'"' /tmp/b5_err.json && echo OK || exit 1'
  期望: OK (exit 0)

- [ ] [BEHAVIOR] error path — GET /stream?planner_task_id=00000000-0000-0000-0000-000000000000（不存在 UUID）返回 HTTP 404，body `.error == "pipeline not found"`
  Test: manual:bash -c 'FAKE=00000000-0000-0000-0000-000000000000; CODE=$(curl -sf -o /tmp/b6_nf.json -w "%{http_code}" "localhost:5221/api/brain/harness/stream?planner_task_id=$FAKE"); [ "$CODE" = "404" ] || { echo "FAIL: expected 404 got $CODE"; exit 1; }; jq -e '"'"'.error == "pipeline not found"'"'"' /tmp/b6_nf.json && echo OK || exit 1'
  期望: OK (exit 0)
