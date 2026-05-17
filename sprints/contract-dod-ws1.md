---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: Brain SSE 端点

**范围**: `packages/brain/src/routes/harness.js` 新增 `GET /stream` SSE 端点（planner_task_id 参数，从 task_events 读 graph_node_update 行，30s keepalive，task 完成推 done event）
**大小**: M
**依赖**: 无（task_events 表已存在）

## ARTIFACT 条目

- [ ] [ARTIFACT] packages/brain/src/routes/harness.js 含 /stream 路由注册（GET 方法）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('/stream'))process.exit(1)"

- [ ] [ARTIFACT] harness.js /stream 路由含 text/event-stream Content-Type 设置
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('text/event-stream'))process.exit(1)"

- [ ] [ARTIFACT] harness.js 使用 planner_task_id 查询参数（不用 initiative_id/taskId/task_id 等禁用名）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('planner_task_id'))process.exit(1);if(c.match(/req\.query\.(initiative_id|taskId|task_id|pipeline_id|tid)\b/))process.exit(1)"

- [ ] [ARTIFACT] harness.js /stream 路由查询 task_events 表 event_type='graph_node_update'
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('task_events'))process.exit(1);if(!c.includes('graph_node_update'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] 缺少 planner_task_id → HTTP 400，body 含 error 字段（string），禁用字段 message/msg 不存在
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/dod_c400.json -w "%{http_code}" "localhost:5221/api/brain/harness/stream"); [ "$CODE" = "400" ] && jq -e ".error | type == \"string\"" /tmp/dod_c400.json && jq -e "has(\"message\") | not" /tmp/dod_c400.json && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 未知 planner_task_id → HTTP 404，body 含 error 字段（string），禁用字段 message 不存在
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/dod_c404.json -w "%{http_code}" "localhost:5221/api/brain/harness/stream?planner_task_id=00000000-0000-0000-0000-000000000000"); [ "$CODE" = "404" ] && jq -e ".error | type == \"string\"" /tmp/dod_c404.json && jq -e "has(\"message\") | not" /tmp/dod_c404.json && echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /stream?planner_task_id={id} 推 event: node_update，data 字段值类型正确（node:string, label:string, attempt:number, ts:string）
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; TID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type,status,title,payload) VALUES ('"'"'test'"'"','"'"'running'"'"','"'"'dod-sse-test'"'"','"'"'{}'"'"') RETURNING id" | tr -d " \n"); psql "$DB" -c "INSERT INTO task_events (task_id,event_type,payload,created_at) VALUES ('"'"'$TID'"'"','"'"'graph_node_update'"'"','"'"'{"nodeName":"proposer","attemptN":1,"initiativeId":"test"}'"'"'::jsonb,NOW())"; SSE=$(curl -s --max-time 6 "localhost:5221/api/brain/harness/stream?planner_task_id=$TID" 2>&1||true); DATA=$(echo "$SSE"|grep "^data:"|grep -v "keepalive"|head -1|sed "s/^data: //"); echo "$DATA"|jq -e ".node|type==\"string\"" && echo "$DATA"|jq -e ".label|type==\"string\"" && echo "$DATA"|jq -e ".attempt|type==\"number\"" && echo "$DATA"|jq -e ".ts|type==\"string\"" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] node_update data keys 完整性恰好为 ["attempt","label","node","ts"]，不多不少
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; TID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type,status,title,payload) VALUES ('"'"'test'"'"','"'"'running'"'"','"'"'dod-schema-test'"'"','"'"'{}'"'"') RETURNING id" | tr -d " \n"); psql "$DB" -c "INSERT INTO task_events (task_id,event_type,payload,created_at) VALUES ('"'"'$TID'"'"','"'"'graph_node_update'"'"','"'"'{"nodeName":"proposer","attemptN":1,"initiativeId":"test"}'"'"'::jsonb,NOW())"; SSE=$(curl -s --max-time 6 "localhost:5221/api/brain/harness/stream?planner_task_id=$TID" 2>&1||true); DATA=$(echo "$SSE"|grep "^data:"|grep -v "keepalive"|head -1|sed "s/^data: //"); echo "$DATA"|jq -e "keys|sort==[\"attempt\",\"label\",\"node\",\"ts\"]" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 禁用字段 name/nodeName/step/timestamp 不存在于 node_update data
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; TID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type,status,title,payload) VALUES ('"'"'test'"'"','"'"'running'"'"','"'"'dod-forbidden-test'"'"','"'"'{}'"'"') RETURNING id" | tr -d " \n"); psql "$DB" -c "INSERT INTO task_events (task_id,event_type,payload,created_at) VALUES ('"'"'$TID'"'"','"'"'graph_node_update'"'"','"'"'{"nodeName":"proposer","attemptN":1,"initiativeId":"test"}'"'"'::jsonb,NOW())"; SSE=$(curl -s --max-time 6 "localhost:5221/api/brain/harness/stream?planner_task_id=$TID" 2>&1||true); DATA=$(echo "$SSE"|grep "^data:"|grep -v "keepalive"|head -1|sed "s/^data: //"); echo "$DATA"|jq -e "has(\"name\")|not" && echo "$DATA"|jq -e "has(\"nodeName\")|not" && echo "$DATA"|jq -e "has(\"timestamp\")|not" && echo "$DATA"|jq -e "has(\"step\")|not" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] task.status=completed 时 SSE 推 event: done，data 含 status/verdict 字段
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; TID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type,status,title,payload,result) VALUES ('"'"'test'"'"','"'"'completed'"'"','"'"'dod-done-test'"'"','"'"'{}'"'"','"'"'{"verdict":"PASS"}'"'"'::jsonb) RETURNING id" | tr -d " \n"); SSE=$(curl -s --max-time 8 "localhost:5221/api/brain/harness/stream?planner_task_id=$TID" 2>&1||true); echo "$SSE"|grep -q "event: done" && DONE=$(echo "$SSE"|grep -A1 "event: done"|grep "^data:"|head -1|sed "s/^data: //"); echo "$DONE"|jq -e ".status|.==\"completed\" or .==\"failed\"" && echo "$DONE"|jq -e ".verdict|.==\"PASS\" or .==\"FAIL\" or .==null" && echo OK'
  期望: OK
