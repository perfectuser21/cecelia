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

- [ ] [ARTIFACT] harness.js 使用 initiative_id 查询参数（不用禁用名 planner_task_id/taskId/task_id/id）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('initiative_id'))process.exit(1);if(c.match(/req\.query\.(planner_task_id|taskId|task_id|pipeline_id|tid)\b/))process.exit(1)"

- [ ] [ARTIFACT] packages/brain/src/events/initiativeRunEvents.js 导出 writeInitiativeRunEvent 函数
  Test: node -e "const m=require('./packages/brain/src/events/initiativeRunEvents.js');if(typeof m.writeInitiativeRunEvent!=='function')process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] GET /stream?initiative_id={id} 推 event: node_update，data 字段值类型正确（node:string, label:string, attempt:number, ts:string）
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; IAID="bbbbbbbb-cccc-dddd-eeee-ff0000000010"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, label, attempt) VALUES ('"'"'$IAID'"'"', '"'"'proposer'"'"', '"'"'Proposer'"'"', 1) ON CONFLICT DO NOTHING" 2>/dev/null; SSE=$(curl -s --max-time 6 "localhost:5221/api/brain/harness/stream?initiative_id=$IAID" 2>&1 || true); DATA=$(echo "$SSE" | grep "^data:" | grep -v "keepalive" | head -1 | sed "s/^data: //"); echo "$DATA" | jq -e ".node|type==\"string\"" && echo "$DATA" | jq -e ".label|type==\"string\"" && echo "$DATA" | jq -e ".attempt|type==\"number\"" && echo "$DATA" | jq -e ".ts|type==\"string\"" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] node_update data keys 完整性恰好为 ["attempt","label","node","ts"]，不多不少
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; IAID="bbbbbbbb-cccc-dddd-eeee-ff0000000011"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, label, attempt) VALUES ('"'"'$IAID'"'"', '"'"'reviewer'"'"', '"'"'Reviewer'"'"', 1) ON CONFLICT DO NOTHING" 2>/dev/null; SSE=$(curl -s --max-time 6 "localhost:5221/api/brain/harness/stream?initiative_id=$IAID" 2>&1 || true); DATA=$(echo "$SSE" | grep "^data:" | grep -v "keepalive" | head -1 | sed "s/^data: //"); echo "$DATA" | jq -e "keys|sort==[\"attempt\",\"label\",\"node\",\"ts\"]" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 禁用字段 name/step/timestamp/nodeName 不存在于 node_update data
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; IAID="bbbbbbbb-cccc-dddd-eeee-ff0000000012"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, label, attempt) VALUES ('"'"'$IAID'"'"', '"'"'generator'"'"', '"'"'Generator'"'"', 2) ON CONFLICT DO NOTHING" 2>/dev/null; SSE=$(curl -s --max-time 6 "localhost:5221/api/brain/harness/stream?initiative_id=$IAID" 2>&1 || true); DATA=$(echo "$SSE" | grep "^data:" | grep -v "keepalive" | head -1 | sed "s/^data: //"); echo "$DATA" | jq -e "has(\"name\")|not" && echo "$DATA" | jq -e "has(\"timestamp\")|not" && echo "$DATA" | jq -e "has(\"step\")|not" && echo "$DATA" | jq -e "has(\"nodeName\")|not" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 缺少 initiative_id → HTTP 400，body 含 error 字段（string），禁用字段 message 不存在
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/dod2_c400.json -w "%{http_code}" "localhost:5221/api/brain/harness/stream"); [ "$CODE" = "400" ] && jq -e ".error|type==\"string\"" /tmp/dod2_c400.json && jq -e "has(\"message\")|not" /tmp/dod2_c400.json && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 未知 initiative_id → HTTP 404，body 含 error 字段（string），禁用字段 message 不存在
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/dod2_c404.json -w "%{http_code}" "localhost:5221/api/brain/harness/stream?initiative_id=00000000-0000-0000-0000-000000000000"); [ "$CODE" = "404" ] && jq -e ".error|type==\"string\"" /tmp/dod2_c404.json && jq -e "has(\"message\")|not" /tmp/dod2_c404.json && echo OK'
  期望: OK

- [ ] [BEHAVIOR] initiative_run_events 有 status=done 行 → SSE 推 event: done，data 含 status/verdict
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; IAID="bbbbbbbb-cccc-dddd-eeee-ff0000000013"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, label, attempt, status, verdict) VALUES ('"'"'$IAID'"'"', '"'"'report'"'"', '"'"'Report'"'"', 1, '"'"'done'"'"', '"'"'PASS'"'"') ON CONFLICT DO NOTHING" 2>/dev/null; SSE=$(curl -s --max-time 8 "localhost:5221/api/brain/harness/stream?initiative_id=$IAID" 2>&1 || true); echo "$SSE" | grep -q "event: done" && DONE=$(echo "$SSE" | grep -A1 "event: done" | grep "^data:" | head -1 | sed "s/^data: //"); echo "$DONE" | jq -e ".status|.==\"completed\" or .==\"failed\"" && echo "$DONE" | jq -e ".verdict|.==\"PASS\" or .==\"FAIL\" or .==null" && echo OK'
  期望: OK
