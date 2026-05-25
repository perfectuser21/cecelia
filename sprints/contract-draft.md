# Sprint Contract Draft (Round 2)

## Golden Path
[用户点击 initiative 卡片] → [前端 GET /api/brain/harness/initiative/:id/detail] → [Brain 查询任务表+读取 sprint 文件] → [返回 JSON 含完整 schema] → [侧栏成功渲染]

---

### Step 1: GET /initiative/:id/detail 路由注册并返回 200 + 正确 schema
**来源**: `[FROM_PRD]` — PRD "Golden Path 具体步骤 2-3" 直接定义：前端发 `GET /api/brain/harness/initiative/{id}/detail`，Brain 查询 tasks 表并返回聚合 JSON

**可观测行为**: 对存在的 `harness_initiative` 任务 ID 请求该端点，返回 HTTP 200，响应含六个顶层字段 `initiative_id`、`prd_content`、`contract_content`、`gan_rounds`、`step_timing`、`screenshot_urls`

**验证命令**:
```bash
DB="${DB:-postgresql://localhost/cecelia}"
TEST_ID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('harness_initiative', 'queued', 'contract-draft-step1', '{\"sprint_dir\":\"sprints\"}') RETURNING id" | tr -d ' \n')
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${TEST_ID}/detail") || { echo "FAIL: 端点未返回 200（路由未注册）"; exit 1; }
echo "$RESP" | jq -e --arg id "$TEST_ID" '.initiative_id == $id' || { echo "FAIL: initiative_id 不等于请求路径 :id"; exit 1; }
echo OK
```

**硬阈值**: HTTP 200；`initiative_id` 字段等于请求路径 `:id`

---

### Step 2: sprint 文件读取 — 文件存在时返回内容，不存在时返回 null（不报 5xx）
**来源**: `[FROM_PRD]` — PRD "Golden Path 具体步骤 3" 定义：Brain 读取 `{sprint_dir}/sprint-prd.md` 和 `{sprint_dir}/sprint-contract.md`；PRD 边界情况：sprint 文件不存在时对应字段返回 null，不报 5xx

**可观测行为**: `sprint_dir` 指向不存在目录时 `prd_content` 和 `contract_content` 均为 null，HTTP 仍为 200

**验证命令**:
```bash
DB="${DB:-postgresql://localhost/cecelia}"
NO_FILES_ID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('harness_initiative', 'queued', 'contract-test-no-files', '{\"sprint_dir\":\"sprints/nonexistent-test-xyz\"}') RETURNING id" | tr -d ' \n')
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${NO_FILES_ID}/detail") || { echo "FAIL: 文件不存在时应返回 200 而非 5xx"; exit 1; }
echo "$RESP" | jq -e '.prd_content == null' || { echo "FAIL: 文件不存在时 prd_content 应为 null"; exit 1; }
echo "$RESP" | jq -e '.contract_content == null' || { echo "FAIL: 文件不存在时 contract_content 应为 null"; exit 1; }
echo OK
```

**硬阈值**: 文件不存在时 HTTP 200；`prd_content == null`；`contract_content == null`

---

### Step 3: step_timing 从子任务聚合 — 类型为 array，元素含 node/started_at/ended_at/duration_ms
**来源**: `[FROM_PRD]` — PRD Response Schema 定义 `step_timing` 为 array，元素结构含 `node`（string）、`started_at`（ISO8601|null）、`ended_at`（ISO8601|null）、`duration_ms`（number|null）；无子任务时为 `[]`

**可观测行为**: `step_timing` 字段始终为 JSON array；有子任务时各元素包含 node/started_at/ended_at/duration_ms 四个字段

**验证命令**:
```bash
DB="${DB:-postgresql://localhost/cecelia}"
# 创建 initiative + 关联子任务
TIMING_TEST_ID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('harness_initiative', 'queued', 'contract-step-timing', '{\"sprint_dir\":\"sprints/nonexistent-xyz\"}') RETURNING id" | tr -d ' \n')
psql "$DB" -c "INSERT INTO tasks (task_type, status, title, payload, started_at, completed_at) VALUES ('harness_contract_propose', 'completed', 'contract-step-timing-sub', json_build_object('initiative_id', '${TIMING_TEST_ID}', 'sprint_dir', 'sprints/nonexistent-xyz'), NOW() - interval '5 minutes', NOW() - interval '2 minutes')" > /dev/null
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${TIMING_TEST_ID}/detail") || { echo "FAIL"; exit 1; }
echo "$RESP" | jq -e '.step_timing | type == "array"' || { echo "FAIL: step_timing 不是数组"; exit 1; }
# 验证子任务被收录 + 元素结构
COUNT=$(echo "$RESP" | jq '.step_timing | length')
[ "$COUNT" -ge 1 ] || { echo "FAIL: step_timing 应有 ≥1 元素（已插入 harness_contract_propose 子任务）"; exit 1; }
echo "$RESP" | jq -e '.step_timing[0].node | type == "string"' || { echo "FAIL: step_timing[0].node 不是字符串"; exit 1; }
echo "$RESP" | jq -e '.step_timing[0] | has("started_at")' || { echo "FAIL: step_timing[0] 缺少 started_at 字段"; exit 1; }
echo "$RESP" | jq -e '.step_timing[0] | has("ended_at")' || { echo "FAIL: step_timing[0] 缺少 ended_at 字段"; exit 1; }
echo "$RESP" | jq -e '.step_timing[0] | has("duration_ms")' || { echo "FAIL: step_timing[0] 缺少 duration_ms 字段"; exit 1; }
echo OK
```

**硬阈值**: `step_timing | type == "array"`；有子任务时 `length ≥ 1`；每元素含 node/started_at/ended_at/duration_ms

---

### Step 4: 不存在 initiative ID 或 task_type != 'harness_initiative' → 404 + error 字段
**来源**: `[FROM_PRD]` — PRD 边界情况明确：initiative id 不存在或 task_type != 'harness_initiative' → 404

**可观测行为**: 使用不存在 UUID 请求时返回 HTTP 404，响应含 `error` 字段精确等于 `"initiative not found"`（区别于 Brain 全局 404 的 `"Not Found"`）

**验证命令**:
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000000/detail")
[ "$CODE" = "404" ] || { echo "FAIL: 不存在 ID 应返回 404，实际 $CODE"; exit 1; }
RESP=$(curl -s "localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000000/detail")
echo "$RESP" | jq -e '.error == "initiative not found"' || { echo "FAIL: error 应为 'initiative not found'（Brain 全局 404 返回 'Not Found' 不通过）"; exit 1; }
echo OK
```

**硬阈值**: HTTP 404；`error` 字段精确等于 `"initiative not found"`（区别于 Brain 全局 404 的 `"Not Found"`）

---

### Step 5: schema 完整性 — 顶层 keys 精确匹配，全部 7 个禁用字段名不存在
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：PRD 明确定义 7 个禁用字段名（`prd`/`contract`/`timeline`/`screenshots`/`stages`/`details`/`data`），精确 keys 断言防止 generator 漂移到禁用字段名（实证 Bug 8 W25）

**可观测行为**: 响应顶层 keys 精确等于 `["contract_content","gan_rounds","initiative_id","prd_content","screenshot_urls","step_timing"]`，全部 7 个禁用字段均不出现

**验证命令**:
```bash
DB="${DB:-postgresql://localhost/cecelia}"
SCHEMA_TEST_ID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('harness_initiative', 'queued', 'contract-schema-test', '{\"sprint_dir\":\"sprints/nonexistent-xyz\"}') RETURNING id" | tr -d ' \n')
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${SCHEMA_TEST_ID}/detail") || { echo "FAIL"; exit 1; }
echo "$RESP" | jq -e 'keys == ["contract_content","gan_rounds","initiative_id","prd_content","screenshot_urls","step_timing"]' || { echo "FAIL: keys 不完整或含多余字段"; exit 1; }
echo "$RESP" | jq -e 'has("prd") | not' || { echo "FAIL: 含禁用字段 prd"; exit 1; }
echo "$RESP" | jq -e 'has("contract") | not' || { echo "FAIL: 含禁用字段 contract"; exit 1; }
echo "$RESP" | jq -e 'has("timeline") | not' || { echo "FAIL: 含禁用字段 timeline"; exit 1; }
echo "$RESP" | jq -e 'has("screenshots") | not' || { echo "FAIL: 含禁用字段 screenshots"; exit 1; }
echo "$RESP" | jq -e 'has("stages") | not' || { echo "FAIL: 含禁用字段 stages"; exit 1; }
echo "$RESP" | jq -e 'has("details") | not' || { echo "FAIL: 含禁用字段 details"; exit 1; }
echo "$RESP" | jq -e 'has("data") | not' || { echo "FAIL: 含禁用字段 data"; exit 1; }
echo OK
```

**硬阈值**: keys 精确等于期望集合；全部 7 个禁用字段均不存在

---

### Step 6: screenshot_urls 始终为 array（无数据时为 []，不为 null）
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：PRD 明确 screenshot_urls 无数据时为 `[]` 而非 null，防止 generator 返回 null 导致前端 `.map()` 报错

**可观测行为**: `screenshot_urls` 字段类型始终为 JSON array，无截图时为空数组 `[]`

**验证命令**:
```bash
DB="${DB:-postgresql://localhost/cecelia}"
SS_TEST_ID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('harness_initiative', 'queued', 'contract-ss-test', '{\"sprint_dir\":\"sprints/nonexistent-xyz\"}') RETURNING id" | tr -d ' \n')
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${SS_TEST_ID}/detail") || { echo "FAIL"; exit 1; }
echo "$RESP" | jq -e '.screenshot_urls | type == "array"' || { echo "FAIL: screenshot_urls 不是数组"; exit 1; }
echo OK
```

**硬阈值**: `screenshot_urls | type == "array"`

---

### Step 7: gan_rounds 类型 — 必须为 number 或 null（不可为 string 或 undefined）
**来源**: `[FROM_PRD]` — PRD Response Schema 定义 `gan_rounds (number|null, 必填)`: GAN 对抗轮次计数；无数据时为 null

**可观测行为**: `gan_rounds` 字段在无 GAN 子任务时为 null，有 propose 子任务时为 number，不可为 string 类型

**验证命令**:
```bash
DB="${DB:-postgresql://localhost/cecelia}"
GR_TEST_ID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('harness_initiative', 'queued', 'contract-ganrounds-test', '{\"sprint_dir\":\"sprints/nonexistent-xyz\"}') RETURNING id" | tr -d ' \n')
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${GR_TEST_ID}/detail") || { echo "FAIL"; exit 1; }
echo "$RESP" | jq -e '.gan_rounds == null or (.gan_rounds | type == "number")' || { echo "FAIL: gan_rounds 必须为 null 或 number 类型"; exit 1; }
echo "$RESP" | jq -e '(.gan_rounds | type) != "string"' || { echo "FAIL: gan_rounds 不能是字符串"; exit 1; }
echo OK
```

**硬阈值**: `gan_rounds` 类型为 null 或 number，禁止字符串类型

---

## Risks

### Risk 1: 数据库连接失败导致 BEHAVIOR 验证误判
**风险描述**: Brain 服务未启动或 PostgreSQL 不可达时，`psql` / `curl localhost:5221` 命令均失败，BEHAVIOR 验证报 FAIL 但并非实现问题。

**Mitigation**:
- evaluator 执行 BEHAVIOR 前先检查 `curl -sf localhost:5221/api/brain/health | jq -e '.ok'`；失败则标记 SKIP（非 FAIL），不计入 BEHAVIOR pass rate
- 所有 psql 命令配 `|| { echo "FAIL: DB 不可达"; exit 1; }` 使错误消息清晰可辨

---

### Risk 2: 测试 INSERT 在 tasks 表留下残留行
**风险描述**: BEHAVIOR 测试每次执行都向 `tasks` 表 INSERT 行（title 如 `contract-test-no-files`、`dod-behavior*`），每次 evaluator 跑一遍留一批残留，影响 Brain tick 拾取（task_type=harness_initiative 满足 tick 条件可能被错误调度）。

**Mitigation**:
- 所有测试插入行使用统一前缀 `contract-test-*` 或 `dod-behavior*`，status 为 `queued`（可被 Brain tick 拾取）
- 建议 evaluator 后置清理：`psql $DB -c "UPDATE tasks SET status='cancelled' WHERE title LIKE 'contract-test-%' OR title LIKE 'dod-behavior%'"`
- 或在 INSERT 时直接设 `status='cancelled'`（此状态 Brain tick 不拾取），避免误调度

---

## E2E 验收（最终 final-e2e 跑 — target_environment = local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -e

DB="${DB:-postgresql://localhost/cecelia}"

echo "[e2e] Step 1: 创建测试 initiative 任务（sprint_dir=sprints，文件存在）"
TEST_ID=$(psql "$DB" -t -c "
  INSERT INTO tasks (task_type, status, title, payload)
  VALUES ('harness_initiative', 'queued', 'e2e-detail-golden-path', '{\"sprint_dir\":\"sprints\"}')
  RETURNING id
" | tr -d ' \n')
echo "[e2e] 测试 initiative ID: $TEST_ID"

echo "[e2e] Step 2: 调用 detail 端点"
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${TEST_ID}/detail") || {
  echo "FAIL: 端点未返回 200"
  exit 1
}

echo "[e2e] Step 3: 验证 initiative_id == 请求路径 :id"
echo "$RESP" | jq -e --arg id "$TEST_ID" '.initiative_id == $id' || {
  echo "FAIL: initiative_id 不匹配"
  exit 1
}

echo "[e2e] Step 4: 验证 keys 完整性"
echo "$RESP" | jq -e 'keys == ["contract_content","gan_rounds","initiative_id","prd_content","screenshot_urls","step_timing"]' || {
  echo "FAIL: schema keys 不完整或含多余字段"
  exit 1
}

echo "[e2e] Step 5: 验证 prd_content（sprints/sprint-prd.md 存在，应为 string）"
echo "$RESP" | jq -e '.prd_content | type == "string"' || {
  echo "FAIL: prd_content 应为字符串（sprints/sprint-prd.md 存在）"
  exit 1
}

echo "[e2e] Step 6: 验证 step_timing 为 array"
echo "$RESP" | jq -e '.step_timing | type == "array"' || {
  echo "FAIL: step_timing 应为数组"
  exit 1
}

echo "[e2e] Step 7: 验证 screenshot_urls 为 array"
echo "$RESP" | jq -e '.screenshot_urls | type == "array"' || {
  echo "FAIL: screenshot_urls 应为数组"
  exit 1
}

echo "[e2e] Step 8: 验证全部 7 个禁用字段不存在"
echo "$RESP" | jq -e 'has("prd") | not' || { echo "FAIL: 含禁用字段 prd"; exit 1; }
echo "$RESP" | jq -e 'has("contract") | not' || { echo "FAIL: 含禁用字段 contract"; exit 1; }
echo "$RESP" | jq -e 'has("timeline") | not' || { echo "FAIL: 含禁用字段 timeline"; exit 1; }
echo "$RESP" | jq -e 'has("screenshots") | not' || { echo "FAIL: 含禁用字段 screenshots"; exit 1; }
echo "$RESP" | jq -e 'has("stages") | not' || { echo "FAIL: 含禁用字段 stages"; exit 1; }
echo "$RESP" | jq -e 'has("details") | not' || { echo "FAIL: 含禁用字段 details"; exit 1; }
echo "$RESP" | jq -e 'has("data") | not' || { echo "FAIL: 含禁用字段 data"; exit 1; }

echo "[e2e] Step 9: 验证 gan_rounds 类型为 null 或 number"
echo "$RESP" | jq -e '.gan_rounds == null or (.gan_rounds | type == "number")' || {
  echo "FAIL: gan_rounds 必须为 null 或 number"
  exit 1
}

echo "[e2e] Step 10: 验证文件不存在时 prd_content 和 contract_content == null（不报 5xx）"
NO_FILES_ID=$(psql "$DB" -t -c "
  INSERT INTO tasks (task_type, status, title, payload)
  VALUES ('harness_initiative', 'queued', 'e2e-no-files-test', '{\"sprint_dir\":\"sprints/nonexistent-e2e-xyz\"}')
  RETURNING id
" | tr -d ' \n')
RESP2=$(curl -sf "localhost:5221/api/brain/harness/initiative/${NO_FILES_ID}/detail") || {
  echo "FAIL: 文件不存在时应返回 200 而非 5xx"
  exit 1
}
echo "$RESP2" | jq -e '.prd_content == null' || {
  echo "FAIL: 文件不存在时 prd_content 应为 null"
  exit 1
}
echo "$RESP2" | jq -e '.contract_content == null' || {
  echo "FAIL: 文件不存在时 contract_content 应为 null"
  exit 1
}

echo "[e2e] Step 11: 验证 step_timing 元素结构（插入 harness 子任务后验证字段）"
STRUCT_TEST_ID=$(psql "$DB" -t -c "
  INSERT INTO tasks (task_type, status, title, payload)
  VALUES ('harness_initiative', 'queued', 'e2e-step-timing-struct', '{\"sprint_dir\":\"sprints/nonexistent-xyz\"}')
  RETURNING id
" | tr -d ' \n')
psql "$DB" -c "INSERT INTO tasks (task_type, status, title, payload, started_at, completed_at) VALUES ('harness_contract_propose', 'completed', 'e2e-sub-task', json_build_object('initiative_id', '${STRUCT_TEST_ID}', 'sprint_dir', 'sprints/nonexistent-xyz'), NOW() - interval '5 minutes', NOW() - interval '2 minutes')" > /dev/null
RESP3=$(curl -sf "localhost:5221/api/brain/harness/initiative/${STRUCT_TEST_ID}/detail") || {
  echo "FAIL: 创建有子任务的 initiative 请求失败"
  exit 1
}
COUNT=$(echo "$RESP3" | jq '.step_timing | length')
[ "$COUNT" -ge 1 ] || {
  echo "FAIL: step_timing 应有 ≥1 元素（已插入关联子任务）"
  exit 1
}
echo "$RESP3" | jq -e '.step_timing[0].node | type == "string"' || { echo "FAIL: step_timing[0].node 非字符串"; exit 1; }
echo "$RESP3" | jq -e '.step_timing[0] | has("started_at")' || { echo "FAIL: step_timing[0] 缺 started_at"; exit 1; }
echo "$RESP3" | jq -e '.step_timing[0] | has("ended_at")' || { echo "FAIL: step_timing[0] 缺 ended_at"; exit 1; }
echo "$RESP3" | jq -e '.step_timing[0] | has("duration_ms")' || { echo "FAIL: step_timing[0] 缺 duration_ms"; exit 1; }

echo "[e2e] Step 12: 验证不存在 ID → 404 + error = 'initiative not found'"
NOT_FOUND_CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000000/detail")
[ "$NOT_FOUND_CODE" = "404" ] || {
  echo "FAIL: 不存在 ID 应返回 404，实际 $NOT_FOUND_CODE"
  exit 1
}
NOT_FOUND_RESP=$(curl -s "localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000000/detail")
echo "$NOT_FOUND_RESP" | jq -e '.error == "initiative not found"' || {
  echo "FAIL: error 应为 'initiative not found'（Brain 全局 404 返回 'Not Found' 不通过）"
  exit 1
}

echo "✅ Golden Path E2E 验证通过"
```

---

## Workstreams

workstream_count: 1

### Workstream 1: 实现 GET /initiative/:id/detail 路由

**范围**: 在 `packages/brain/src/routes/harness.js` 中新增 `GET /initiative/:id/detail` 路由处理函数（只读端点），查询 tasks 表、读取 sprint 文件、聚合 step_timing（含元素结构），返回 PRD 定义的完整 schema
**大小**: S（< 100 行净增）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/initiative-detail.test.ts`

---

## Workstreams 切分规则自查

- ws_count=1：合同净增 < 200 行（~80 行路由处理函数 + ~90 行测试 = ~170 行），符合单 WS 条件 ✓

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/initiative-detail.test.ts` | 路由注册、schema 字段、keys 完整性、7个禁用字段、error path、null 处理、gan_rounds 类型、step_timing 元素结构 | 8 failures（路由不存在） |
