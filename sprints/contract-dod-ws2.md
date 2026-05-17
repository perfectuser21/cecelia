---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: Brain SSE 端点

**范围**: `packages/brain/src/routes/harness.js` GET /stream + `packages/brain/src/events/initiativeRunEvents.js` 事件写入 helper
**大小**: M
**依赖**: Workstream 1

## ARTIFACT 条目

- [ ] [ARTIFACT] packages/brain/src/routes/harness.js 存在且含 /stream 路由注册
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('/stream'))process.exit(1)"

- [ ] [ARTIFACT] packages/brain/src/events/initiativeRunEvents.js 存在且导出 writeInitiativeRunEvent 函数
  Test: node -e "try{const m=require('./packages/brain/src/events/initiativeRunEvents.js');if(typeof m.writeInitiativeRunEvent!=='function')process.exit(1)}catch(e){process.exit(1)}"

- [ ] [ARTIFACT] harness.js 含 text/event-stream Content-Type 设置
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('text/event-stream'))process.exit(1)"

- [ ] [ARTIFACT] harness.js 含 initiative_id 参数校验（非 id/taskId/task_id 等禁用参数名）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('initiative_id'))process.exit(1);if(c.includes('req.query.taskId')||c.includes('req.query.task_id')||c.includes('req.query.id'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] GET /api/brain/harness/stream?initiative_id={id} 推 event: node_update，data 含 node/label/attempt/ts 字段（类型正确）
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; IAID="bbbbbbbb-cccc-dddd-eeee-ff0000000001"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, label, attempt) VALUES ('"'"'$IAID'"'"', '"'"'proposer'"'"', '"'"'Proposer'"'"', 1) ON CONFLICT DO NOTHING" 2>/dev/null; SSE=$(curl -s --max-time 6 "localhost:5221/api/brain/harness/stream?initiative_id=$IAID" 2>&1 || true); DATA=$(echo "$SSE" | grep "^data:" | grep -v "keepalive" | head -1 | sed "s/^data: //"); echo "$DATA" | jq -e ".node | type == \"string\"" && echo "$DATA" | jq -e ".label | type == \"string\"" && echo "$DATA" | jq -e ".attempt | type == \"number\"" && echo "$DATA" | jq -e ".ts | type == \"string\"" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] node_update data keys 完整性恰好等于 [attempt, label, node, ts]，不多不少
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; IAID="bbbbbbbb-cccc-dddd-eeee-ff0000000002"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, label, attempt) VALUES ('"'"'$IAID'"'"', '"'"'proposer'"'"', '"'"'Proposer'"'"', 1) ON CONFLICT DO NOTHING" 2>/dev/null; SSE=$(curl -s --max-time 6 "localhost:5221/api/brain/harness/stream?initiative_id=$IAID" 2>&1 || true); DATA=$(echo "$SSE" | grep "^data:" | grep -v "keepalive" | head -1 | sed "s/^data: //"); echo "$DATA" | jq -e "keys | sort == [\"attempt\",\"label\",\"node\",\"ts\"]" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 禁用字段 name/step/timestamp 不存在于 node_update data
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; IAID="bbbbbbbb-cccc-dddd-eeee-ff0000000003"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, label, attempt) VALUES ('"'"'$IAID'"'"', '"'"'proposer'"'"', '"'"'Proposer'"'"', 1) ON CONFLICT DO NOTHING" 2>/dev/null; SSE=$(curl -s --max-time 6 "localhost:5221/api/brain/harness/stream?initiative_id=$IAID" 2>&1 || true); DATA=$(echo "$SSE" | grep "^data:" | grep -v "keepalive" | head -1 | sed "s/^data: //"); echo "$DATA" | jq -e "has(\"name\") | not" && echo "$DATA" | jq -e "has(\"step\") | not" && echo "$DATA" | jq -e "has(\"timestamp\") | not" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] initiative_id 不存在时返 HTTP 404，body 含 error 字段（string），禁用字段 message/msg 不存在
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/err404_ws2.json -w "%{http_code}" "localhost:5221/api/brain/harness/stream?initiative_id=00000000-0000-0000-0000-000000000000"); [ "$CODE" = "404" ] && jq -e ".error | type == \"string\"" /tmp/err404_ws2.json && jq -e "has(\"message\") | not" /tmp/err404_ws2.json && jq -e "has(\"msg\") | not" /tmp/err404_ws2.json && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 缺少 initiative_id query 参数时返 HTTP 400，body 含 error 字段
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/err400_ws2.json -w "%{http_code}" "localhost:5221/api/brain/harness/stream"); [ "$CODE" = "400" ] && jq -e ".error | type == \"string\"" /tmp/err400_ws2.json && echo OK'
  期望: OK

- [ ] [BEHAVIOR] status=done 行存在时 SSE 推 event: done，data 含 status/verdict 字段
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; IAID="bbbbbbbb-cccc-dddd-eeee-ff0000000004"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, label, attempt, status, verdict) VALUES ('"'"'$IAID'"'"', '"'"'report'"'"', '"'"'Report'"'"', 1, '"'"'done'"'"', '"'"'PASS'"'"') ON CONFLICT DO NOTHING" 2>/dev/null; SSE=$(curl -s --max-time 8 "localhost:5221/api/brain/harness/stream?initiative_id=$IAID" 2>&1 || true); DONE_DATA=$(echo "$SSE" | grep -A1 "event: done" | grep "^data:" | head -1 | sed "s/^data: //"); echo "$DONE_DATA" | jq -e ".status | . == \"completed\" or . == \"failed\"" && echo "$DONE_DATA" | jq -e ".verdict | . == \"PASS\" or . == \"FAIL\" or . == null" && echo OK'
  期望: OK
