---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: Brain SSE + REST 端点

**范围**: 在 `packages/brain/src/routes/harness.js` 新增 `/pipeline/:initiative_id/stream`（SSE）和 `/pipeline/:initiative_id/events`（REST）
**大小**: M（150-180 行净增，1 文件）
**依赖**: Workstream 1 完成后（需要 initiative_run_events 表存在）

## ARTIFACT 条目

- [x] [ARTIFACT] `packages/brain/src/routes/harness.js` 包含 `/pipeline/:initiative_id/stream` 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('/pipeline/:initiative_id/stream') && !c.includes(\"pipeline/:initiative_id/stream\"))process.exit(1)"

- [x] [ARTIFACT] `packages/brain/src/routes/harness.js` 包含 `/pipeline/:initiative_id/events` 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('/pipeline/:initiative_id/events') && !c.includes(\"pipeline/:initiative_id/events\"))process.exit(1)"

- [x] [ARTIFACT] SSE 路由设置 `text/event-stream` Content-Type
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('text/event-stream'))process.exit(1)"

- [x] [ARTIFACT] 代码包含 30s keepalive comment 实现（`: keepalive`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('keepalive'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [x] [BEHAVIOR] GET /api/brain/harness/pipeline/:id/events 返回 `{"events":[...]}` 顶层 keys 恰好 == ["events"]
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"; TEST_ID="00000000-0000-0000-0000-000000000001"; psql "$DB" -c "INSERT INTO initiative_run_events (event_id,initiative_id,node,status,payload) VALUES ('"'"'11111111-0000-0000-0000-000000000001'"'"','"'"'${TEST_ID}'"'"','"'"'planner'"'"','"'"'completed'"'"','"'"'{}'"'"') ON CONFLICT (event_id) DO NOTHING" 2>/dev/null || true; RESP=$(curl -sf "localhost:5221/api/brain/harness/pipeline/${TEST_ID}/events"); printf "%s" "$RESP" | jq -e '"'"'keys == ["events"]'"'"' || { printf "FAIL: 顶层 keys 不合规\n"; exit 1; }; printf "PASS: 顶层 schema 正确\n"'
  期望: PASS: 顶层 schema 正确

- [x] [BEHAVIOR] GET /events 返回的 event 对象包含全部必填字段（event_id/initiative_id/node/status/payload/ts）
  Test: manual:bash -c 'TEST_ID="00000000-0000-0000-0000-000000000001"; RESP=$(curl -sf "localhost:5221/api/brain/harness/pipeline/${TEST_ID}/events"); printf "%s" "$RESP" | jq -e '"'"'.events[0] | has("event_id") and has("initiative_id") and has("node") and has("status") and has("payload") and has("ts")'"'"' || { printf "FAIL: 事件字段不完整\n"; exit 1; }; printf "PASS: 事件字段完整\n"'
  期望: PASS: 事件字段完整

- [x] [BEHAVIOR] GET /events 禁用顶层字段（data/result/items/records/rows）不存在
  Test: manual:bash -c 'TEST_ID="00000000-0000-0000-0000-000000000001"; RESP=$(curl -sf "localhost:5221/api/brain/harness/pipeline/${TEST_ID}/events"); printf "%s" "$RESP" | jq -e '"'"'has("data") | not'"'"' || { printf "FAIL: 禁用字段 data\n"; exit 1; }; printf "%s" "$RESP" | jq -e '"'"'has("result") | not'"'"' || { printf "FAIL: 禁用字段 result\n"; exit 1; }; printf "%s" "$RESP" | jq -e '"'"'has("items") | not'"'"' || { printf "FAIL: 禁用字段 items\n"; exit 1; }; printf "PASS: 无禁用顶层字段\n"'
  期望: PASS: 无禁用顶层字段

- [x] [BEHAVIOR] GET /events event 对象禁用字段（type/data/body/event_type/timestamp）不存在
  Test: manual:bash -c 'TEST_ID="00000000-0000-0000-0000-000000000001"; RESP=$(curl -sf "localhost:5221/api/brain/harness/pipeline/${TEST_ID}/events"); printf "%s" "$RESP" | jq -e '"'"'.events[0] | has("type") | not'"'"' || { printf "FAIL: 禁用字段 type 存在（应用 node/status）\n"; exit 1; }; printf "%s" "$RESP" | jq -e '"'"'.events[0] | has("timestamp") | not'"'"' || { printf "FAIL: 禁用字段 timestamp 存在（应用 ts）\n"; exit 1; }; printf "PASS: 无禁用事件字段\n"'
  期望: PASS: 无禁用事件字段

- [x] [BEHAVIOR] GET /events 未知 initiative_id 返回 HTTP 404 + body 含 error 字段（禁用 message）
  Test: manual:bash -c 'UNKNOWN="99999999-9999-9999-9999-999999999999"; CODE=$(curl -sf -o /tmp/err404.json -w "%{http_code}" "localhost:5221/api/brain/harness/pipeline/${UNKNOWN}/events" 2>/dev/null || printf "404"); [ "$CODE" = "404" ] || { printf "FAIL: 期望 404 实际 %s\n" "$CODE"; exit 1; }; node -e "const d=JSON.parse(require(\"fs\").readFileSync(\"/tmp/err404.json\",\"utf8\"));if(!d.error||typeof d.error!==\"string\"){process.stderr.write(\"FAIL: 404 body 缺 error string\\n\");process.exit(1);}if(\"message\" in d){process.stderr.write(\"FAIL: 禁用字段 message 出现\\n\");process.exit(2);}process.stdout.write(\"PASS: 404 路径正确\\n\")"'
  期望: PASS: 404 路径正确

- [x] [BEHAVIOR] GET /stream SSE 端点推送 event: node_update 且 data 字段完整
  Test: manual:bash -c 'TEST_ID="00000000-0000-0000-0000-000000000001"; timeout 6 curl -N -sf -H "Accept: text/event-stream" "localhost:5221/api/brain/harness/pipeline/${TEST_ID}/stream" > /tmp/sse_w2_nu.txt 2>&1 || true; node -e "const fs=require(\"fs\");const lines=fs.readFileSync(\"/tmp/sse_w2_nu.txt\",\"utf8\").split(\"\\n\");const ni=lines.findIndex(l=>l===\"event: node_update\");if(ni<0){process.stderr.write(\"FAIL: SSE 未推 node_update\\n\");process.exit(1);}const dl=lines[ni+1];if(!dl||!dl.startsWith(\"data:\")){process.stderr.write(\"FAIL: data 行缺失\\n\");process.exit(1);}const data=JSON.parse(dl.slice(5).trim());const req=[\"event_id\",\"initiative_id\",\"node\",\"status\",\"payload\",\"ts\"];const miss=req.filter(k=>!(k in data));if(miss.length){process.stderr.write(\"FAIL: 缺字段 \"+miss.join(\",\")+\"\\n\");process.exit(1);}process.stdout.write(\"PASS: SSE node_update schema 正确\\n\")"'
  期望: PASS: SSE node_update schema 正确

- [x] [BEHAVIOR] GET /stream SSE done 事件含 status 和 verdict（禁用 result/outcome/state/message）
  Test: manual:bash -c 'TEST_ID="00000000-0000-0000-0000-000000000001"; timeout 8 curl -N -sf -H "Accept: text/event-stream" "localhost:5221/api/brain/harness/pipeline/${TEST_ID}/stream" > /tmp/sse_w2_done.txt 2>&1 || true; node -e "const fs=require(\"fs\");const lines=fs.readFileSync(\"/tmp/sse_w2_done.txt\",\"utf8\").split(\"\\n\");const di=lines.findIndex(l=>l===\"event: done\");if(di<0){process.stderr.write(\"FAIL: 未收到 done 事件\\n\");process.exit(1);}const dl=lines[di+1];if(!dl||!dl.startsWith(\"data:\")){process.stderr.write(\"FAIL: done data 行缺失\\n\");process.exit(1);}const data=JSON.parse(dl.slice(5).trim());if(!(\"status\" in data)||!(\"verdict\" in data)){process.stderr.write(\"FAIL: done data 缺 status/verdict\\n\");process.exit(1);}const banned=[\"result\",\"outcome\",\"state\",\"message\"];const found=banned.filter(k=>k in data);if(found.length){process.stderr.write(\"FAIL: 禁用字段 \"+found.join(\",\")+\"\\n\");process.exit(1);}process.stdout.write(\"PASS: done 事件 schema 正确\\n\")"'
  期望: PASS: done 事件 schema 正确

- [x] [BEHAVIOR] GET /stream 支持 after_event_id 断线重连参数（不返回 400）
  Test: manual:bash -c 'TEST_ID="00000000-0000-0000-0000-000000000001"; LAST=$(curl -sf "localhost:5221/api/brain/harness/pipeline/${TEST_ID}/events" | jq -r '"'"'.events[-1].event_id // empty'"'"'); [ -n "$LAST" ] || { printf "SKIP: 无历史事件\n"; exit 0; }; CODE=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 3 -H "Accept: text/event-stream" "localhost:5221/api/brain/harness/pipeline/${TEST_ID}/stream?after_event_id=${LAST}" 2>/dev/null || printf "200"); [ "$CODE" != "400" ] || { printf "FAIL: after_event_id 参数被拒绝 400\n"; exit 1; }; printf "PASS: after_event_id 参数有效\n"'
  期望: PASS: after_event_id 参数有效
