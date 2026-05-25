---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: Brain API /detail 端点

**范围**: `packages/brain/src/routes/harness.js` 新增 `GET /initiative/:id/detail` 路由；`packages/brain/src/__tests__/harness-detail.test.js` 单测
**大小**: M（100-130 行）
**依赖**: Workstream 1 完成后

---

## Risks

### R2a: `initiative_contracts` 表缺列（PR #3091 未合并）
**影响**: WS2 路由执行 `SELECT prd_content FROM initiative_contracts` 时 PostgreSQL 报 "column prd_content does not exist" → 路由抛异常 → HTTP 500（而非期望的 200 with null）。
**缓解**: Generator 在路由层 `try-catch` 包裹 initiative_contracts 查询；捕获到 column_not_found 错误（error.code = '42703'）时，prd_content/contract_content/gan_rounds 均返回 `null`，HTTP 仍 200。WS2 BEHAVIOR 边界条目（无 initiative_contracts 行 → prd_content == null）覆盖此路径。

### R2b: checkpoint_blobs 表或 channel 不存在导致 screenshot_urls 查询 500
**影响**: 若 checkpoint_blobs 表不存在或无 `channel='screenshot_urls'` 行，screenshot_urls 查询可能报错。
**缓解**: Generator 对 checkpoint_blobs 查询加 `COALESCE`：`COALESCE((SELECT ... FROM checkpoint_blobs ...), '[]'::jsonb)` 确保空结果返回 `[]` 而非 NULL/500。

---

## ARTIFACT 条目

- [x] [ARTIFACT] `packages/brain/src/routes/harness.js` 含 `/initiative/:id/detail` 路由字符串
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('/initiative/:id/detail'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `packages/brain/src/__tests__/harness-detail.test.js` 存在且含 test 关键字
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/harness-detail.test.js','utf8');if(!c.includes('it('))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目

- [x] [BEHAVIOR] `GET /api/brain/harness/initiative/:id/detail` 用真实 initiative UUID 返回 HTTP 200，`initiative_id` 为 string，`step_timing`/`screenshot_urls` 为 array
  Test: manual:bash -c 'TEST_ID=$(psql $DB -t -c "SELECT id FROM tasks WHERE task_type='"'"'harness_initiative'"'"' LIMIT 1" | tr -d " "); RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${TEST_ID}/detail"); echo "$RESP" | jq -e '"'"'.initiative_id | type == "string"'"'"' && echo "$RESP" | jq -e '"'"'.step_timing | type == "array"'"'"' && echo "$RESP" | jq -e '"'"'.screenshot_urls | type == "array"'"'"' && echo OK || exit 1'
  期望: OK

- [x] [BEHAVIOR] 可空字段类型正确：`prd_content` 为 string 或 null，`contract_content` 为 string 或 null，`gan_rounds` 为 number 或 null（PRD 定义的 nullable 字段）
  Test: manual:bash -c 'TEST_ID=$(psql $DB -t -c "SELECT id FROM tasks WHERE task_type='"'"'harness_initiative'"'"' LIMIT 1" | tr -d " "); RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${TEST_ID}/detail"); echo "$RESP" | jq -e '"'"'.prd_content == null or (.prd_content | type == "string")'"'"' && echo "$RESP" | jq -e '"'"'.contract_content == null or (.contract_content | type == "string")'"'"' && echo "$RESP" | jq -e '"'"'.gan_rounds == null or (.gan_rounds | type == "number")'"'"' && echo OK || exit 1'
  期望: OK

- [x] [BEHAVIOR] Response 顶层 keys 完整性：完全等于 `["contract_content","gan_rounds","initiative_id","prd_content","screenshot_urls","step_timing"]`（字母排序），禁用字段（steps/phases/timeline/data/result/details/info）不存在
  Test: manual:bash -c 'TEST_ID=$(psql $DB -t -c "SELECT id FROM tasks WHERE task_type='"'"'harness_initiative'"'"' LIMIT 1" | tr -d " "); curl -sf "localhost:5221/api/brain/harness/initiative/${TEST_ID}/detail" | jq -e '"'"'[keys[] | .] | sort == ["contract_content","gan_rounds","initiative_id","prd_content","screenshot_urls","step_timing"]'"'"' && echo OK || exit 1'
  期望: OK

- [x] [BEHAVIOR] 禁用字段反向检查：`steps`/`timeline`/`result`/`data`/`details`/`info` 均不在响应顶层 keys 中
  Test: manual:bash -c 'TEST_ID=$(psql $DB -t -c "SELECT id FROM tasks WHERE task_type='"'"'harness_initiative'"'"' LIMIT 1" | tr -d " "); RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${TEST_ID}/detail"); echo "$RESP" | jq -e '"'"'has("steps") | not'"'"' && echo "$RESP" | jq -e '"'"'has("timeline") | not'"'"' && echo "$RESP" | jq -e '"'"'has("result") | not'"'"' && echo "$RESP" | jq -e '"'"'has("data") | not'"'"' && echo OK || exit 1'
  期望: OK

- [x] [BEHAVIOR] Error path：传入不存在 UUID → HTTP 404 + `error` 字段为 string 类型
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000000/detail"); [ "$CODE" = "404" ] && curl -s "localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000000/detail" | jq -e '"'"'.error | type == "string"'"'"' && echo OK || exit 1'
  期望: OK

- [x] [BEHAVIOR] 边界：initiative 无 initiative_contracts 行 → prd_content/contract_content 均为 null，HTTP 200（不 500）
  Test: manual:bash -c 'TEST_ID=$(psql $DB -t -c "SELECT t.id FROM tasks t LEFT JOIN initiative_contracts ic ON ic.initiative_id=t.id WHERE t.task_type='"'"'harness_initiative'"'"' AND ic.id IS NULL LIMIT 1" | tr -d " "); if [ -z "$TEST_ID" ]; then echo "SKIP: 无无合约 initiative"; exit 0; fi; RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${TEST_ID}/detail"); echo "$RESP" | jq -e '"'"'.prd_content == null'"'"' && echo OK || exit 1'
  期望: OK 或 SKIP

- [x] [BEHAVIOR] `step_timing` 数组元素（有事件时）每条含 `node`/`started_at`/`ended_at`/`duration_ms` 字段，无事件时返回 `[]`
  Test: manual:bash -c 'EVT_ID=$(psql $DB -t -c "SELECT DISTINCT task_id FROM task_events WHERE event_type='"'"'graph_node_update'"'"' AND task_id IN (SELECT id FROM tasks WHERE task_type='"'"'harness_initiative'"'"') LIMIT 1" | tr -d " "); if [ -n "$EVT_ID" ]; then curl -sf "localhost:5221/api/brain/harness/initiative/${EVT_ID}/detail" | jq -e '"'"'.step_timing[0] | has("node") and has("started_at") and has("ended_at") and has("duration_ms")'"'"' && echo OK || exit 1; else echo "SKIP"; fi'
  期望: OK 或 SKIP

---

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑）

- [x] [BEHAVIOR:E2E] Playwright 直调 /detail API，验证返回数据结构正确（截图 API 交叉验证）
  Screenshots:
    - 03-detail-panel.png   期望：面板打开，PRD 内容区块可见（含 "# Sprint PRD" 字样）
    - 04-prd-content.png    期望：PRD Markdown 渲染，标题清晰可读
  期望：API 返回 `screenshot_urls` 为 array，`step_timing` 为 array；Playwright 截图 DOM 与期望一致
