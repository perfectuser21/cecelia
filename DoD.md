contract_branch: cp-harness-propose-r2-9d693319
workstream_index: 1
sprint_dir: sprints

---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: Backend SSE stream 端点

**范围**: `packages/brain/src/routes/harness.js` 新增 `GET /stream` 端点；query 参数 `planner_task_id`（UUID）；每 2s 轮询 `task_events` 表推送 `event: node_update`；pipeline 完成/失败时推 `event: done`（含 verdict，keys 恰好 ["status","verdict"]）；每 30s 发 `: keepalive` comment；错误返 400/404
**大小**: M（100-150 行净增，1 文件）
**依赖**: 无

## Risks

| # | 风险 | 触发条件 | 缓解 |
|---|---|---|---|
| R1 | `task_events` 索引缺失导致 2s 全表扫描 | `task_events` 无 `(task_id, event_type, created_at)` 复合索引 | Generator 实现前确认索引；无则 fallback 5s |
| R2 | Vite proxy 未路由 SSE 路径截断连接 | `vite.config.ts` proxy 未含 `/api/brain/harness/stream` | CI E2E 直连 `localhost:5221`，绕过 proxy |
| R3 | SSE 断连 cascade — 并发重连累积 DB 轮询负载 | 网络抖动 + 多用户同时查看 | `res.on('close')` 清理 timer；前端重连加 5s debounce |
| R4 | 旧浏览器无 EventSource 原生支持 | IE / 旧版 Safari | CI 用 Chromium；生产仅支持现代浏览器 |

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/harness.js` 含 `router.get('/stream'` 路由
  Test: node -e "const c=require('fs').readFileSync('/workspace/packages/brain/src/routes/harness.js','utf8');if(!c.includes(\"router.get('/stream'\")&&!c.includes('router.get(\"/stream\"'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `GET /stream` 路由使用 query 参数名 `planner_task_id`（不含禁用名 id/taskId/task_id/pipeline_id/tid）
  Test: node -e "const c=require('fs').readFileSync('/workspace/packages/brain/src/routes/harness.js','utf8');const s=c.slice(c.indexOf('/stream'));if(!s.includes('planner_task_id'))process.exit(1);if(/req\.query\.(id|taskId|task_id|pipeline_id|tid)[^_]/.test(s))process.exit(2);console.log('OK')"

- [ ] [ARTIFACT] SSE 响应头正确设置（Content-Type: text/event-stream，Cache-Control: no-cache，Connection: keep-alive）
  Test: node -e "const c=require('fs').readFileSync('/workspace/packages/brain/src/routes/harness.js','utf8');if(!c.includes('text/event-stream'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] 路由实现含 `res.on('close'` 或 `req.on('close'` 清理 setInterval（防 R3 断连 cascade）
  Test: node -e "const c=require('fs').readFileSync('/workspace/packages/brain/src/routes/harness.js','utf8');if(!c.includes('.on(\"close\"')&&!c.includes(\"on('close'\"))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] GET /stream?planner_task_id=<valid> 返回 HTTP 200 Content-Type: text/event-stream
  Test: manual:bash -c 'TEST_ID=$(PGUSER=cecelia PGHOST=localhost psql -d cecelia -t -c "INSERT INTO tasks (task_type,status,payload,title,created_at) VALUES ('"'"'test_sse_b1'"'"','"'"'in_progress'"'"','"'"'{}'"'"','"'"'B1 Conn Test'"'"',NOW()) RETURNING id" | tr -d " \n"); CT=$(curl -sI --max-time 3 "localhost:5221/api/brain/harness/stream?planner_task_id=$TEST_ID" | grep -i "content-type" | tr -d "\r"); echo "$CT" | grep -q "text/event-stream" && echo OK || { echo "FAIL: $CT"; exit 1; }'
  期望: OK (exit 0)

- [ ] [BEHAVIOR] node_update event — `node` 字段值等于 task_events.payload.nodeName（"proposer"），`attempt` 等于 attemptN（1）
  Test: manual:bash -c 'DB=cecelia; TEST_ID=$(PGUSER=cecelia PGHOST=localhost psql -d $DB -t -c "INSERT INTO tasks (task_type,status,payload,title,created_at) VALUES ('"'"'test_sse_b2'"'"','"'"'completed'"'"','"'"'{}'"'"','"'"'B2 NodeVal'"'"',NOW()) RETURNING id" | tr -d " \n"); PGUSER=cecelia PGHOST=localhost psql -d $DB -c "INSERT INTO task_events (task_id,event_type,payload,created_at) VALUES ('"'"'$TEST_ID'"'"','"'"'graph_node_update'"'"','"'"'{"initiativeId":"t","threadId":"t","nodeName":"proposer","attemptN":1,"payloadSummary":{}}'"'"'::jsonb, NOW()-interval '"'"'1 second'"'"')"; timeout 8 curl -sN -H "Accept: text/event-stream" "localhost:5221/api/brain/harness/stream?planner_task_id=$TEST_ID" > /tmp/b2.txt 2>&1 || true; D=$(grep "^data:" /tmp/b2.txt | grep -v '"'"'"status"'"'"' | head -1 | sed "s/^data: //"); [ -n "$D" ] || { echo "FAIL: no node_update"; cat /tmp/b2.txt; exit 1; }; echo "$D" | jq -e '"'"'.node == "proposer"'"'"' && echo "$D" | jq -e '"'"'.attempt == 1'"'"' && echo OK || exit 1'
  期望: OK (exit 0)

- [ ] [BEHAVIOR] node_update event — `label` 类型 string，`ts` 类型 string，keys 恰好 ["attempt","label","node","ts"]
  Test: manual:bash -c 'D=$(grep "^data:" /tmp/b2.txt | grep -v '"'"'"status"'"'"' | head -1 | sed "s/^data: //"); [ -n "$D" ] || { echo "FAIL: 无 SSE 数据（先跑 B2）"; exit 1; }; echo "$D" | jq -e '"'"'.label | type == "string"'"'"' && echo "$D" | jq -e '"'"'.ts | type == "string"'"'"' && echo "$D" | jq -e '"'"'keys == ["attempt","label","node","ts"]'"'"' && echo OK || exit 1'
  期望: OK (exit 0)

- [ ] [BEHAVIOR] node_update event — 全部 PRD 禁用字段均不存在：`name`/`nodeName`/`step`/`phase`/`stage`/`time`/`timestamp`/`type`
  Test: manual:bash -c 'D=$(grep "^data:" /tmp/b2.txt | grep -v '"'"'"status"'"'"' | head -1 | sed "s/^data: //"); [ -n "$D" ] || { echo "FAIL: 无 SSE 数据"; exit 1; }; echo "$D" | jq -e '"'"'has("name") | not'"'"' && echo "$D" | jq -e '"'"'has("nodeName") | not'"'"' && echo "$D" | jq -e '"'"'has("step") | not'"'"' && echo "$D" | jq -e '"'"'has("phase") | not'"'"' && echo "$D" | jq -e '"'"'has("stage") | not'"'"' && echo "$D" | jq -e '"'"'has("time") | not'"'"' && echo "$D" | jq -e '"'"'has("timestamp") | not'"'"' && echo "$D" | jq -e '"'"'has("type") | not'"'"' && echo OK || { echo "FAIL: 禁用字段漏网"; exit 1; }'
  期望: OK (exit 0)

- [ ] [BEHAVIOR] done event — `verdict` 字段值 ∈ {PASS, FAIL, null}，且 keys 恰好 ["status","verdict"]（不多不少）
  Test: manual:bash -c 'DONE=$(grep -A1 "^event: done" /tmp/b2.txt | grep "^data:" | sed "s/^data: //"); [ -n "$DONE" ] || { echo "FAIL: 无 event: done（先跑 B2）"; exit 1; }; echo "$DONE" | jq -e '"'"'.verdict == "PASS" or .verdict == "FAIL" or .verdict == null'"'"' && echo "$DONE" | jq -e '"'"'keys == ["status","verdict"]'"'"' && echo OK || { echo "FAIL: done 字段/keys 不符"; echo "$DONE"; exit 1; }'
  期望: OK (exit 0)

- [ ] [BEHAVIOR] error path — GET /stream（缺少 planner_task_id）返回 HTTP 400，body 含 `error` 字段（string），无 `message`/`msg` 禁用字段
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/b6_err.json -w "%{http_code}" "localhost:5221/api/brain/harness/stream"); [ "$CODE" = "400" ] || { echo "FAIL: expected 400 got $CODE"; exit 1; }; jq -e '"'"'has("error") and (.error | type == "string")'"'"' /tmp/b6_err.json && jq -e '"'"'has("message") | not'"'"' /tmp/b6_err.json && jq -e '"'"'has("msg") | not'"'"' /tmp/b6_err.json && echo OK || exit 1'
  期望: OK (exit 0)

- [ ] [BEHAVIOR] error path — GET /stream?planner_task_id=00000000-0000-0000-0000-000000000000（不存在 UUID）返回 HTTP 404，body `.error == "pipeline not found"`
  Test: manual:bash -c 'FAKE=00000000-0000-0000-0000-000000000000; CODE=$(curl -s -o /tmp/b7_nf.json -w "%{http_code}" "localhost:5221/api/brain/harness/stream?planner_task_id=$FAKE"); [ "$CODE" = "404" ] || { echo "FAIL: expected 404 got $CODE"; exit 1; }; jq -e '"'"'.error == "pipeline not found"'"'"' /tmp/b7_nf.json && echo OK || exit 1'
  期望: OK (exit 0)

- [ ] [BEHAVIOR] keepalive — in_progress pipeline 保持连接 32s 内收到至少 1 行 `: keepalive` SSE comment
  Test: manual:bash -c 'ALIVE_ID=$(PGUSER=cecelia PGHOST=localhost psql -d cecelia -t -c "INSERT INTO tasks (task_type,status,payload,title,created_at) VALUES ('"'"'test_ka_b8'"'"','"'"'in_progress'"'"','"'"'{}'"'"','"'"'KA B8'"'"',NOW()) RETURNING id" | tr -d " \n"); echo "[B8] 等待 32s 验证 keepalive..."; timeout 32 curl -sN -H "Accept: text/event-stream" "localhost:5221/api/brain/harness/stream?planner_task_id=$ALIVE_ID" > /tmp/b8_ka.txt 2>&1 || true; grep -q "^: keepalive" /tmp/b8_ka.txt && echo OK || { echo "FAIL: 32s 内无 keepalive comment"; cat /tmp/b8_ka.txt; exit 1; }'
  期望: OK (exit 0)
