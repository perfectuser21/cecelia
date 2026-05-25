contract_branch: cp-harness-propose-r3-92950980
workstream_index: 2
sprint_dir: sprints/cecelia-pipeline-viz-v2

---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: Brain GET /api/brain/harness/initiative/:id/detail 端点

**范围**: `packages/brain/src/routes/harness.js`（新增 GET /initiative/:id/detail 路由，从 tasks + initiative_contracts + task_events + checkpoint_blobs 组装响应）+ `packages/brain/src/__tests__/harness-detail.test.js`（新建单测，含 mock pool）
**大小**: M（约 120-150 行净增，2 文件）
**依赖**: Workstream 1 完成后

---

## Risks

### R2a: 端点未注册 → Brain 通用 404 handler 假绿
**影响**: Brain 通用 404 handler 返回 `{"error":"Not Found"}`，对任何路径均 404，导致"404-acceptable"旁路假绿
**缓解**: BEHAVIOR 1 使用真实 initiative（先 INSERT 到 DB），对真实 initiative 调用 /detail 必须返回 200；404 只对不存在 initiative 允许。端点未注册时真实 initiative 也返 404 → 真红 ✓

### R2b: schema keys 顺序不一致导致 jq 比较失败
**影响**: jq keys 输出字母升序，PRD schema 集合字面顺序不同，proposer 拼错 jq 断言
**缓解**: BEHAVIOR 3 使用字母升序排列 `["contract_content","gan_rounds","initiative_id","prd_content","screenshot_urls","step_timing"]`

---

## ARTIFACT 条目

- [x] [ARTIFACT] `packages/brain/src/routes/harness.js` 含 `/initiative/:id/detail` 路由注册
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('/initiative/:id/detail') && !c.includes(\"initiative/:id/detail\"))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `packages/brain/src/__tests__/harness-detail.test.js` 存在且含 mock pool + describe 块
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/harness-detail.test.js','utf8');if(!c.includes('describe') || !c.includes('initiative'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目（内嵌 manual:bash 命令）

- [x] [BEHAVIOR] 已存在的 initiative 调用 /detail 返回 HTTP 200（端点未注册时 Brain 404 → 真红）
  Test: manual:bash -c 'TEST_ID=$(curl -sf -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d "{\"task_type\":\"harness_initiative\",\"title\":\"test-detail-dod-ws2\"}" | jq -r .id); [ -n "$TEST_ID" ] || { echo "FAIL: task creation failed"; exit 1; }; RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/$TEST_ID/detail") || { echo "FAIL: 端点未返回 200"; exit 1; }; echo "$RESP" | jq -e '"'"'.initiative_id | type == "string"'"'"' || { echo "FAIL: initiative_id not string"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] /detail 响应含 step_timing(array) 和 screenshot_urls(array)
  Test: manual:bash -c 'TEST_ID=$(curl -sf -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d "{\"task_type\":\"harness_initiative\",\"title\":\"test-detail-arrays-ws2\"}" | jq -r .id); [ -n "$TEST_ID" ] || exit 1; RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/$TEST_ID/detail") || exit 1; echo "$RESP" | jq -e '"'"'.step_timing | type == "array"'"'"' || { echo "FAIL: step_timing not array"; exit 1; }; echo "$RESP" | jq -e '"'"'.screenshot_urls | type == "array"'"'"' || { echo "FAIL: screenshot_urls not array"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] /detail 响应 schema 完整性 — 顶层 keys 完全等于 PRD 定义的 6 字段集合（jq 字母序）
  Test: manual:bash -c 'TEST_ID=$(curl -sf -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d "{\"task_type\":\"harness_initiative\",\"title\":\"test-detail-keys-ws2\"}" | jq -r .id); [ -n "$TEST_ID" ] || exit 1; RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/$TEST_ID/detail") || exit 1; echo "$RESP" | jq -e '"'"'keys == ["contract_content","gan_rounds","initiative_id","prd_content","screenshot_urls","step_timing"]'"'"' || { echo "FAIL: schema 顶层 keys 不符 PRD 定义"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] /detail 响应禁用字段不存在（steps/timeline/result/data/details/info/content/report）
  Test: manual:bash -c 'TEST_ID=$(curl -sf -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d "{\"task_type\":\"harness_initiative\",\"title\":\"test-detail-banned-ws2\"}" | jq -r .id); [ -n "$TEST_ID" ] || exit 1; RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/$TEST_ID/detail") || exit 1; for FIELD in steps timeline result data details info content report; do echo "$RESP" | jq -e "has(\"$FIELD\") | not" || { echo "FAIL: 禁用字段 $FIELD 出现在响应中"; exit 1; }; done; echo OK'
  期望: OK

- [x] [BEHAVIOR] 不存在的 initiative 返回 HTTP 404 + error 字段（string）
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/detail-404-ws2.json -w "%{http_code}" "localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000099/detail"); [ "$CODE" = "404" ] || exit 1; jq -e '"'"'.error | type == "string"'"'"' >/dev/null /tmp/detail-404-ws2.json'
  期望: OK

- [x] [BEHAVIOR] prd_content/contract_content/gan_rounds 字段类型符合 PRD 定义（string|null / number|null）
  Test: manual:bash -c 'TEST_ID=$(curl -sf -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d "{\"task_type\":\"harness_initiative\",\"title\":\"test-detail-nullable-ws2\"}" | jq -r .id); [ -n "$TEST_ID" ] || exit 1; RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/$TEST_ID/detail") || exit 1; echo "$RESP" | jq -e '"'"'.prd_content | (type == "string" or . == null)'"'"' || { echo "FAIL: prd_content 类型不符（非 string|null）"; exit 1; }; echo "$RESP" | jq -e '"'"'.contract_content | (type == "string" or . == null)'"'"' || { echo "FAIL: contract_content 类型不符"; exit 1; }; echo "$RESP" | jq -e '"'"'.gan_rounds | (type == "number" or . == null)'"'"' || { echo "FAIL: gan_rounds 类型不符（非 number|null）"; exit 1; }; echo OK'
  期望: OK

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑）

- [x] [BEHAVIOR:E2E] 用户点击 initiative card，详情面板展示 /detail API 数据（Playwright）
  Screenshots:
    - 01-pipeline-list.png   期望：/pipeline 页正常加载，initiative-card 列表可见，无 JS 错误
    - 02-card-click.png      期望：点击 card 后侧栏/抽屉开始出现（过渡中）
    - 03-detail-panel.png    期望：`[data-testid="initiative-detail-panel"]` 可见，面板完全展开
    - 04-prd-content.png     期望：`[data-testid="initiative-prd-content"]` 可见，含 PRD 相关文字
    - 05-timeline.png        期望：`[data-testid="initiative-step-timeline"]` 可见，step 条目 ≥ 0 条
  期望：Playwright exit 0，所有 toBeVisible 断言通过，/detail API schema 验证通过
