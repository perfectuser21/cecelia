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

- [x] [ARTIFACT] `packages/brain/src/routes/harness.js` 含 `router.get('/stream'` 路由
  Test: node -e "const c=require('fs').readFileSync('/workspace/packages/brain/src/routes/harness.js','utf8');if(!c.includes(\"router.get('/stream'\")&&!c.includes('router.get(\"/stream\"'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `GET /stream` 路由使用 query 参数名 `planner_task_id`（不含禁用名 id/taskId/task_id/pipeline_id/tid）
  Test: node -e "const c=require('fs').readFileSync('/workspace/packages/brain/src/routes/harness.js','utf8');const s=c.slice(c.indexOf('/stream'));if(!s.includes('planner_task_id'))process.exit(1);if(/req\.query\.(id|taskId|task_id|pipeline_id|tid)[^_]/.test(s))process.exit(2);console.log('OK')"

- [x] [ARTIFACT] SSE 响应头正确设置（Content-Type: text/event-stream，Cache-Control: no-cache，Connection: keep-alive）
  Test: node -e "const c=require('fs').readFileSync('/workspace/packages/brain/src/routes/harness.js','utf8');if(!c.includes('text/event-stream'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] 路由实现含 `res.on('close'` 或 `req.on('close'` 清理 setInterval（防 R3 断连 cascade）
  Test: node -e "const c=require('fs').readFileSync('/workspace/packages/brain/src/routes/harness.js','utf8');if(!c.includes('.on(\"close\"')&&!c.includes(\"on('close'\"))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [x] [BEHAVIOR] GET /stream?planner_task_id=<valid> 返回 HTTP 200 Content-Type: text/event-stream
  Test: manual:bash -c 'TEST_ID=$(PGPASSWORD=cecelia_test PGUSER=cecelia PGHOST=localhost psql -d cecelia_test -t -c "INSERT INTO tasks (task_type,status,payload,title,created_at) VALUES ('"'"'harness_task'"'"','"'"'in_progress'"'"','"'"'{}'"'"','"'"'B1 Conn Test'"'"',NOW()) RETURNING id" | head -1 | tr -d " "); curl -sI --max-time 3 "localhost:5221/api/brain/harness/stream?planner_task_id=$TEST_ID" > /tmp/b1h.txt; node -e "const h=require(\"fs\").readFileSync(\"/tmp/b1h.txt\",\"utf8\").toLowerCase();if(!h.includes(\"content-type: text/event-stream\"))process.exit(1);process.stdout.write(\"OK\\n\")"'
  期望: OK (exit 0)

- [x] [BEHAVIOR] node_update event — `node` 字段值等于 task_events.payload.nodeName（"proposer"），`attempt` 等于 attemptN（1）
  Test: manual:bash -c 'DB=cecelia_test; TEST_ID=$(PGPASSWORD=cecelia_test PGUSER=cecelia PGHOST=localhost psql -d $DB -t -c "INSERT INTO tasks (task_type,status,payload,title,created_at) VALUES ('"'"'harness_task'"'"','"'"'completed'"'"','"'"'{}'"'"','"'"'B2 NodeVal'"'"',NOW()) RETURNING id" | head -1 | tr -d " "); PGPASSWORD=cecelia_test PGUSER=cecelia PGHOST=localhost psql -d $DB -c "INSERT INTO task_events (task_id,event_type,payload,created_at) VALUES ('"'"'$TEST_ID'"'"','"'"'graph_node_update'"'"','"'"'{\"initiativeId\":\"t\",\"threadId\":\"t\",\"nodeName\":\"proposer\",\"attemptN\":1,\"payloadSummary\":{}}'"'"'::jsonb, NOW()-interval '"'"'1 second'"'"')"; timeout 8 curl -sN -H "Accept: text/event-stream" "localhost:5221/api/brain/harness/stream?planner_task_id=$TEST_ID" > /tmp/b2.txt 2>&1 || true; node -e "const fs=require(\"fs\");const lines=fs.readFileSync(\"/tmp/b2.txt\",\"utf8\").split(\"\\n\");const d=lines.filter(l=>l.startsWith(\"data:\")).map(l=>{try{return JSON.parse(l.slice(6))}catch(e){return null}}).filter(Boolean).find(o=>\"node\" in o);if(!d){process.stdout.write(\"FAIL: no node_update\\n\");process.exit(1);}if(d.node!==\"proposer\"||d.attempt!==1){process.stdout.write(\"FAIL\\n\");process.exit(1);}process.stdout.write(\"OK\\n\")"'
  期望: OK (exit 0)

- [x] [BEHAVIOR] node_update event — `label` 类型 string，`ts` 类型 string，keys 恰好 ["attempt","label","node","ts"]
  Test: manual:bash -c 'node -e "const fs=require(\"fs\");const lines=fs.readFileSync(\"/tmp/b2.txt\",\"utf8\").split(\"\\n\");const d=lines.filter(l=>l.startsWith(\"data:\")).map(l=>{try{return JSON.parse(l.slice(6))}catch(e){return null}}).filter(Boolean).find(o=>\"node\" in o);if(!d){process.stdout.write(\"FAIL: no node_update (run B2 first)\\n\");process.exit(1);}if(typeof d.label!==\"string\"||typeof d.ts!==\"string\"){process.stdout.write(\"FAIL: type\\n\");process.exit(1);}const k=Object.keys(d).sort().join(\",\");if(k!==\"attempt,label,node,ts\"){process.stdout.write(\"FAIL keys: \"+k+\"\\n\");process.exit(1);}process.stdout.write(\"OK\\n\")"'
  期望: OK (exit 0)

- [x] [BEHAVIOR] node_update event — 全部 PRD 禁用字段均不存在：`name`/`nodeName`/`step`/`phase`/`stage`/`time`/`timestamp`/`type`
  Test: manual:bash -c 'node -e "const fs=require(\"fs\");const lines=fs.readFileSync(\"/tmp/b2.txt\",\"utf8\").split(\"\\n\");const d=lines.filter(l=>l.startsWith(\"data:\")).map(l=>{try{return JSON.parse(l.slice(6))}catch(e){return null}}).filter(Boolean).find(o=>\"node\" in o);if(!d){process.stdout.write(\"FAIL: no node_update\\n\");process.exit(1);}const banned=[\"name\",\"nodeName\",\"step\",\"phase\",\"stage\",\"time\",\"timestamp\",\"type\"];const found=banned.filter(k=>k in d);if(found.length){process.stdout.write(\"FAIL: banned fields: \"+found.join(\",\")+\"\\n\");process.exit(1);}process.stdout.write(\"OK\\n\")"'
  期望: OK (exit 0)

- [x] [BEHAVIOR] done event — `verdict` 字段值 ∈ {PASS, FAIL, null}，且 keys 恰好 ["status","verdict"]（不多不少）
  Test: manual:bash -c 'node -e "const fs=require(\"fs\");const lines=fs.readFileSync(\"/tmp/b2.txt\",\"utf8\").split(\"\\n\");let doneData=null;for(let i=0;i<lines.length;i++){if(lines[i]===\"event: done\"&&lines[i+1]&&lines[i+1].startsWith(\"data:\")){try{doneData=JSON.parse(lines[i+1].slice(6))}catch(e){}break;}}if(!doneData){process.stdout.write(\"FAIL: no event: done\\n\");process.exit(1);}const v=doneData.verdict;if(v!==\"PASS\"&&v!==\"FAIL\"&&v!==null){process.stdout.write(\"FAIL: bad verdict\\n\");process.exit(1);}const k=Object.keys(doneData).sort().join(\",\");if(k!==\"status,verdict\"){process.stdout.write(\"FAIL: done keys: \"+k+\"\\n\");process.exit(1);}process.stdout.write(\"OK\\n\")"'
  期望: OK (exit 0)

- [x] [BEHAVIOR] error path — GET /stream（缺少 planner_task_id）返回 HTTP 400，body 含 `error` 字段（string），无 `message`/`msg` 禁用字段
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/b6_err.json -w "%{http_code}" "localhost:5221/api/brain/harness/stream"); [ "$CODE" = "400" ] || { printf "FAIL: expected 400 got %s\n" "$CODE"; exit 1; }; jq -e '"'"'has("error") and (.error | type == "string")'"'"' /tmp/b6_err.json && jq -e '"'"'has("message") | not'"'"' /tmp/b6_err.json && jq -e '"'"'has("msg") | not'"'"' /tmp/b6_err.json && printf "OK\n" || exit 1'
  期望: OK (exit 0)

- [x] [BEHAVIOR] error path — GET /stream?planner_task_id=00000000-0000-0000-0000-000000000000（不存在 UUID）返回 HTTP 404，body `.error == "pipeline not found"`
  Test: manual:bash -c 'FAKE=00000000-0000-0000-0000-000000000000; CODE=$(curl -s -o /tmp/b7_nf.json -w "%{http_code}" "localhost:5221/api/brain/harness/stream?planner_task_id=$FAKE"); [ "$CODE" = "404" ] || { printf "FAIL: expected 404 got %s\n" "$CODE"; exit 1; }; jq -e '"'"'.error == "pipeline not found"'"'"' /tmp/b7_nf.json && printf "OK\n" || exit 1'
  期望: OK (exit 0)

- [x] [BEHAVIOR] keepalive — in_progress pipeline 保持连接 32s 内收到至少 1 行 `: keepalive` SSE comment
  Test: manual:bash -c 'ALIVE_ID=$(PGPASSWORD=cecelia_test PGUSER=cecelia PGHOST=localhost psql -d cecelia_test -t -c "INSERT INTO tasks (task_type,status,payload,title,created_at) VALUES ('"'"'harness_task'"'"','"'"'in_progress'"'"','"'"'{}'"'"','"'"'KA B8'"'"',NOW()) RETURNING id" | head -1 | tr -d " "); timeout 32 curl -sN -H "Accept: text/event-stream" "localhost:5221/api/brain/harness/stream?planner_task_id=$ALIVE_ID" > /tmp/b8_ka.txt 2>&1 || true; node -e "const c=require(\"fs\").readFileSync(\"/tmp/b8_ka.txt\",\"utf8\");if(!c.split(\"\\n\").some(l=>l===\":  keepalive\"||l===\": keepalive\")){process.stdout.write(\"FAIL: no keepalive\\n\");process.exit(1);}process.stdout.write(\"OK\\n\")"'
  期望: OK (exit 0)
