---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: Brain SSE 端点 GET /api/brain/harness/stream

**范围**: `packages/brain/src/routes/harness.js` 新增 `GET /stream` SSE 端点（initiative_id 参数校验，2s 轮询 initiative_run_events，30s keepalive `: keepalive`）；`packages/brain/src/events/initiativeRunEvents.js` 提供 writeInitiativeRunEvent helper
**大小**: M
**依赖**: Workstream 1

## ARTIFACT 条目

- [ ] [ARTIFACT] packages/brain/src/routes/harness.js 含 /stream 路由注册（GET 方法）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('/stream'))process.exit(1)"

- [ ] [ARTIFACT] harness.js /stream 路由含 text/event-stream Content-Type 设置
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('text/event-stream'))process.exit(1)"

- [ ] [ARTIFACT] harness.js 使用 initiative_id 查询参数（不用禁用名 taskId/task_id/id/pipeline_id/run_id）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('initiative_id'))process.exit(1);if(c.match(/req\.query\.(taskId|task_id|pipeline_id|tid|run_id)\b/))process.exit(1)"

- [ ] [ARTIFACT] packages/brain/src/events/initiativeRunEvents.js 导出 writeInitiativeRunEvent 函数
  Test: node -e "const m=require('./packages/brain/src/events/initiativeRunEvents.js');if(typeof m.writeInitiativeRunEvent!=='function')process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] GET /stream?initiative_id={id} 推 event: node_update，data 字段值类型正确（node:string, status:string, attempt:number, ts:number）
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; IAID="cccccccc-dddd-eeee-ffff-aa0000000010"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, status, attempt, ts) VALUES ('"'"'$IAID'"'"', '"'"'proposer'"'"', '"'"'running'"'"', 1, extract(epoch from now())::bigint) ON CONFLICT DO NOTHING" 2>/dev/null; SSE=$(curl -s --max-time 6 "localhost:5221/api/brain/harness/stream?initiative_id=$IAID" 2>&1 || true); DATA=$(echo "$SSE" | grep "^data:" | grep -v "keepalive" | head -1 | sed "s/^data: //"); echo "$DATA" | jq -e ".node|type==\"string\"" && echo "$DATA" | jq -e ".status|type==\"string\"" && echo "$DATA" | jq -e ".attempt|type==\"number\"" && echo "$DATA" | jq -e ".ts|type==\"number\"" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] node_update data keys 完整性恰好为 ["attempt","node","status","ts"]，不多不少，无 label
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; IAID="cccccccc-dddd-eeee-ffff-aa0000000011"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, status, attempt, ts) VALUES ('"'"'$IAID'"'"', '"'"'reviewer'"'"', '"'"'running'"'"', 1, extract(epoch from now())::bigint) ON CONFLICT DO NOTHING" 2>/dev/null; SSE=$(curl -s --max-time 6 "localhost:5221/api/brain/harness/stream?initiative_id=$IAID" 2>&1 || true); DATA=$(echo "$SSE" | grep "^data:" | grep -v "keepalive" | head -1 | sed "s/^data: //"); echo "$DATA" | jq -e "keys|sort==[\"attempt\",\"node\",\"status\",\"ts\"]" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 禁用字段 name/timestamp/step/label/event_type 不存在于 node_update data
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; IAID="cccccccc-dddd-eeee-ffff-aa0000000012"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, status, attempt, ts) VALUES ('"'"'$IAID'"'"', '"'"'generator'"'"', '"'"'running'"'"', 2, extract(epoch from now())::bigint) ON CONFLICT DO NOTHING" 2>/dev/null; SSE=$(curl -s --max-time 6 "localhost:5221/api/brain/harness/stream?initiative_id=$IAID" 2>&1 || true); DATA=$(echo "$SSE" | grep "^data:" | grep -v "keepalive" | head -1 | sed "s/^data: //"); echo "$DATA" | jq -e "has(\"name\")|not" && echo "$DATA" | jq -e "has(\"timestamp\")|not" && echo "$DATA" | jq -e "has(\"step\")|not" && echo "$DATA" | jq -e "has(\"label\")|not" && echo "$DATA" | jq -e "has(\"event_type\")|not" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] run_completed event data 含 initiative_run_id/verdict/ts（ts 为 number），不含 status/label 禁用字段
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; IAID="cccccccc-dddd-eeee-ffff-aa0000000013"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, status, attempt, verdict, ts) VALUES ('"'"'$IAID'"'"', '"'"'report'"'"', '"'"'run_completed'"'"', 1, '"'"'PASS'"'"', extract(epoch from now())::bigint) ON CONFLICT DO NOTHING" 2>/dev/null; SSE=$(curl -s --max-time 8 "localhost:5221/api/brain/harness/stream?initiative_id=$IAID" 2>&1 || true); echo "$SSE" | grep -q "event: run_completed" && DONE=$(echo "$SSE" | grep -A1 "event: run_completed" | grep "^data:" | head -1 | sed "s/^data: //"); echo "$DONE" | jq -e ".initiative_run_id|type==\"string\"" && echo "$DONE" | jq -e ".verdict|.==\"PASS\" or .==\"FAIL\" or .==null" && echo "$DONE" | jq -e ".ts|type==\"number\"" && echo "$DONE" | jq -e "has(\"status\")|not" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 缺少 initiative_id → HTTP 400，body 含 error 字段（string），禁用字段 message/msg 不存在
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/dod2_c400.json -w "%{http_code}" "localhost:5221/api/brain/harness/stream"); [ "$CODE" = "400" ] && jq -e ".error|type==\"string\"" /tmp/dod2_c400.json && jq -e "has(\"message\")|not" /tmp/dod2_c400.json && jq -e "has(\"msg\")|not" /tmp/dod2_c400.json && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 未知 initiative_id → HTTP 404，body 含 error 字段（string），禁用字段 message/reason 不存在
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/dod2_c404.json -w "%{http_code}" "localhost:5221/api/brain/harness/stream?initiative_id=00000000-0000-0000-0000-000000000000"); [ "$CODE" = "404" ] && jq -e ".error|type==\"string\"" /tmp/dod2_c404.json && jq -e "has(\"message\")|not" /tmp/dod2_c404.json && jq -e "has(\"reason\")|not" /tmp/dod2_c404.json && echo OK'
  期望: OK
