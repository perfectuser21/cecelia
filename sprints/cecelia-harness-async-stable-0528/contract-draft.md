# Sprint Contract Draft (Round 2)

## Golden Path
[Brain tick 触发 harness_initiative] → [Planner detached spawn + interrupt] → [GAN 每轮 detached spawn + interrupt] → [Patrol 检测卡住 → harness_intervention 任务] → [Intervention handler 分析 + 行动] → [消息 API 双向通信] → [graph 结束 → thread_lookup.status 更新]

---

### Step 1: Brain tick 触发 harness_initiative，Planner 节点以 detached 模式启动
**来源**: `[FROM_PRD]` — PRD WS1 Golden Path 段：「Brain tick 触发 harness_initiative → Planner 节点以 detached 模式启动」

**可观测行为**: `spawnDockerDetached` 被 `runPlannerNode` 调用（而非阻塞的 `reconnectOrSpawn`）；`walking_skeleton_thread_lookup` 插入一条 status='spawning' 记录；函数随即调用 `interrupt()` 挂起 graph。Brain tick 继续执行其他任务，不等 Planner 容器结束。

**验证命令**:
```bash
# 代码结构：harness-initiative.graph.js 的 runPlannerNode 调用 spawnDockerDetached
grep -q "spawnDockerDetached" packages/brain/src/workflows/harness-initiative.graph.js || { echo "FAIL: runPlannerNode 未用 spawnDockerDetached"; exit 1; }
echo "OK: spawnDockerDetached 存在于 harness-initiative.graph.js"
```

**硬阈值**: grep exit 0；FAIL 表示 WS2 未实现

---

### Step 2: Planner 节点 interrupt()，Brain tick 继续（非阻塞验证）
**来源**: `[FROM_PRD]` — PRD WS1 Golden Path 段：「interrupt() 挂起 graph → Brain tick 继续处理其他任务」

**可观测行为**: `runPlannerNode` 函数体内不再有 `await reconnectOrSpawn`（同步阻塞已移除），改为 `interrupt()` yield。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');
const start = c.indexOf('export async function runPlannerNode');
if (start < 0) { console.error('FAIL: runPlannerNode not found'); process.exit(1); }
const end = c.indexOf('\nexport ', start + 1);
const fn = c.slice(start, end > 0 ? end : start + 4000);
if (fn.includes('reconnectOrSpawn')) { console.error('FAIL: runPlannerNode 仍含阻塞 reconnectOrSpawn'); process.exit(1); }
if (!fn.includes('interrupt')) { console.error('FAIL: runPlannerNode 缺少 interrupt()'); process.exit(1); }
console.log('OK: runPlannerNode async 化验证通过');
" || exit 1
```

**硬阈值**: exit 0

---

### Step 3: Planner callback 到来 → graph resume → 进入 GAN 阶段
**来源**: `[FROM_PRD]` — PRD WS1 Golden Path 段：「Planner callback 到来 → graph resume → 进入 GAN 阶段」

**可观测行为**: harness-initiative graph 在 await_callback 节点等待 POST /api/brain/harness/callback/:containerId；callback 到来后 graph 从 interrupt 恢复执行 GAN 循环入口。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');
if (!c.includes('walking_skeleton_thread_lookup') && !c.includes('harness-thread-lookup')) {
  console.error('FAIL: harness-initiative.graph.js 未写 thread_lookup'); process.exit(1);
}
console.log('OK: thread_lookup 写入逻辑存在');
" || exit 1
```

**硬阈值**: exit 0

---

### Step 4: GAN 每轮 Proposer 以 detached 模式启动
**来源**: `[FROM_PRD]` — PRD WS2 Golden Path 段：「GAN 循环每轮 Proposer/Reviewer → detached 模式启动 → interrupt() 挂起」

**可观测行为**: `harness-gan.graph.js` 的 `proposer` 函数使用 `spawnDockerDetached` 而非阻塞的 `reconnectOrSpawn`。

**验证命令**:
```bash
grep -q "spawnDockerDetached" packages/brain/src/workflows/harness-gan.graph.js || { echo "FAIL: harness-gan.graph.js 未用 spawnDockerDetached"; exit 1; }
echo "OK: harness-gan.graph.js 含 spawnDockerDetached"
```

**硬阈值**: exit 0

---

### Step 5: GAN Reviewer detached spawn → interrupt → 收敛或下一轮
**来源**: `[FROM_PRD]` — PRD WS2 Golden Path 段：「callback 到来 → resume → 继续下一轮直至 approved 或轮数上限」

**可观测行为**: `harness-gan.graph.js` 的 `proposer` 和 `reviewer` 函数均移除阻塞 `reconnectOrSpawn`，改为 detached + interrupt 模式。GAN 收敛逻辑（轮数上限判断/detectConvergenceTrend）不变。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('packages/brain/src/workflows/harness-gan.graph.js','utf8');
const pStart = c.indexOf('async function proposer(');
const pEnd = c.indexOf('\n  async function ', pStart + 1);
const pFn = c.slice(pStart, pEnd > 0 ? pEnd : pStart + 3000);
if (pFn.includes('reconnectOrSpawn')) { console.error('FAIL: proposer 仍含阻塞 reconnectOrSpawn'); process.exit(1); }
const rStart = c.indexOf('async function reviewer(');
const rEnd = c.indexOf('\n  async function ', rStart + 1);
const rFn = c.slice(rStart, rEnd > 0 ? rEnd : rStart + 3000);
if (rFn.includes('reconnectOrSpawn')) { console.error('FAIL: reviewer 仍含阻塞 reconnectOrSpawn'); process.exit(1); }
console.log('OK: proposer + reviewer 均已 async 化');
" || exit 1
```

**硬阈值**: exit 0

---

### Step 6: Patrol 扫描卡住的 initiative_runs，创建 harness_intervention 任务
**来源**: `[FROM_PRD]` — PRD WS3 Golden Path 段：「Brain tick → Patrol 扫描 initiative_runs（completed_at IS NULL）→ 检测卡住阈值（Planner>15min, GAN>20min）→ 创建 harness_intervention 任务」

**可观测行为**: 新文件 `packages/brain/src/harness-initiative-patrol.js` 存在，包含对 `initiative_runs` 的扫描查询和 `harness_intervention` 任务创建逻辑（防重：同 initiative 已有 pending intervention 则跳过）。

**验证命令**:
```bash
node -e "require('fs').accessSync('packages/brain/src/harness-initiative-patrol.js')" || { echo "FAIL: harness-initiative-patrol.js 不存在"; exit 1; }
node -e "
const c = require('fs').readFileSync('packages/brain/src/harness-initiative-patrol.js','utf8');
if (!c.includes('initiative_runs')) { console.error('FAIL: 缺少 initiative_runs 查询'); process.exit(1); }
if (!c.includes('harness_intervention')) { console.error('FAIL: 缺少 harness_intervention 任务创建'); process.exit(1); }
if (!c.includes('15') || !c.includes('20')) { console.error('FAIL: 缺少卡住阈值(15/20 min)'); process.exit(1); }
console.log('OK: patrol 逻辑存在');
" || exit 1
```

**硬阈值**: exit 0

---

### Step 7: Intervention Handler 读 Docker logs，LLM 分析，返回 retry/skip/alert
**来源**: `[FROM_PRD]` — PRD WS3 Golden Path 段：「handler 读 Docker logs → LLM 分析 → retry/skip/告警」

**可观测行为**: `harness-intervention-handler.js` 存在；`task-router.js` 的 ACTION_WHITELIST 含 `harness_intervention` → `harness-intervention-handler.js`；handler 执行后 task result 包含 `action` 字段（retry/skip/alert）。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('packages/brain/src/harness-intervention-handler.js','utf8');
if (!c.includes('action')) { console.error('FAIL: handler 缺少 action 字段'); process.exit(1); }
if (!c.includes('docker') && !c.includes('logs')) { console.error('FAIL: handler 缺少 docker logs 读取逻辑'); process.exit(1); }
console.log('OK: intervention handler 逻辑存在');
" || exit 1
node -e "
const c = require('fs').readFileSync('packages/brain/src/task-router.js','utf8');
if (!c.includes('harness-intervention-handler')) { console.error('FAIL: task-router 未注册 harness-intervention-handler'); process.exit(1); }
console.log('OK: task-router 含 harness-intervention-handler 路由');
" || exit 1
```

**硬阈值**: exit 0

---

### Step 8: 容器通过 GET /messages 拉取消息（顶层 schema + 消息对象四字段）
**来源**: `[FROM_PRD]` — PRD WS4 Golden Path 段 + Response Schema: GET /api/brain/harness/messages/:initiativeId/:subTaskId

**可观测行为**: Brain API 返回 200 + `{"messages": [...]}` （空时返 `[]`）；顶层 key 严格为 `messages`，禁用 `data`/`items`/`results`/`payload`/`list`；messages 数组内每条消息含 id(uuid)/message(string)/created_at(iso8601)/consumed_at(null or iso8601) 四字段。

**验证命令**:
```bash
# 8a. 顶层 schema + 禁用字段（不存在的 initiativeId → 200 + {messages:[]}）
TEST_INIT_ID="00000000-0000-0000-0000-000000000001"
RESP=$(curl -sf "localhost:5221/api/brain/harness/messages/$TEST_INIT_ID/planner") || { echo "FAIL: GET messages 端点未返回 200"; exit 1; }
echo "$RESP" | jq -e '.messages | type == "array"' || { echo "FAIL: 缺 messages 数组字段"; exit 1; }
echo "$RESP" | jq -e 'keys == ["messages"]' || { echo "FAIL: 顶层 keys 不符合 [\"messages\"]"; exit 1; }
echo "$RESP" | jq -e 'has("data") | not' || { echo "FAIL: 含禁用字段 data"; exit 1; }
echo "$RESP" | jq -e 'has("items") | not' || { echo "FAIL: 含禁用字段 items"; exit 1; }
echo "$RESP" | jq -e 'has("results") | not' || { echo "FAIL: 含禁用字段 results"; exit 1; }
echo "$RESP" | jq -e 'has("payload") | not' || { echo "FAIL: 含禁用字段 payload"; exit 1; }
echo "$RESP" | jq -e 'has("list") | not' || { echo "FAIL: 含禁用字段 list"; exit 1; }

# 8b. 消息对象四字段校验（先 POST 一条消息，再 GET 验证字段）
TEST_INIT_ID2="00000000-0000-0000-0000-000000000008"
curl -sf -X POST \
  -H "Content-Type: application/json" \
  -d '{"message":"field-schema-check"}' \
  "localhost:5221/api/brain/harness/messages/$TEST_INIT_ID2/planner" > /dev/null || { echo "FAIL: POST messages 失败（4-field 前置）"; exit 1; }
MSGS=$(curl -sf "localhost:5221/api/brain/harness/messages/$TEST_INIT_ID2/planner" | jq '.messages') || exit 1
echo "$MSGS" | jq -e '.[0].id | type == "string"' || { echo "FAIL: 消息对象缺 id (uuid) 字段"; exit 1; }
echo "$MSGS" | jq -e '.[0].message | type == "string"' || { echo "FAIL: 消息对象缺 message 字段"; exit 1; }
echo "$MSGS" | jq -e '.[0].created_at | type == "string"' || { echo "FAIL: 消息对象缺 created_at (iso8601) 字段"; exit 1; }
echo "$MSGS" | jq -e '.[0] | has("consumed_at")' || { echo "FAIL: 消息对象缺 consumed_at 字段"; exit 1; }
echo "OK: GET messages 四字段验证通过"
```

**硬阈值**: exit 0；`messages` 数组（空时 `[]`）；消息对象 4 字段齐全

---

### Step 9: 容器通过 POST /messages 发送消息（响应 schema + keys 完整性）
**来源**: `[FROM_PRD]` — PRD WS4 Response Schema: POST /api/brain/harness/messages/:initiativeId/:subTaskId

**可观测行为**: POST 返回 201 + `{"id": "<uuid>", "message": "<string>", "created_at": "<iso8601>"}`；顶层 keys 严格等于 `["created_at","id","message"]`（JSON keys 排序后）；禁用字段 `data`/`result`/`payload`/`body` 不存在。

**验证命令**:
```bash
TEST_INIT_ID="00000000-0000-0000-0000-000000000001"
RESP=$(curl -sf -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"message":"test-harness-msg"}' \
  "localhost:5221/api/brain/harness/messages/$TEST_INIT_ID/planner")
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -1)
[ "$HTTP_CODE" = "201" ] || { echo "FAIL: POST 未返回 201 (got $HTTP_CODE)"; exit 1; }
echo "$BODY" | jq -e '.id | type == "string"' || { echo "FAIL: 缺 id 字段"; exit 1; }
echo "$BODY" | jq -e '.message == "test-harness-msg"' || { echo "FAIL: message 字段不符"; exit 1; }
echo "$BODY" | jq -e '.created_at | type == "string"' || { echo "FAIL: 缺 created_at 字段"; exit 1; }
# keys 完整性校验（PRD POST 响应顶层 keys 必须完全等于 ["created_at","id","message"]）
echo "$BODY" | jq -e 'keys == ["created_at","id","message"]' || { echo "FAIL: POST 响应 keys 不符 [\"created_at\",\"id\",\"message\"]"; exit 1; }
# 禁用字段不存在
echo "$BODY" | jq -e 'has("data") | not' || { echo "FAIL: 含禁用字段 data"; exit 1; }
echo "$BODY" | jq -e 'has("result") | not' || { echo "FAIL: 含禁用字段 result"; exit 1; }
echo "$BODY" | jq -e 'has("payload") | not' || { echo "FAIL: 含禁用字段 payload"; exit 1; }
echo "$BODY" | jq -e 'has("body") | not' || { echo "FAIL: 含禁用字段 body"; exit 1; }
echo "OK: POST messages 验证通过"
```

**硬阈值**: HTTP 201；id (uuid)，message (string)，created_at (iso8601)；`keys == ["created_at","id","message"]`

---

### Step 10: GET 查回刚 POST 的消息，验证持久化 + 消息对象完整结构
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：防止 POST 返回假成功（插入 DB 失败），需 GET 验证消息确实持久化到 harness_messages 表，同时验证消息对象四字段完整性

**可观测行为**: POST 后 GET 同一 initiativeId+subTaskId 返回的 messages 数组包含刚创建的消息；消息字段含 `id`/`message`/`created_at`/`consumed_at`。

**验证命令**:
```bash
TEST_INIT_ID="00000000-0000-0000-0000-000000000002"
# POST 一条消息
MSG_ID=$(curl -sf -X POST \
  -H "Content-Type: application/json" \
  -d '{"message":"persist-check"}' \
  "localhost:5221/api/brain/harness/messages/$TEST_INIT_ID/ws-smoke" | jq -r '.id')
[ -n "$MSG_ID" ] || { echo "FAIL: POST 未返回 id"; exit 1; }
# GET 查回
MSGS=$(curl -sf "localhost:5221/api/brain/harness/messages/$TEST_INIT_ID/ws-smoke" | jq '.messages')
echo "$MSGS" | jq -e "map(select(.id == \"$MSG_ID\")) | length >= 1" || { echo "FAIL: POST 的消息在 GET 中找不到"; exit 1; }
# 消息对象四字段完整性校验（PRD: id/message/created_at/consumed_at）
echo "$MSGS" | jq -e '.[0].id | type == "string"' || { echo "FAIL: 消息对象缺 id 字段"; exit 1; }
echo "$MSGS" | jq -e '.[0].message | type == "string"' || { echo "FAIL: 消息对象缺 message 字段"; exit 1; }
echo "$MSGS" | jq -e '.[0].created_at | type == "string"' || { echo "FAIL: 消息对象缺 created_at 字段"; exit 1; }
echo "$MSGS" | jq -e '.[0] | has("consumed_at")' || { echo "FAIL: 消息对象缺 consumed_at 字段"; exit 1; }
echo "OK: 消息持久化 + 四字段验证通过"
```

**硬阈值**: GET 返回 messages 数组且包含刚 POST 的 id；消息对象 4 字段齐全

---

### Step 11: Graph 结束时 thread_lookup.status 更新为 completed/failed
**来源**: `[FROM_PRD]` — PRD WS4 Golden Path 段：「graph 结束/失败时 thread_lookup.status UPDATE 为 completed/failed」

**可观测行为**: `harness-thread-lookup.js` 或 `harness-initiative.graph.js` 含在 graph 正常结束时 UPDATE `walking_skeleton_thread_lookup.status = 'completed'` 和失败时 `status = 'failed'` 的逻辑；幂等 UPDATE（重复 UPDATE 不报错）。

**验证命令**:
```bash
FOUND=0
node -e "const c=require('fs').readFileSync('packages/brain/src/lib/harness-thread-lookup.js','utf8'); if(c.includes('completed') && c.includes('failed') && c.includes('UPDATE')) process.exit(0); process.exit(1)" 2>/dev/null && FOUND=1
node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8'); if(c.includes(\"status = 'completed'\") || c.includes('status: .completed.')) process.exit(0); process.exit(1)" 2>/dev/null && FOUND=1
[ "$FOUND" = "1" ] || { echo "FAIL: 未找到 thread_lookup status 生命周期更新逻辑"; exit 1; }
echo "OK: thread_lookup status 生命周期更新逻辑存在"
```

**硬阈值**: exit 0

---

### Step 12: consumed 查询参数 + 禁用别名不被接受
**来源**: `[FROM_PRD]` — PRD Response Schema GET 段：`consumed` (boolean-as-string, 可选, 默认 `false`)；禁用别名 `include_consumed`/`all`/`show_consumed`

**可观测行为**: GET 端点接受 `?consumed=false`（默认，仅返未消费消息）和 `?consumed=true`（返全部）；代码不使用禁用别名 `include_consumed`/`all`/`show_consumed` 作为 req.query 参数名；默认行为下消息 consumed_at 字段为 null。

**验证命令**:
```bash
TEST_INIT_ID="00000000-0000-0000-0000-000000000012"
# POST 一条消息（consumed_at 应为 null）
curl -sf -X POST \
  -H "Content-Type: application/json" \
  -d '{"message":"consumed-param-test"}' \
  "localhost:5221/api/brain/harness/messages/$TEST_INIT_ID/planner" > /dev/null || { echo "FAIL: POST failed"; exit 1; }

# consumed=false（显式传）：返回的消息 consumed_at 为 null（未消费）
RESP=$(curl -sf "localhost:5221/api/brain/harness/messages/$TEST_INIT_ID/planner?consumed=false") || { echo "FAIL: GET with consumed=false 失败"; exit 1; }
echo "$RESP" | jq -e '.messages | type == "array"' || { echo "FAIL: GET consumed=false 无 messages 数组"; exit 1; }
echo "$RESP" | jq -e '[.messages[] | .consumed_at == null] | all' || { echo "FAIL: consumed=false 应只返回 consumed_at=null 的消息"; exit 1; }

# 禁用别名代码层面检查（路由不使用 include_consumed/all/show_consumed）
node -e "
const c = require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');
if (c.includes('include_consumed')) { console.error('FAIL: 路由使用了禁用别名 include_consumed'); process.exit(1); }
if (c.includes(\"req.query.all\") || c.includes(\"query['all']\") || c.includes('query[\"all\"]')) { console.error('FAIL: 路由使用了禁用别名 all'); process.exit(1); }
if (c.includes('show_consumed')) { console.error('FAIL: 路由使用了禁用别名 show_consumed'); process.exit(1); }
if (!c.includes('consumed') && !c.includes('req.query')) { console.error('FAIL: 路由未实现 consumed 查询参数'); process.exit(1); }
console.log('OK: 禁用别名未被使用，consumed 参数已实现');
" || exit 1

echo "OK: consumed 参数 + 禁用别名验证通过"
```

**硬阈值**: exit 0；`consumed=false` 返回 consumed_at=null 的消息；禁用别名不出现在路由代码中

---

## E2E 验收（final-e2e）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -e

# === Harness Pipeline 核心稳定化 Golden Path E2E ===
# 验证范围：1) Messages API 双向通信 2) Patrol 检测逻辑 3) 代码结构变更

echo "=== Phase 1: Messages API 端到端 ==="
TEST_ID="e2e-$(date +%s)"
INIT_UUID="00000000-0000-0000-0000-$(printf '%012x' $(date +%s))"
SUB_TASK="e2e-planner"

# 1a. POST 消息
MSG_RESP=$(curl -sf -X POST \
  -H "Content-Type: application/json" \
  -d "{\"message\":\"e2e-test-$TEST_ID\"}" \
  "localhost:5221/api/brain/harness/messages/$INIT_UUID/$SUB_TASK") || {
  echo "FAIL: POST messages 失败"; exit 1
}
MSG_ID=$(echo "$MSG_RESP" | jq -r '.id')
[ -n "$MSG_ID" ] || { echo "FAIL: POST 未返回 id"; exit 1; }
# POST keys 完整性
echo "$MSG_RESP" | jq -e 'keys == ["created_at","id","message"]' || { echo "FAIL: POST keys 不符"; exit 1; }

# 1b. GET 查回，验证顶层 schema + 消息对象四字段
GET_RESP=$(curl -sf "localhost:5221/api/brain/harness/messages/$INIT_UUID/$SUB_TASK") || {
  echo "FAIL: GET messages 失败"; exit 1
}
echo "$GET_RESP" | jq -e '.messages | type == "array"' || { echo "FAIL: GET 缺 messages 字段"; exit 1; }
echo "$GET_RESP" | jq -e 'keys == ["messages"]' || { echo "FAIL: GET 顶层 keys 不符"; exit 1; }
echo "$GET_RESP" | jq -e "(.messages | map(select(.id == \"$MSG_ID\")) | length) >= 1" || {
  echo "FAIL: GET 未返回刚 POST 的消息"; exit 1
}
# 消息对象四字段
echo "$GET_RESP" | jq -e '.[0].id | type == "string"' 2>/dev/null || \
echo "$GET_RESP" | jq -e '.messages[0].id | type == "string"' || { echo "FAIL: 消息对象缺 id"; exit 1; }
echo "$GET_RESP" | jq -e '.messages[0].message | type == "string"' || { echo "FAIL: 消息对象缺 message"; exit 1; }
echo "$GET_RESP" | jq -e '.messages[0].created_at | type == "string"' || { echo "FAIL: 消息对象缺 created_at"; exit 1; }
echo "$GET_RESP" | jq -e '.messages[0] | has("consumed_at")' || { echo "FAIL: 消息对象缺 consumed_at"; exit 1; }
echo "✅ Phase 1 Messages API E2E 通过 msg_id=$MSG_ID"

echo "=== Phase 2: 不存在的 initiativeId 返 {messages:[]} ==="
GONE_RESP=$(curl -sf "localhost:5221/api/brain/harness/messages/11111111-0000-0000-0000-000000000000/x") || {
  echo "FAIL: 不存在 initiativeId 返回非 200"; exit 1
}
echo "$GONE_RESP" | jq -e '.messages == []' || { echo "FAIL: 不存在 ID 未返回空数组"; exit 1; }
echo "✅ Phase 2 空返回验证通过"

echo "=== Phase 3: consumed 参数 + 禁用别名代码检查 ==="
CONS_UUID="00000000-0000-0000-0000-$(printf '%012x' $(($(date +%s)+1)))"
curl -sf -X POST -H "Content-Type: application/json" \
  -d '{"message":"consumed-e2e"}' \
  "localhost:5221/api/brain/harness/messages/$CONS_UUID/planner" > /dev/null
CONS_RESP=$(curl -sf "localhost:5221/api/brain/harness/messages/$CONS_UUID/planner?consumed=false")
echo "$CONS_RESP" | jq -e '[.messages[] | .consumed_at == null] | all' || { echo "FAIL: consumed=false 返回含已消费消息"; exit 1; }
node -e "
const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');
if(c.includes('include_consumed')||c.includes('show_consumed')){process.exit(1)}
" || { echo "FAIL: 路由含禁用别名"; exit 1; }
echo "✅ Phase 3 consumed 参数验证通过"

echo "=== Phase 4: 代码结构变更验证（异步化 + Patrol）==="
grep -q "spawnDockerDetached" packages/brain/src/workflows/harness-initiative.graph.js || {
  echo "FAIL: harness-initiative.graph.js 未实现 Planner detached"; exit 1
}
grep -q "spawnDockerDetached" packages/brain/src/workflows/harness-gan.graph.js || {
  echo "FAIL: harness-gan.graph.js 未实现 GAN detached"; exit 1
}
node -e "require('fs').accessSync('packages/brain/src/harness-initiative-patrol.js')" || {
  echo "FAIL: harness-initiative-patrol.js 不存在"; exit 1
}
node -e "require('fs').accessSync('packages/brain/src/harness-intervention-handler.js')" || {
  echo "FAIL: harness-intervention-handler.js 不存在"; exit 1
}
echo "✅ Phase 4 代码结构验证通过"

echo "=== Phase 5: thread_lookup status 生命周期代码验证 ==="
node -e "
const c = require('fs').readFileSync('packages/brain/src/lib/harness-thread-lookup.js','utf8');
if (!c.includes('completed') || !c.includes('failed')) process.exit(1);
" || {
  echo "FAIL: harness-thread-lookup.js 缺 status 生命周期"; exit 1
}
echo "✅ Phase 5 thread_lookup 生命周期验证通过"

echo ""
echo "✅ Golden Path 全程验证通过"
```

---

## Workstreams

workstream_count: 6

### Workstream 1: DB migration — harness_messages 表
**范围**: 新建 `packages/brain/migrations/288_harness_messages.sql`，创建 `harness_messages` 表（id UUID PK, initiative_id UUID, sub_task_id TEXT, message TEXT, consumed_at TIMESTAMPTZ DEFAULT NULL, created_at TIMESTAMPTZ DEFAULT NOW()）
**大小**: S (<50 行)
**依赖**: 无

### Workstream 2: Planner 节点异步化（spawnDockerDetached + interrupt）
**范围**: 改造 `packages/brain/src/workflows/harness-initiative.graph.js` 的 `runPlannerNode`：将 `reconnectOrSpawn` 改为 `spawnDockerDetached` + 写 `walking_skeleton_thread_lookup`（graph_name='harness-initiative'）+ `interrupt()` 挂起。Brain tick 继续不阻塞。
**大小**: M (~100 行净改)
**依赖**: Workstream 1 完成后

### Workstream 3: GAN 每轮异步化（proposer + reviewer detached）
**范围**: 改造 `packages/brain/src/workflows/harness-gan.graph.js` 的 `proposer` 和 `reviewer` 函数：将 `reconnectOrSpawn` 改为 `spawnDockerDetached` + 写 thread_lookup（graph_name='harness-gan'）+ `interrupt()`。GAN 收敛逻辑（detectConvergenceTrend/轮数上限）不变。
**大小**: M (~130 行净改)
**依赖**: Workstream 2 完成后

### Workstream 4: Harness Initiative Patrol（initiative_runs 卡住检测）
**范围**: 新建 `packages/brain/src/harness-initiative-patrol.js`（扫描 `initiative_runs WHERE completed_at IS NULL`，检测 Planner>15min/GAN>20min 卡住，创建 `harness_intervention` 任务，防重 pending 检测）；修改 `packages/brain/src/pipeline-patrol-plugin.js` 调用新 patrol。
**大小**: M (~130 行，2 文件)
**依赖**: Workstream 3 完成后

### Workstream 5: Intervention Handler + task-router 注册
**范围**: 新建 `packages/brain/src/harness-intervention-handler.js`（读 Docker logs via `walking_skeleton_thread_lookup.container_id`，调 Brain LLM 客户端分析，返回 action=retry/skip/alert 写入 task result）；修改 `packages/brain/src/task-router.js` 注册 handler。
**大小**: M (~140 行，2 文件)
**依赖**: Workstream 4 完成后

### Workstream 6: 消息 API 端点 + thread_lookup status 生命周期
**范围**: 在 `packages/brain/src/routes/harness.js` 新增 GET + POST `/api/brain/harness/messages/:initiativeId/:subTaskId`（GET 支持 `?consumed=false|true` 过滤，禁用别名 `include_consumed`/`all`/`show_consumed`）；修改 `packages/brain/src/lib/harness-thread-lookup.js` 新增 `updateHarnessThreadStatus(containerId, status)` 函数。
**大小**: M (~130 行，2 文件)
**依赖**: Workstream 5 完成后

---

## Workstreams 切分验证（v7.7 自查）

| WS | 文件数 | 预计净增行数 | 是否满足 ≤200 行 + ≤3 文件 |
|---|---|---|---|
| WS1 | 1 | ~35 | ✅ |
| WS2 | 1 | ~100 | ✅ |
| WS3 | 1 | ~130 | ✅ |
| WS4 | 2 | ~130 | ✅ |
| WS5 | 2 | ~140 | ✅ |
| WS6 | 2 | ~130 | ✅ |

---

## Risks（v7 新增 — 修 Reviewer risk_registered=2）

### Risk 1: Planner callback 超时导致 graph 永久挂起
**风险**: `spawnDockerDetached` 后容器启动失败或 callback 永远不到达，graph 在 interrupt 状态永久挂起，initiative_run 的 `completed_at` 永远为 NULL
**Mitigation**: WS3 Patrol 检测 Planner>15min 未 callback → 创建 `harness_intervention` → handler 发 alert；Brain 重启后 Graph Resume 机制已有兜底

### Risk 2: migration 失败导致 WS6 端点 500
**风险**: `288_harness_messages.sql` migration 未执行（Brain 启动时 migration runner 未覆盖此文件），导致 `harness_messages` 表不存在，POST/GET 端点返回 DB 错误
**Mitigation**: migration 使用 `CREATE TABLE IF NOT EXISTS`（幂等）；Brain migration runner 按文件名数字序执行，287 命名确保在现有 migration 之后执行；WS6 评估命令会 FAIL 给出明确错误信息

### Risk 3: Patrol 防重失效导致 intervention 任务风暴
**风险**: Patrol 每次 tick 扫描到相同卡住 initiative 时，如果防重检查（`WHERE status='pending'` 查询）有竞态，可能重复创建 `harness_intervention` 任务
**Mitigation**: WS4 实现时防重查询需在事务内（SELECT FOR UPDATE 或 INSERT ... ON CONFLICT DO NOTHING）；Patrol 本身在 Brain tick 的 try-catch 内运行，防止错误蔓延

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/migration.test.ts` | 文件存在/CREATE TABLE/initiative_id | 文件不存在 → N failures |
| WS2 | `tests/ws2/planner-async.test.ts` | spawnDockerDetached/interrupt/thread_lookup 写入/try-catch | 函数仍用 reconnectOrSpawn → N failures |
| WS3 | `tests/ws3/gan-async.test.ts` | proposer/reviewer/收敛逻辑/thread_lookup 写入 | 函数仍用 reconnectOrSpawn → N failures |
| WS4 | `tests/ws4/patrol.test.ts` | 文件存在/initiative_runs 查询/任务创建/防重/try-catch | 文件不存在 → N failures |
| WS5 | `tests/ws5/intervention.test.ts` | 文件存在/action 字段/docker logs 读取/harness_intervention/try-catch | 文件不存在 → N failures |
| WS6 | `tests/ws6/messages-api.test.ts` | GET /messages/201/禁用字段/消息对象/consumed/404 | 端点未注册 → N failures |
