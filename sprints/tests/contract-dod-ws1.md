---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: Brain SSE 端点

**范围**: `packages/brain/src/routes/harness.js` 新增 `GET /stream` SSE 端点，从 `task_events` 表按 `graph_node_update` 事件实时推送，字段严格符合 PRD schema（`node`/`label`/`attempt`/`ts`）；task 完成后发 `event: done`；keepalive 每 30s；缺参数 400，未知 ID 404
**大小**: M (100-130 行)
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] harness.js 含 `GET /stream` 路由声明
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes(\"router.get('/stream'\")&&!c.includes(\"router.get(\\\"/stream\\\"\"))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] harness.js 含节点中文标签 MAP（proposer/generator/reviewer/evaluator 至少 4 个映射）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');const cnt=['Proposer','提案者','Generator','生成器','Reviewer','审查者','Evaluator','评估者'].filter(k=>c.includes(k)).length;if(cnt<4){console.error('FAIL: label MAP 不足，含',cnt,'个');process.exit(1)};console.log('OK: label MAP >=4')"

- [ ] [ARTIFACT] harness.js 含 keepalive comment（`: keepalive`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes(': keepalive'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] harness.js SSE data 构造含 PRD 4 个合规字段名（node/label/attempt/ts），不含禁用字段名（nodeName/timestamp/name 作为输出 key）
  Test: manual:bash -c 'SRC=$(cat packages/brain/src/routes/harness.js); for FIELD in "node:" "label:" "attempt:" "ts:"; do echo "$SRC" | grep -q "$FIELD" || { echo "FAIL: 缺 $FIELD in SSE data 构造"; exit 1; }; done; echo "$SRC" | grep -qE "nodeName\s*:" && { echo "FAIL: 禁用字段 nodeName 作为输出 key"; exit 1; }; echo "$SRC" | grep -qE "'\"'timestamp'\"'\s*:" && { echo "FAIL: 禁用字段 timestamp 作为输出 key"; exit 1; }; echo "OK: PRD 4 字段均在，无禁用字段名"'
  期望: exit 0

- [ ] [BEHAVIOR] GET /stream?planner_task_id={id} 返回 `text/event-stream`，并推送含 4 字段 node_update data，keys 精确等于 `["attempt","label","node","ts"]`
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"; TASK_ID=$(psql "$DB" -t -c "INSERT INTO tasks(task_type,status,payload) VALUES('"'"'harness_dod_ws1_b2'"'"','"'"'in_progress'"'"','"'"'{}'"'"'::jsonb) RETURNING id" | tr -d " \n"); psql "$DB" -c "INSERT INTO task_events(task_id,event_type,payload,created_at) VALUES('"'"'$TASK_ID'"'"','"'"'graph_node_update'"'"','"'"'{"nodeName":"proposer","attemptN":1,"payloadSummary":{}}'"'"'::jsonb,NOW()-interval '"'"'2 seconds'"'"')" >/dev/null; DATA=$(curl -N -s --max-time 7 "localhost:5221/api/brain/harness/stream?planner_task_id=$TASK_ID" | grep "^data:" | grep -v "event: done" | head -1 | sed "s/^data: //"); psql "$DB" -c "DELETE FROM task_events WHERE task_id='"'"'$TASK_ID'"'"'; DELETE FROM tasks WHERE id='"'"'$TASK_ID'"'"'" >/dev/null 2>&1 || true; [ -n "$DATA" ] || { echo "FAIL: 未收到 data 行"; exit 1; }; echo "$DATA" | jq -e "keys == [\"attempt\",\"label\",\"node\",\"ts\"]" || { echo "FAIL: keys 不精确，实际:$(echo $DATA|jq keys)"; exit 1; }; echo "OK: node_update keys 精确符合 PRD"'
  期望: exit 0

- [ ] [BEHAVIOR] 禁用字段 nodeName/name/timestamp/type 反向不出现在 node_update event data JSON 中
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"; TASK_ID=$(psql "$DB" -t -c "INSERT INTO tasks(task_type,status,payload) VALUES('"'"'harness_dod_ws1_b3'"'"','"'"'in_progress'"'"','"'"'{}'"'"'::jsonb) RETURNING id" | tr -d " \n"); psql "$DB" -c "INSERT INTO task_events(task_id,event_type,payload,created_at) VALUES('"'"'$TASK_ID'"'"','"'"'graph_node_update'"'"','"'"'{"nodeName":"generator","attemptN":2,"payloadSummary":{}}'"'"'::jsonb,NOW()-interval '"'"'2 seconds'"'"')" >/dev/null; DATA=$(curl -N -s --max-time 7 "localhost:5221/api/brain/harness/stream?planner_task_id=$TASK_ID" | grep "^data:" | grep -v "event: done" | head -1 | sed "s/^data: //"); psql "$DB" -c "DELETE FROM task_events WHERE task_id='"'"'$TASK_ID'"'"'; DELETE FROM tasks WHERE id='"'"'$TASK_ID'"'"'" >/dev/null 2>&1 || true; [ -n "$DATA" ] || { echo "FAIL: 无 data"; exit 1; }; for BANNED in nodeName name timestamp time step phase stage type payload result event_type; do echo "$DATA" | jq -e "has(\"$BANNED\") | not" || { echo "FAIL: 禁用字段 $BANNED 出现"; exit 1; }; done; echo "OK: 禁用字段均未出现"'
  期望: exit 0

- [ ] [BEHAVIOR] 缺 planner_task_id 返 HTTP 400 + error 字段（非 message/msg）；未知 UUID 返 HTTP 404
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/stream"); [ "$CODE" = "400" ] || { echo "FAIL: 缺参数应 400，实返 $CODE"; exit 1; }; ERR=$(curl -s "localhost:5221/api/brain/harness/stream"); echo "$ERR" | jq -e ".error | type == \"string\"" || { echo "FAIL: 400 响应缺 error 字段"; exit 1; }; echo "$ERR" | jq -e "has(\"message\") | not" || { echo "FAIL: 禁用字段 message 出现"; exit 1; }; CODE404=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/stream?planner_task_id=00000000-0000-0000-0000-000000000000"); [ "$CODE404" = "404" ] || { echo "FAIL: 未知 ID 应 404，实返 $CODE404"; exit 1; }; echo "OK: error path 验证通过"'
  期望: exit 0

- [ ] [BEHAVIOR] pipeline 完成时 SSE 推 `event: done`，data 含 status（completed/failed）和 verdict，不含禁用字段 result
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"; TASK_ID=$(psql "$DB" -t -c "INSERT INTO tasks(task_type,status,payload,result) VALUES('"'"'harness_dod_ws1_b5'"'"','"'"'completed'"'"','"'"'{}'"'"'::jsonb,'"'"'{"verdict":"PASS"}'"'"'::jsonb) RETURNING id" | tr -d " \n"); STREAM=$(curl -N -s --max-time 8 "localhost:5221/api/brain/harness/stream?planner_task_id=$TASK_ID"); psql "$DB" -c "DELETE FROM tasks WHERE id='"'"'$TASK_ID'"'"'" >/dev/null 2>&1 || true; echo "$STREAM" | grep -q "event: done" || { echo "FAIL: 未发 event: done"; exit 1; }; DONE=$(echo "$STREAM" | grep -A1 "event: done" | grep "^data:" | head -1 | sed "s/^data: //"); echo "$DONE" | jq -e ".status == \"completed\" or .status == \"failed\"" || { echo "FAIL: done.status 不合规"; exit 1; }; echo "$DONE" | jq -e "has(\"result\") | not" || { echo "FAIL: 禁用字段 result 出现在 done data"; exit 1; }; echo "OK: event: done 验证通过"'
  期望: exit 0
