---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: 实现 GET /initiative/:id/detail 路由

**范围**: 在 `packages/brain/src/routes/harness.js` 中新增 `GET /initiative/:id/detail` 路由处理函数
**大小**: S（净增 < 100 行）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/harness.js` 含 `router.get('/initiative/:id/detail'` 路由注册
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes(\"router.get('/initiative/:id/detail'\"))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] 存在的 initiative ID 返回 200 + initiative_id 字段等于请求路径 :id
  Test: manual:bash -c 'DB="${DB:-postgresql://localhost/cecelia}"; TEST_ID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('"'"'harness_initiative'"'"', '"'"'queued'"'"', '"'"'dod-behavior1'"'"', '"'"'{"sprint_dir":"sprints/nonexistent-xyz"}'"'"') RETURNING id" | tr -d '"'"' \n'"'"'); RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${TEST_ID}/detail") || { echo "FAIL: 端点未返回 200"; exit 1; }; echo "$RESP" | jq -e --arg id "$TEST_ID" '"'"'.initiative_id == $id'"'"' || { echo "FAIL: initiative_id 不匹配"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] schema keys 完整性 — 顶层 keys 精确等于 PRD 定义的六个字段
  Test: manual:bash -c 'DB="${DB:-postgresql://localhost/cecelia}"; SCHEMA_ID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('"'"'harness_initiative'"'"', '"'"'queued'"'"', '"'"'dod-behavior2'"'"', '"'"'{"sprint_dir":"sprints/nonexistent-xyz"}'"'"') RETURNING id" | tr -d '"'"' \n'"'"'); RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${SCHEMA_ID}/detail") || { echo "FAIL"; exit 1; }; echo "$RESP" | jq -e '"'"'keys == ["contract_content","gan_rounds","initiative_id","prd_content","screenshot_urls","step_timing"]'"'"' || { echo "FAIL: keys 不完整"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 禁用字段反向检查 — response 中不含全部 7 个禁用字段（prd/contract/timeline/screenshots/stages/details/data）
  Test: manual:bash -c 'DB="${DB:-postgresql://localhost/cecelia}"; FBD_ID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('"'"'harness_initiative'"'"', '"'"'queued'"'"', '"'"'dod-behavior3'"'"', '"'"'{"sprint_dir":"sprints/nonexistent-xyz"}'"'"') RETURNING id" | tr -d '"'"' \n'"'"'); RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${FBD_ID}/detail") || { echo "FAIL"; exit 1; }; echo "$RESP" | jq -e '"'"'has("prd") | not'"'"' || { echo "FAIL: 含禁用字段 prd"; exit 1; }; echo "$RESP" | jq -e '"'"'has("contract") | not'"'"' || { echo "FAIL: 含禁用字段 contract"; exit 1; }; echo "$RESP" | jq -e '"'"'has("timeline") | not'"'"' || { echo "FAIL: 含禁用字段 timeline"; exit 1; }; echo "$RESP" | jq -e '"'"'has("screenshots") | not'"'"' || { echo "FAIL: 含禁用字段 screenshots"; exit 1; }; echo "$RESP" | jq -e '"'"'has("stages") | not'"'"' || { echo "FAIL: 含禁用字段 stages"; exit 1; }; echo "$RESP" | jq -e '"'"'has("details") | not'"'"' || { echo "FAIL: 含禁用字段 details"; exit 1; }; echo "$RESP" | jq -e '"'"'has("data") | not'"'"' || { echo "FAIL: 含禁用字段 data"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — 不存在 ID → 404 + error 字段精确等于 "initiative not found"（不是 Brain 全局 404 的 "Not Found"）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000000/detail"); [ "$CODE" = "404" ] || { echo "FAIL: 应为 404，实际 '"'"'$CODE'"'"'"; exit 1; }; RESP=$(curl -s "localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000000/detail"); echo "$RESP" | jq -e '"'"'.error == "initiative not found"'"'"' || { echo "FAIL: error 字段应为 initiative not found（Brain 全局 404 返回 Not Found 不通过）"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] prd_content 和 contract_content 类型 — 文件不存在时两者均为 null（不报 5xx）
  Test: manual:bash -c 'DB="${DB:-postgresql://localhost/cecelia}"; NF_ID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('"'"'harness_initiative'"'"', '"'"'queued'"'"', '"'"'dod-behavior5'"'"', '"'"'{"sprint_dir":"sprints/nonexistent-test-xyz"}'"'"') RETURNING id" | tr -d '"'"' \n'"'"'); RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${NF_ID}/detail") || { echo "FAIL: 文件不存在时应返回 200"; exit 1; }; echo "$RESP" | jq -e '"'"'.prd_content == null'"'"' || { echo "FAIL: prd_content 应为 null"; exit 1; }; echo "$RESP" | jq -e '"'"'.contract_content == null'"'"' || { echo "FAIL: contract_content 应为 null"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] screenshot_urls 始终为 array 类型（空时为 []，不为 null）
  Test: manual:bash -c 'DB="${DB:-postgresql://localhost/cecelia}"; SS_ID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('"'"'harness_initiative'"'"', '"'"'queued'"'"', '"'"'dod-behavior6'"'"', '"'"'{"sprint_dir":"sprints/nonexistent-xyz"}'"'"') RETURNING id" | tr -d '"'"' \n'"'"'); RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${SS_ID}/detail") || { echo "FAIL"; exit 1; }; echo "$RESP" | jq -e '"'"'.screenshot_urls | type == "array"'"'"' || { echo "FAIL: screenshot_urls 不是数组"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] gan_rounds 类型 — 必须为 null 或 number，禁止字符串
  Test: manual:bash -c 'DB="${DB:-postgresql://localhost/cecelia}"; GR_ID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('"'"'harness_initiative'"'"', '"'"'queued'"'"', '"'"'dod-behavior7'"'"', '"'"'{"sprint_dir":"sprints/nonexistent-xyz"}'"'"') RETURNING id" | tr -d '"'"' \n'"'"'); RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${GR_ID}/detail") || { echo "FAIL"; exit 1; }; echo "$RESP" | jq -e '"'"'.gan_rounds == null or (.gan_rounds | type == "number")'"'"' || { echo "FAIL: gan_rounds 必须为 null 或 number"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] step_timing 元素结构 — 有关联子任务时各元素含 node/started_at/ended_at/duration_ms 四个字段
  Test: manual:bash -c 'DB="${DB:-postgresql://localhost/cecelia}"; INIT_ID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('"'"'harness_initiative'"'"', '"'"'queued'"'"', '"'"'dod-behavior8'"'"', '"'"'{"sprint_dir":"sprints/nonexistent-xyz"}'"'"') RETURNING id" | tr -d '"'"' \n'"'"'); psql "$DB" -c "INSERT INTO tasks (task_type, status, title, payload, started_at, completed_at) VALUES ('"'"'harness_contract_propose'"'"', '"'"'completed'"'"', '"'"'dod-b8-sub'"'"', json_build_object('"'"'initiative_id'"'"', '"'"''"'"'${INIT_ID}'"'"''"'"', '"'"'sprint_dir'"'"', '"'"'sprints/nonexistent-xyz'"'"'), NOW() - interval '"'"'5 minutes'"'"', NOW() - interval '"'"'2 minutes'"'"')" > /dev/null; RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${INIT_ID}/detail") || { echo "FAIL"; exit 1; }; COUNT=$(echo "$RESP" | jq '"'"'.step_timing | length'"'"'); [ "$COUNT" -ge 1 ] || { echo "FAIL: step_timing 应有 >=1 元素（已插入子任务）"; exit 1; }; echo "$RESP" | jq -e '"'"'.step_timing[0].node | type == "string"'"'"' || { echo "FAIL: node 非字符串"; exit 1; }; echo "$RESP" | jq -e '"'"'.step_timing[0] | has("started_at")'"'"' || { echo "FAIL: 缺 started_at"; exit 1; }; echo "$RESP" | jq -e '"'"'.step_timing[0] | has("ended_at")'"'"' || { echo "FAIL: 缺 ended_at"; exit 1; }; echo "$RESP" | jq -e '"'"'.step_timing[0] | has("duration_ms")'"'"' || { echo "FAIL: 缺 duration_ms"; exit 1; }; echo OK'
  期望: OK
