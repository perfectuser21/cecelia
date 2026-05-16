---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: Brain SSE 端点 — GET /api/brain/initiatives/:id/events

**范围**: 新增 `packages/brain/src/routes/initiative-events-routes.js`（SSE 端点：历史 flush + 实时推送 + 404 处理）；更新 `packages/brain/server.js` 注册路由
**大小**: M（~160 行净增，2 文件）
**依赖**: Workstream 1 完成后（initiative_run_events 表存在）

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/initiative-events-routes.js` 文件存在
  Test: node -e "require('fs').accessSync('packages/brain/src/routes/initiative-events-routes.js')"

- [ ] [ARTIFACT] route 文件设置 `Content-Type: text/event-stream` 响应头
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/initiative-events-routes.js','utf8');if(!c.includes('text/event-stream'))process.exit(1)"

- [ ] [ARTIFACT] route 文件包含 `/:id/events` 路由定义
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/initiative-events-routes.js','utf8');if(!c.includes('/events')&&!c.includes('events'))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 包含 `initiative-events-routes` 导入
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!c.includes('initiative-events-routes'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] SSE data.event 严格等于字面量 "node_update"（PRD response schema 字段值验证）
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"; IID="b0000002-0000-0000-0000-000000000001"; psql "$DB" -c "INSERT INTO initiative_runs (initiative_id, phase) VALUES ('"'"'$IID'"'"'::uuid, '"'"'done'"'"')" 2>/dev/null||true; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, status) VALUES ('"'"'$IID'"'"'::uuid, '"'"'planner'"'"', '"'"'done'"'"')" 2>/dev/null||true; SSE=$(timeout 6 curl -N -s -H "Accept: text/event-stream" "localhost:5221/api/brain/initiatives/$IID/events" 2>/dev/null||true); DATA=$(echo "$SSE"|grep "^data:"|head -1|sed '"'"'s/^data: //'"'"'); echo "$DATA"|jq -e '"'"'.event == "node_update"'"'"'||{echo "FAIL: event != node_update";exit 1;};echo "PASS: event=node_update"'
  期望: PASS: event=node_update

- [ ] [BEHAVIOR] SSE data keys 恰好等于 ["event","node","status","ts"]（schema 完整性）
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"; IID="b0000002-0000-0000-0000-000000000001"; SSE=$(timeout 6 curl -N -s -H "Accept: text/event-stream" "localhost:5221/api/brain/initiatives/$IID/events" 2>/dev/null||true); DATA=$(echo "$SSE"|grep "^data:"|head -1|sed '"'"'s/^data: //'"'"'); echo "$DATA"|jq -e '"'"'keys == ["event","node","status","ts"]'"'"'||{echo "FAIL: keys 不符 PRD schema";exit 1;};echo "PASS: keys 完整"'
  期望: PASS: keys 完整

- [ ] [BEHAVIOR] SSE data 禁用字段 timestamp/time/created_at/t 不存在（禁用 ts 别名反向）
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"; IID="b0000002-0000-0000-0000-000000000001"; SSE=$(timeout 6 curl -N -s -H "Accept: text/event-stream" "localhost:5221/api/brain/initiatives/$IID/events" 2>/dev/null||true); DATA=$(echo "$SSE"|grep "^data:"|head -1|sed '"'"'s/^data: //'"'"'); for f in timestamp time created_at t; do echo "$DATA"|jq -e --arg f "$f" '"'"'has($f)|not'"'"'||{echo "FAIL: 禁用字段 $f 存在";exit 1;};done; echo "PASS: 无禁用 ts 别名"'
  期望: PASS: 无禁用 ts 别名

- [ ] [BEHAVIOR] error path — 未知 initiative_id 返回 HTTP 404 + body 含 error 字段（禁用 message/msg/reason）
  Test: manual:bash -c 'UNKNOWN="99999999-9999-9999-9999-999999999999"; CODE=$(curl -sf -o /tmp/sse_404_ws2.json -w "%{http_code}" "localhost:5221/api/brain/initiatives/$UNKNOWN/events" --max-time 3 2>/dev/null||echo "000"); [ "$CODE" = "404" ]||{echo "FAIL: 期望 404 实际 $CODE";exit 1;}; jq -e '"'"'.error|type=="string"'"'"' /tmp/sse_404_ws2.json||{echo "FAIL: 404 body 缺 error 字段";exit 1;}; for f in message msg reason; do jq -e --arg f "$f" '"'"'has($f)|not'"'"' /tmp/sse_404_ws2.json||{echo "FAIL: 禁用字段 $f 在 404 body";exit 1;};done; echo "PASS: 404 error path 正确"'
  期望: PASS: 404 error path 正确

- [ ] [BEHAVIOR] SSE data.ts 是 number 类型（Unix 毫秒时间戳，不是字符串）
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"; IID="b0000002-0000-0000-0000-000000000001"; SSE=$(timeout 6 curl -N -s -H "Accept: text/event-stream" "localhost:5221/api/brain/initiatives/$IID/events" 2>/dev/null||true); DATA=$(echo "$SSE"|grep "^data:"|head -1|sed '"'"'s/^data: //'"'"'); echo "$DATA"|jq -e '"'"'.ts|type=="number"'"'"'||{echo "FAIL: ts 不是 number";exit 1;}; echo "$DATA"|jq -e '"'"'.ts>1700000000000'"'"'||{echo "FAIL: ts 不是合理 Unix 毫秒";exit 1;}; echo "PASS: ts 是 number"'
  期望: PASS: ts 是 number

- [ ] [BEHAVIOR] SSE data.node 严格属于 PRD 枚举（planner/proposer/reviewer/generator/evaluator/e2e）
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"; IID="b0000002-0000-0000-0000-000000000001"; SSE=$(timeout 6 curl -N -s -H "Accept: text/event-stream" "localhost:5221/api/brain/initiatives/$IID/events" 2>/dev/null||true); DATA=$(echo "$SSE"|grep "^data:"|head -1|sed '"'"'s/^data: //'"'"'); echo "$DATA"|jq -e '"'"'.node|test("^(planner|proposer|reviewer|generator|evaluator|e2e)$")'"'"'||{echo "FAIL: 非法 node 值";exit 1;}; echo "$DATA"|jq -e '"'"'.node|IN("agent","step","phase")|not'"'"'||{echo "FAIL: 禁用 node 别名";exit 1;}; echo "PASS: node 枚举合规"'
  期望: PASS: node 枚举合规
