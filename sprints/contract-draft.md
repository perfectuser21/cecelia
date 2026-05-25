# Sprint Contract Draft (Round 2)

## Golden Path

[Dashboard 前端] → [GET /api/brain/harness/initiative/:id/detail] → [Brain UUID 验证 → initiative_contracts 查询 → cecelia_events 重建] → [HTTP 200 + 6 字段 schema（无数据时 nulls+[] 宽容降级）]

---

### Step 1: 前端调用 GET /api/brain/harness/initiative/:id/detail

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 行：「前端带 initiative_id（即 harness_initiative 任务 ID）调用该端点」

**可观测行为**: Brain harness.js 注册新路由，返回非 404 响应，端点存在且可达

**验证命令**:
```bash
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000001/detail)
[ "$HTTP_CODE" != "404" ] || { echo "FAIL: 端点未注册，返回 404"; exit 1; }
echo "✅ Step 1: 端点已注册，HTTP $HTTP_CODE"
```

**硬阈值**: HTTP 状态码 ≠ 404（路由已注册）

---

### Step 2: Brain 验证 UUID 格式，非法格式返回 400

**来源**: `[FROM_PRD]` — PRD 边界情况：「id 不是合法 UUID → 400 {"error":"invalid id"}」

**可观测行为**: 非 UUID 格式的 id（如 `not-a-uuid`）触发 400 响应，body 含 `{"error":"invalid id"}`

**验证命令**:
```bash
RESP=$(curl -s localhost:5221/api/brain/harness/initiative/not-a-uuid/detail)
CODE=$(curl -s -o /dev/null -w "%{http_code}" localhost:5221/api/brain/harness/initiative/not-a-uuid/detail)
[ "$CODE" = "400" ] || { echo "FAIL: 期望 400, 得到 $CODE"; exit 1; }
echo "$RESP" | jq -e '.error == "invalid id"' || { echo "FAIL: error 字段不匹配"; exit 1; }
echo "✅ Step 2: UUID 校验 → 400 通过"
```

**硬阈值**: HTTP 400 + `{"error":"invalid id"}`

---

### Step 3: Brain 从 initiative_contracts 查 prd_content + contract_content

**来源**: `[FROM_PRD]` — PRD 背景第 2 条：「Brain 从 initiative_contracts 表读取 prd_content、contract_content」

**可观测行为**: 对有效 UUID，返回 HTTP 200；prd_content/contract_content 为 string 或 null（无数据时宽容降级，不返回 404）

**验证命令**:
```bash
TEST_ID="00000000-0000-0000-0000-000000000001"
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${TEST_ID}/detail") || { echo "FAIL: 端点未返回 200"; exit 1; }
echo "$RESP" | jq -e '.prd_content == null or (.prd_content | type == "string")' || { echo "FAIL: prd_content 类型不符"; exit 1; }
echo "$RESP" | jq -e '.contract_content == null or (.contract_content | type == "string")' || { echo "FAIL: contract_content 类型不符"; exit 1; }
echo "✅ Step 3: initiative_contracts 查询字段类型正确"
```

**硬阈值**: HTTP 200，prd_content 为 string|null，contract_content 为 string|null

---

### Step 4: Brain 从 cecelia_events 重建 step_timing + gan_rounds

**来源**: `[FROM_PRD]` — PRD 背景第 2 条：「从 cecelia_events（event_type='langgraph_step'）重建 step_timing 和 gan_rounds」

**可观测行为**: step_timing 为 array（无事件时为 `[]`），gan_rounds 为 number|null；cecelia_events 查询失败时 step_timing 降级为 `[]` 不抛 500

**验证命令**:
```bash
TEST_ID="00000000-0000-0000-0000-000000000001"
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${TEST_ID}/detail") || { echo "FAIL: 端点未返回 200"; exit 1; }
echo "$RESP" | jq -e '.step_timing | type == "array"' || { echo "FAIL: step_timing 不是数组"; exit 1; }
echo "$RESP" | jq -e '.gan_rounds == null or (.gan_rounds | type == "number")' || { echo "FAIL: gan_rounds 类型不符"; exit 1; }
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/initiative/${TEST_ID}/detail")
[ "$CODE" != "500" ] || { echo "FAIL: 返回 500（cecelia_events 降级失败）"; exit 1; }
echo "✅ Step 4: cecelia_events 重建字段类型正确，无 500"
```

**硬阈值**: step_timing 为 array，gan_rounds 为 number|null，HTTP ≠ 500

---

### Step 5: 返回 schema 完整，initiative_id 原样回显，screenshot_urls 固定 []

**来源**: `[FROM_PRD]` — PRD Response Schema：「顶层 keys 必须完全等于 ["initiative_id","prd_content","contract_content","gan_rounds","step_timing","screenshot_urls"]」；PRD：「screenshot_urls 当前固定返回 []」

**可观测行为**: 响应 body 顶层 keys 精确等于 6 个字段（按字母序），initiative_id 值与请求 id 一致，screenshot_urls 固定 `[]`

**验证命令**:
```bash
TEST_ID="00000000-0000-0000-0000-000000000001"
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${TEST_ID}/detail") || { echo "FAIL: 端点未返回 200"; exit 1; }
echo "$RESP" | jq -e 'keys == ["contract_content","gan_rounds","initiative_id","prd_content","screenshot_urls","step_timing"]' || { echo "FAIL: keys 不完全匹配"; exit 1; }
echo "$RESP" | jq -e ".initiative_id == \"${TEST_ID}\"" || { echo "FAIL: initiative_id 回显不匹配"; exit 1; }
echo "$RESP" | jq -e '.screenshot_urls == []' || { echo "FAIL: screenshot_urls 不为空数组"; exit 1; }
echo "✅ Step 5: schema 完整性通过"
```

**硬阈值**: keys 精确匹配 6 字段，initiative_id 回显，screenshot_urls = []

---

### Step 6: 全部 7 个禁用字段不出现在响应体

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，Round 2 扩充至全部 7 个 PRD 禁用字段；理由：防止 generator 混入 PRD 禁用字段（steps/stages/tasks/contract/runs/data/payload），导致 evaluator schema 验证假通过

**可观测行为**: 响应 body 不含 PRD 禁用的任何字段（共 7 个）

**验证命令**:
```bash
TEST_ID="00000000-0000-0000-0000-000000000001"
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${TEST_ID}/detail") || { echo "FAIL: 端点未返回 200"; exit 1; }
echo "$RESP" | jq -e 'has("steps") | not'   || { echo "FAIL: 禁用字段 steps 存在"; exit 1; }
echo "$RESP" | jq -e 'has("stages") | not'  || { echo "FAIL: 禁用字段 stages 存在"; exit 1; }
echo "$RESP" | jq -e 'has("tasks") | not'   || { echo "FAIL: 禁用字段 tasks 存在"; exit 1; }
echo "$RESP" | jq -e 'has("contract") | not'|| { echo "FAIL: 禁用字段 contract 存在"; exit 1; }
echo "$RESP" | jq -e 'has("runs") | not'    || { echo "FAIL: 禁用字段 runs 存在"; exit 1; }
echo "$RESP" | jq -e 'has("data") | not'    || { echo "FAIL: 禁用字段 data 存在"; exit 1; }
echo "$RESP" | jq -e 'has("payload") | not' || { echo "FAIL: 禁用字段 payload 存在"; exit 1; }
echo "✅ Step 6: 全部 7 个禁用字段检查通过"
```

**硬阈值**: has("steps"|"stages"|"tasks"|"contract"|"runs"|"data"|"payload") 均返回 false

---

### Step 7: step_timing 数组元素结构符合 PRD 规格

**来源**: `[AI_ADDED]` — GAN Round 2 Proposer 加入（响应 Reviewer 反馈 verification_oracle_completeness=6）；理由：当 cecelia_events 有真实 langgraph_step 事件时，元素 schema 漂移无法被捕获，需在有数据时验证每个元素含 `{node,started_at,ended_at,duration_ms}` 四个字段

**可观测行为**: step_timing 非空时，每个元素包含且仅包含 PRD 规定的 4 个字段，node/started_at 为 string，duration_ms 为 number|null，ended_at 为 string|null

**验证命令**:
```bash
TEST_ID="00000000-0000-0000-0000-000000000001"
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${TEST_ID}/detail") || { echo "FAIL: 端点未返回 200"; exit 1; }
# 当数组有元素时检查结构；空数组时直接通过（宽容降级符合 PRD）
echo "$RESP" | jq -e '.step_timing | if length > 0 then (.[0] | keys == ["duration_ms","ended_at","node","started_at"]) else true end' \
  || { echo "FAIL: step_timing 元素 keys 不符 {node,started_at,ended_at,duration_ms}"; exit 1; }
echo "$RESP" | jq -e '.step_timing | if length > 0 then (.[0].node | type == "string") else true end' \
  || { echo "FAIL: step_timing[0].node 不是 string"; exit 1; }
echo "$RESP" | jq -e '.step_timing | if length > 0 then (.[0].started_at | type == "string") else true end' \
  || { echo "FAIL: step_timing[0].started_at 不是 string"; exit 1; }
echo "✅ Step 7: step_timing 元素结构验证通过"
```

**硬阈值**: 有元素时 `.[0] | keys == ["duration_ms","ended_at","node","started_at"]`，node/started_at 为 string

---

## Risks（Round 2 新增 — 响应 Reviewer risk_registered=2）

以下三条风险直接对应 PRD ASSUMPTION 段，均为真实失败路径：

### Risk 1: initiative_contracts 表缺列导致路由 500

**ASSUMPTION 来源**: PRD `[ASSUMPTION: initiative_contracts 表含 prd_content / contract_content 列（与 /dag 端点相同查法）]`

**风险描述**: 若 `initiative_contracts` 表不存在 `prd_content` 或 `contract_content` 列，SQL 查询抛 `column does not exist` 错误，路由未加 try-catch 则泄漏 500。

**缓解**:
1. Generator 实现路由时必须包含 try-catch，SQL 异常时 prd_content/contract_content 降级为 null，不抛 500
2. BEHAVIOR #7（HTTP ≠ 500）覆盖此路径
3. E2E 第 4 步验证 `CODE != "500"`；Step 3 验证 prd_content 接受 null（无列时不崩溃）

---

### Risk 2: cecelia_events payload 结构不符导致 step_timing 元素字段泄漏 null

**ASSUMPTION 来源**: PRD `[ASSUMPTION: cecelia_events 表含 task_id::uuid + event_type='langgraph_step' + payload（含 node/started_at/ended_at）]`

**风险描述**: 若 `cecelia_events` 中存储的 payload JSON 结构变化（如键名改为 `step_name` 而非 `node`），step_timing 元素将含 `undefined`/`null` 字段，但端点仍返回 200，Generator 无感知漂移。

**缓解**:
1. Generator 必须用 `COALESCE(payload->>'node', '')` 安全提取，且文档注明字段名
2. BEHAVIOR #8（step_timing 元素结构）覆盖此漂移：当数组非空时 jq 验证 `keys == ["duration_ms","ended_at","node","started_at"]`
3. E2E Step 7 在有真实数据时执行同样 jq oracle

---

### Risk 3: harness.js 挂载前缀不在 /api/brain/harness/ 导致端点 404

**ASSUMPTION 来源**: PRD `[ASSUMPTION: harness.js router 已挂载在 /api/brain/harness/ 前缀下，新路由加在同文件即可]`

**风险描述**: 若 `server.js` 中 harness router 实际挂载路径为 `/api/brain/` 或其他，Generator 在 `harness.js` 内加 `/initiative/:id/detail` 后，实际访问路径将不同，所有 curl 验证命令（访问 `localhost:5221/api/brain/harness/initiative/:id/detail`）将返回 404。

**缓解**:
1. Generator 实现前必须核查 `packages/brain/src/server.js` 中 `app.use('/api/brain/harness', harnessRouter)` 的挂载路径
2. Step 1 验证命令验证端点非 404；若仍 404 则 FAIL，强制 Generator 修正挂载路径或合同路径
3. ARTIFACT 条目要求路由定义字符串 `/initiative/:id/detail` 必须出现在 harness.js

---

## E2E 验收（final-e2e — target_environment = local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -e

DB="${DB_URL:-postgresql://localhost/cecelia}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
TEST_ID="00000000-0000-0000-0000-000000000001"

# 1. 验证 Brain 健康
curl -sf "$BRAIN_URL/api/brain/health" | jq -e '.ok == true or .status == "ok"' || { echo "FAIL: Brain 服务不健康"; exit 1; }

# 2. 非法 UUID → 400
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BRAIN_URL/api/brain/harness/initiative/not-a-uuid/detail")
[ "$CODE" = "400" ] || { echo "FAIL: 期望 400, 得到 $CODE"; exit 1; }
RESP400=$(curl -s "$BRAIN_URL/api/brain/harness/initiative/not-a-uuid/detail")
echo "$RESP400" | jq -e '.error == "invalid id"' || { echo "FAIL: error 字段不匹配"; exit 1; }

# 3. 合法 UUID（无数据）→ 200 + nulls + 空数组（宽容降级）
RESP=$(curl -sf "$BRAIN_URL/api/brain/harness/initiative/${TEST_ID}/detail") || { echo "FAIL: 端点返回非 200"; exit 1; }

# 4. Schema 完整性
echo "$RESP" | jq -e 'keys == ["contract_content","gan_rounds","initiative_id","prd_content","screenshot_urls","step_timing"]' || { echo "FAIL: keys 不匹配"; exit 1; }
echo "$RESP" | jq -e ".initiative_id == \"${TEST_ID}\"" || { echo "FAIL: initiative_id 不回显"; exit 1; }
echo "$RESP" | jq -e '.screenshot_urls == []' || { echo "FAIL: screenshot_urls 应为 []"; exit 1; }
echo "$RESP" | jq -e '.step_timing | type == "array"' || { echo "FAIL: step_timing 不是数组"; exit 1; }
echo "$RESP" | jq -e '.prd_content == null or (.prd_content | type == "string")' || { echo "FAIL: prd_content 类型不符"; exit 1; }
echo "$RESP" | jq -e '.contract_content == null or (.contract_content | type == "string")' || { echo "FAIL: contract_content 类型不符"; exit 1; }
echo "$RESP" | jq -e '.gan_rounds == null or (.gan_rounds | type == "number")' || { echo "FAIL: gan_rounds 类型不符"; exit 1; }

# 5. 全部 7 个禁用字段检查（DoD SSOT — steps/stages/tasks/contract/runs/data/payload）
echo "$RESP" | jq -e 'has("steps") | not'    || { echo "FAIL: 禁用字段 steps"; exit 1; }
echo "$RESP" | jq -e 'has("stages") | not'   || { echo "FAIL: 禁用字段 stages"; exit 1; }
echo "$RESP" | jq -e 'has("tasks") | not'    || { echo "FAIL: 禁用字段 tasks"; exit 1; }
echo "$RESP" | jq -e 'has("contract") | not' || { echo "FAIL: 禁用字段 contract"; exit 1; }
echo "$RESP" | jq -e 'has("runs") | not'     || { echo "FAIL: 禁用字段 runs"; exit 1; }
echo "$RESP" | jq -e 'has("data") | not'     || { echo "FAIL: 禁用字段 data"; exit 1; }
echo "$RESP" | jq -e 'has("payload") | not'  || { echo "FAIL: 禁用字段 payload"; exit 1; }

# 6. 若 DB 中有真实已完成数据，验证深层字段 + step_timing 元素结构
REAL_ID=$(psql "$DB" -t -c "SELECT id::text FROM tasks WHERE task_type='harness_initiative' AND status='completed' ORDER BY completed_at DESC LIMIT 1" 2>/dev/null | tr -d ' ')
if [ -n "$REAL_ID" ] && [ "$REAL_ID" != "" ]; then
  REAL_RESP=$(curl -sf "$BRAIN_URL/api/brain/harness/initiative/${REAL_ID}/detail") || { echo "FAIL: 真实 initiative 返回非 200"; exit 1; }
  echo "$REAL_RESP" | jq -e '.initiative_id | type == "string"' || { echo "FAIL: 真实数据 initiative_id 不是 string"; exit 1; }

  # step_timing 元素结构验证（Risk 2 缓解 — 当有真实事件时验证 schema 不漂移）
  TIMING_LEN=$(echo "$REAL_RESP" | jq '.step_timing | length')
  if [ "$TIMING_LEN" -gt 0 ]; then
    echo "$REAL_RESP" | jq -e '.step_timing[0] | keys == ["duration_ms","ended_at","node","started_at"]' \
      || { echo "FAIL: step_timing 元素 keys 不符 {node,started_at,ended_at,duration_ms}"; exit 1; }
    echo "$REAL_RESP" | jq -e '.step_timing[0].node | type == "string"' \
      || { echo "FAIL: step_timing[0].node 不是 string"; exit 1; }
    echo "$REAL_RESP" | jq -e '.step_timing[0].started_at | type == "string"' \
      || { echo "FAIL: step_timing[0].started_at 不是 string"; exit 1; }
    echo "$REAL_RESP" | jq -e '.step_timing[0].duration_ms == null or (.step_timing[0].duration_ms | type == "number")' \
      || { echo "FAIL: step_timing[0].duration_ms 类型不符"; exit 1; }
    echo "✅ 真实 step_timing 元素结构验证通过 (count=$TIMING_LEN)"
  fi

  echo "✅ 真实 initiative 数据验证通过"
fi

echo "✅ Golden Path 全程验证通过"
```

---

## Workstreams

workstream_count: 1

### Workstream 1: GET /initiative/:id/detail 路由实现

**范围**: 在 `packages/brain/src/routes/harness.js` 新增端点，约 60-80 行净增，UUID 验证 → initiative_contracts 查询 → cecelia_events 重建 → 宽容 200 降级
**大小**: S（< 100 行）
**依赖**: 无（单 workstream，initiative_contracts/cecelia_events 表已存在）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/harness-detail.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/harness-detail.test.ts` | HTTP 200 / UUID 校验 / schema 完整性 / 7 个禁用字段 / 类型检查 / initiative_id 回显 / screenshot_urls / step_timing 元素结构 | 端点不存在 → 404 → 10+ failures |
