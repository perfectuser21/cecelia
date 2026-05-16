---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: Brain SSE + REST 端点

**范围**: 在 `packages/brain/src/routes/harness.js` 新增 `/pipeline/:initiative_id/stream`（SSE）和 `/pipeline/:initiative_id/events`（REST）
**大小**: M（150-180 行净增，1 文件）
**依赖**: Workstream 1 完成后（需要 initiative_run_events 表存在）

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/harness.js` 包含 `/pipeline/:initiative_id/stream` 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('/pipeline/:initiative_id/stream') && !c.includes(\"pipeline/:initiative_id/stream\"))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/routes/harness.js` 包含 `/pipeline/:initiative_id/events` 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('/pipeline/:initiative_id/events') && !c.includes(\"pipeline/:initiative_id/events\"))process.exit(1)"

- [ ] [ARTIFACT] SSE 路由设置 `text/event-stream` Content-Type
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('text/event-stream'))process.exit(1)"

- [ ] [ARTIFACT] 代码包含 30s keepalive comment 实现（`: keepalive`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('keepalive'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] GET /api/brain/harness/pipeline/:id/events 返回 `{"events":[...]}` 顶层 keys 恰好 == ["events"]
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"; TEST_ID="00000000-0000-0000-0000-000000000001"; psql "$DB" -c "INSERT INTO initiative_run_events (event_id,initiative_id,node,status,payload) VALUES ('"'"'11111111-0000-0000-0000-000000000001'"'"','"'"'${TEST_ID}'"'"','"'"'planner'"'"','"'"'completed'"'"','"'"'{}'"'"') ON CONFLICT (event_id) DO NOTHING" 2>/dev/null || true; RESP=$(curl -sf "localhost:5221/api/brain/harness/pipeline/${TEST_ID}/events"); echo "$RESP" | jq -e '"'"'keys == ["events"]'"'"' || { echo "FAIL: 顶层 keys 不合规"; exit 1; }; echo "PASS: 顶层 schema 正确"'
  期望: PASS: 顶层 schema 正确

- [ ] [BEHAVIOR] GET /events 返回的 event 对象包含全部必填字段（event_id/initiative_id/node/status/payload/ts）
  Test: manual:bash -c 'TEST_ID="00000000-0000-0000-0000-000000000001"; RESP=$(curl -sf "localhost:5221/api/brain/harness/pipeline/${TEST_ID}/events"); echo "$RESP" | jq -e '"'"'.events[0] | has("event_id") and has("initiative_id") and has("node") and has("status") and has("payload") and has("ts")'"'"' || { echo "FAIL: 事件字段不完整"; exit 1; }; echo "PASS: 事件字段完整"'
  期望: PASS: 事件字段完整

- [ ] [BEHAVIOR] GET /events 禁用顶层字段（data/result/items/records/rows）不存在
  Test: manual:bash -c 'TEST_ID="00000000-0000-0000-0000-000000000001"; RESP=$(curl -sf "localhost:5221/api/brain/harness/pipeline/${TEST_ID}/events"); echo "$RESP" | jq -e '"'"'has("data") | not'"'"' || { echo "FAIL: 禁用字段 data"; exit 1; }; echo "$RESP" | jq -e '"'"'has("result") | not'"'"' || { echo "FAIL: 禁用字段 result"; exit 1; }; echo "$RESP" | jq -e '"'"'has("items") | not'"'"' || { echo "FAIL: 禁用字段 items"; exit 1; }; echo "PASS: 无禁用顶层字段"'
  期望: PASS: 无禁用顶层字段

- [ ] [BEHAVIOR] GET /events event 对象禁用字段（type/data/body/event_type/timestamp）不存在
  Test: manual:bash -c 'TEST_ID="00000000-0000-0000-0000-000000000001"; RESP=$(curl -sf "localhost:5221/api/brain/harness/pipeline/${TEST_ID}/events"); echo "$RESP" | jq -e '"'"'.events[0] | has("type") | not'"'"' || { echo "FAIL: 禁用字段 type 存在（应用 node/status）"; exit 1; }; echo "$RESP" | jq -e '"'"'.events[0] | has("timestamp") | not'"'"' || { echo "FAIL: 禁用字段 timestamp 存在（应用 ts）"; exit 1; }; echo "PASS: 无禁用事件字段"'
  期望: PASS: 无禁用事件字段

- [ ] [BEHAVIOR] GET /events 未知 initiative_id 返回 HTTP 404 + body 含 error 字段（禁用 message）
  Test: manual:bash -c 'UNKNOWN="99999999-9999-9999-9999-999999999999"; CODE=$(curl -sf -o /tmp/err404.json -w "%{http_code}" "localhost:5221/api/brain/harness/pipeline/${UNKNOWN}/events" 2>/dev/null || echo "404"); [ "$CODE" = "404" ] || { echo "FAIL: 期望 404 实际 $CODE"; exit 1; }; cat /tmp/err404.json | jq -e '"'"'has("error")'"'"' || { echo "FAIL: 404 body 缺 error 字段"; exit 1; }; cat /tmp/err404.json | jq -e '"'"'has("message") | not'"'"' || { echo "FAIL: 禁用字段 message 出现"; exit 1; }; echo "PASS: 404 路径正确"'
  期望: PASS: 404 路径正确

- [ ] [BEHAVIOR] GET /stream SSE 端点推送 event: node_update 且 data 字段完整
  Test: manual:bash -c 'TEST_ID="00000000-0000-0000-0000-000000000001"; SSE=$(timeout 6 curl -N -sf -H "Accept: text/event-stream" "localhost:5221/api/brain/harness/pipeline/${TEST_ID}/stream" 2>&1 || true); echo "$SSE" | grep -q "event: node_update" || { echo "FAIL: SSE 未推 node_update"; exit 1; }; DATA=$(echo "$SSE" | grep "^data:" | head -1 | sed '"'"'s/^data: //'"'"'); echo "$DATA" | jq -e '"'"'has("event_id") and has("initiative_id") and has("node") and has("status") and has("payload") and has("ts")'"'"' || { echo "FAIL: SSE node_update data 字段不完整"; exit 1; }; echo "PASS: SSE node_update schema 正确"'
  期望: PASS: SSE node_update schema 正确

- [ ] [BEHAVIOR] GET /stream SSE done 事件含 status 和 verdict（禁用 result/outcome/state/message）
  Test: manual:bash -c 'TEST_ID="00000000-0000-0000-0000-000000000001"; SSE=$(timeout 8 curl -N -sf -H "Accept: text/event-stream" "localhost:5221/api/brain/harness/pipeline/${TEST_ID}/stream" 2>&1 || true); echo "$SSE" | grep -q "event: done" || { echo "FAIL: 未收到 done 事件"; exit 1; }; DONE=$(echo "$SSE" | grep -A1 "event: done" | grep "^data:" | head -1 | sed '"'"'s/^data: //'"'"'); echo "$DONE" | jq -e '"'"'has("status") and has("verdict")'"'"' || { echo "FAIL: done data 缺 status/verdict"; exit 1; }; echo "$DONE" | jq -e '"'"'has("result") | not'"'"' || { echo "FAIL: 禁用字段 result 在 done data"; exit 1; }; echo "PASS: done 事件 schema 正确"'
  期望: PASS: done 事件 schema 正确

- [ ] [BEHAVIOR] GET /stream 支持 after_event_id 断线重连参数（不返回 400）
  Test: manual:bash -c 'TEST_ID="00000000-0000-0000-0000-000000000001"; LAST=$(curl -sf "localhost:5221/api/brain/harness/pipeline/${TEST_ID}/events" | jq -r '"'"'.events[-1].event_id // empty'"'"'); [ -n "$LAST" ] || { echo "SKIP: 无历史事件"; exit 0; }; CODE=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 3 -H "Accept: text/event-stream" "localhost:5221/api/brain/harness/pipeline/${TEST_ID}/stream?after_event_id=${LAST}" 2>/dev/null || echo "200"); [ "$CODE" != "400" ] || { echo "FAIL: after_event_id 参数被拒绝 400"; exit 1; }; echo "PASS: after_event_id 参数有效"'
  期望: PASS: after_event_id 参数有效
