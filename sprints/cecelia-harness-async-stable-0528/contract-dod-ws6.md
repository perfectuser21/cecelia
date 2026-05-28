---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 6: 消息 API 端点 + thread_lookup status 生命周期

**范围**: 在 `packages/brain/src/routes/harness.js` 新增 GET/POST `/api/brain/harness/messages/:initiativeId/:subTaskId`（GET 支持 `?consumed` 过滤，禁用别名 `include_consumed`/`all`/`show_consumed`）；在 `packages/brain/src/lib/harness-thread-lookup.js` 新增 `updateHarnessThreadStatus()` 并在 graph 结束/失败时调用。
**大小**: M (~130 行，2 文件)
**依赖**: WS5 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] `routes/harness.js` 含 GET `/messages/:initiativeId/:subTaskId` 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8'); if(!c.includes('messages') || !c.includes(':initiativeId') || !c.includes(':subTaskId'))process.exit(1)"

- [ ] [ARTIFACT] `routes/harness.js` 含 POST `/messages/:initiativeId/:subTaskId` 路由（返回 201）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8'); if(!c.includes('201') || !c.includes('messages'))process.exit(1)"

- [ ] [ARTIFACT] `harness-thread-lookup.js` 含 status 更新函数（UPDATE walking_skeleton_thread_lookup）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/lib/harness-thread-lookup.js','utf8'); if(!c.includes('UPDATE') || (!c.includes('completed') && !c.includes('failed')))process.exit(1)"

## BEHAVIOR 条目（PRD Response Schema 字段全覆盖 — ≥4 条，覆盖全部 schema 场景）

- [ ] [BEHAVIOR] GET /messages 端点返回 200 + `messages` 数组字段（PRD: `messages` 必填 array；端点未注册时 curl -sf → nonzero → 真红）
  Test: manual:bash -c 'RESP=$(curl -sf "localhost:5221/api/brain/harness/messages/00000000-0000-0000-0000-000000000001/smoke") || { echo "FAIL: GET messages 端点返回非 200"; exit 1; }; echo "$RESP" | jq -e ".messages | type == \"array\"" || { echo "FAIL: 缺 messages 字段"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET 顶层 keys 严格等于 `["messages"]`（PRD 禁用字段 data/items/results/payload/list 不存在）
  Test: manual:bash -c 'RESP=$(curl -sf "localhost:5221/api/brain/harness/messages/00000000-0000-0000-0000-000000000001/smoke") || exit 1; echo "$RESP" | jq -e "keys == [\"messages\"]" || { echo "FAIL: GET 顶层 keys 不符 [messages]"; exit 1; }; echo "$RESP" | jq -e "has(\"data\") | not" || { echo "FAIL: 含禁用字段 data"; exit 1; }; echo "$RESP" | jq -e "has(\"items\") | not" || { echo "FAIL: 含禁用字段 items"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST /messages 返回 201 + schema 字段 id/message/created_at + keys 完整性校验（PRD: keys == ["created_at","id","message"]）
  Test: manual:bash -c 'RESP=$(curl -sf -w "\n%{http_code}" -X POST -H "Content-Type: application/json" -d "{\"message\":\"dod-test\"}" "localhost:5221/api/brain/harness/messages/00000000-0000-0000-0000-000000000001/smoke"); CODE=$(echo "$RESP"|tail -1); BODY=$(echo "$RESP"|head -1); [ "$CODE" = "201" ] || { echo "FAIL: POST 非 201 (got $CODE)"; exit 1; }; echo "$BODY" | jq -e ".id | type == \"string\"" || { echo "FAIL: 缺 id"; exit 1; }; echo "$BODY" | jq -e ".message == \"dod-test\"" || { echo "FAIL: message 不符"; exit 1; }; echo "$BODY" | jq -e ".created_at | type == \"string\"" || { echo "FAIL: 缺 created_at"; exit 1; }; echo "$BODY" | jq -e "keys == [\"created_at\",\"id\",\"message\"]" || { echo "FAIL: POST keys 不符 [created_at,id,message]"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST 响应 keys 不含禁用字段（PRD 禁用: data/result/payload/body）
  Test: manual:bash -c 'BODY=$(curl -sf -X POST -H "Content-Type: application/json" -d "{\"message\":\"key-check\"}" "localhost:5221/api/brain/harness/messages/00000000-0000-0000-0000-000000000002/smoke") || exit 1; echo "$BODY" | jq -e "has(\"data\") | not" || { echo "FAIL: 含禁用字段 data"; exit 1; }; echo "$BODY" | jq -e "has(\"result\") | not" || { echo "FAIL: 含禁用字段 result"; exit 1; }; echo "$BODY" | jq -e "has(\"payload\") | not" || { echo "FAIL: 含禁用字段 payload"; exit 1; }; echo "$BODY" | jq -e "has(\"body\") | not" || { echo "FAIL: 含禁用字段 body"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET 不存在的 initiativeId 返回 `{"messages":[]}` 而非 404（PRD 边界：「查询到不存在的 initiativeId → 返 {"messages":[]}」）
  Test: manual:bash -c 'RESP=$(curl -sf "localhost:5221/api/brain/harness/messages/99999999-9999-9999-9999-999999999999/smoke") || { echo "FAIL: 不存在 ID 返回非 200"; exit 1; }; echo "$RESP" | jq -e ".messages == []" || { echo "FAIL: 不存在 ID 未返回空数组"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET 消息对象四字段完整性（PRD: id/message/created_at/consumed_at 必填 — 先 POST 创建消息再 GET 验证字段）
  Test: manual:bash -c 'INIT="00000000-0000-0000-0000-000000000006"; curl -sf -X POST -H "Content-Type: application/json" -d "{\"message\":\"field-check\"}" "localhost:5221/api/brain/harness/messages/$INIT/smoke" > /dev/null || exit 1; MSGS=$(curl -sf "localhost:5221/api/brain/harness/messages/$INIT/smoke" | jq ".messages") || exit 1; echo "$MSGS" | jq -e ".[0].id | type == \"string\"" || { echo "FAIL: 消息对象缺 id"; exit 1; }; echo "$MSGS" | jq -e ".[0].message | type == \"string\"" || { echo "FAIL: 消息对象缺 message"; exit 1; }; echo "$MSGS" | jq -e ".[0].created_at | type == \"string\"" || { echo "FAIL: 消息对象缺 created_at"; exit 1; }; echo "$MSGS" | jq -e ".[0] | has(\"consumed_at\")" || { echo "FAIL: 消息对象缺 consumed_at"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] consumed 查询参数实现 + 禁用别名代码检查（PRD: 参数名 consumed，禁用 include_consumed/all/show_consumed）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/routes/harness.js\",\"utf8\"); if(c.includes(\"include_consumed\")){console.error(\"FAIL: 路由使用禁用别名 include_consumed\");process.exit(1)} if(c.includes(\"show_consumed\")){console.error(\"FAIL: 路由使用禁用别名 show_consumed\");process.exit(1)} if(!c.includes(\"consumed\")){console.error(\"FAIL: 路由未实现 consumed 参数\");process.exit(1)} console.log(\"OK\")" || exit 1'
  期望: OK

- [ ] [BEHAVIOR] thread_lookup status 生命周期更新代码存在（completed/failed，实现前 harness-thread-lookup.js 不含 UPDATE 语句 → 真红）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/lib/harness-thread-lookup.js\",\"utf8\"); if(!c.includes(\"completed\") || !c.includes(\"failed\") || !c.includes(\"UPDATE\")){console.error(\"FAIL: harness-thread-lookup.js 缺 status 生命周期更新\");process.exit(1)} console.log(\"OK\")" || exit 1'
  期望: OK

- [ ] [BEHAVIOR] error path — POST body 无 `message` 字段时返回 4xx（输入校验）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "{}" "localhost:5221/api/brain/harness/messages/00000000-0000-0000-0000-000000000001/smoke"); ([ "$CODE" = "400" ] || [ "$CODE" = "422" ]) || { echo "FAIL: 空 body 未返回 4xx (got $CODE)"; exit 1; }; echo OK'
  期望: OK
