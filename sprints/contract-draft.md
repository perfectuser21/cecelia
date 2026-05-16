# Sprint Contract Draft (Round 1)

## Golden Path

[用户打开 `/pipeline/:id`] → [页面建立 SSE 连接到 `/api/brain/harness/stream?planner_task_id={id}`] → [Backend 每 2s 轮询 task_events 推送 `event: node_update`] → [前端实时日志区追加节点名+时间] → [pipeline 完成时 SSE 推 `event: done`，前端显示"Pipeline 已完成 ✅"]

---

### Step 1: 用户打开详情页，建立 SSE 连接

**可观测行为**: `HarnessPipelineDetailPage` 向 `GET /api/brain/harness/stream?planner_task_id={id}` 发起 EventSource 连接；服务端返回 `Content-Type: text/event-stream`，HTTP 200

**验证命令**:
```bash
TEST_ID=$(PGUSER=cecelia PGHOST=localhost psql -d cecelia -t -c \
  "INSERT INTO tasks (task_type,status,payload,title,created_at) VALUES ('test_sse_probe','in_progress','{}','SSE Conn Test',NOW()) RETURNING id" \
  | tr -d ' \n')
# 后台连接，取 HTTP 响应头中的状态码
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 \
  -H "Accept: text/event-stream" \
  "localhost:5221/api/brain/harness/stream?planner_task_id=$TEST_ID") || true
[ "$HTTP_CODE" = "200" ] || { echo "FAIL: HTTP $HTTP_CODE (expected 200)"; exit 1; }
echo "✅ Step 1 验证通过"
```

**硬阈值**: HTTP 200, Content-Type: text/event-stream

---

### Step 2: Backend 每 2s 轮询 task_events，推送 node_update 事件

**可观测行为**: Brain 从 `task_events` 表读取 `event_type='graph_node_update'` 行，转换并推送 `event: node_update` SSE 事件；payload 含 `node`/`label`/`attempt`/`ts` 4 个字段，无禁用字段名

**验证命令**:
```bash
TEST_ID=$(PGUSER=cecelia PGHOST=localhost psql -d cecelia -t -c \
  "INSERT INTO tasks (task_type,status,payload,title,created_at) VALUES ('test_sse_probe','completed','{}','SSE Schema Test',NOW()) RETURNING id" \
  | tr -d ' \n')
PGUSER=cecelia PGHOST=localhost psql -d cecelia -c "
  INSERT INTO task_events (task_id,event_type,payload,created_at)
  VALUES ('$TEST_ID','graph_node_update',
    '{\"initiativeId\":\"test\",\"threadId\":\"t1\",\"nodeName\":\"proposer\",\"attemptN\":1,\"payloadSummary\":{}}'::jsonb,
    NOW() - interval '1 second')"
timeout 8 curl -sN -H "Accept: text/event-stream" \
  "localhost:5221/api/brain/harness/stream?planner_task_id=$TEST_ID" > /tmp/sse_step2.txt 2>&1 || true
DATA=$(grep "^data:" /tmp/sse_step2.txt | grep -v '"status"' | head -1 | sed 's/^data: //')
[ -n "$DATA" ] || { echo "FAIL: 未收到 node_update 事件"; cat /tmp/sse_step2.txt; exit 1; }
echo "$DATA" | jq -e '.node == "proposer"' || { echo "FAIL: node 字段"; exit 1; }
echo "$DATA" | jq -e '.label | type == "string"' || { echo "FAIL: label 类型"; exit 1; }
echo "$DATA" | jq -e '.attempt == 1' || { echo "FAIL: attempt 字段"; exit 1; }
echo "$DATA" | jq -e '.ts | type == "string"' || { echo "FAIL: ts 类型"; exit 1; }
echo "✅ Step 2 验证通过"
```

**硬阈值**: `node`/`label`/`attempt`/`ts` 字段全部存在且类型正确

---

### Step 3: node_update 事件 Schema 完整性 + 禁用字段反向校验

**可观测行为**: `event: node_update` 的 `data:` JSON 顶层 keys 恰好为 `["attempt","label","node","ts"]`（字母序），不含 `name`/`nodeName`/`timestamp`/`step`/`phase`/`type` 等禁用字段

**验证命令**:
```bash
DATA=$(grep "^data:" /tmp/sse_step2.txt | grep -v '"status"' | head -1 | sed 's/^data: //')
[ -n "$DATA" ] || { echo "FAIL: 无缓存 SSE 数据（先跑 Step 2）"; exit 1; }
echo "$DATA" | jq -e 'keys == ["attempt","label","node","ts"]' || { echo "FAIL: keys 不完整或有多余"; exit 1; }
echo "$DATA" | jq -e 'has("name") | not' || { echo "FAIL: 禁用字段 name 漏网"; exit 1; }
echo "$DATA" | jq -e 'has("nodeName") | not' || { echo "FAIL: 禁用字段 nodeName 漏网"; exit 1; }
echo "$DATA" | jq -e 'has("timestamp") | not' || { echo "FAIL: 禁用字段 timestamp 漏网"; exit 1; }
echo "✅ Step 3 验证通过"
```

**硬阈值**: `keys == ["attempt","label","node","ts"]`，3 个禁用字段均不存在

---

### Step 4: pipeline 完成时推 `event: done` 并关闭连接

**可观测行为**: 当 task.status = `completed`，SSE 推送所有历史事件后发送 `event: done` + `data: {"status":"completed","verdict":...}`，服务端关闭连接

**验证命令**:
```bash
grep -q "^event: done" /tmp/sse_step2.txt || { echo "FAIL: 未收到 event: done"; cat /tmp/sse_step2.txt; exit 1; }
DONE_DATA=$(grep -A1 "^event: done" /tmp/sse_step2.txt | grep "^data:" | sed 's/^data: //')
echo "$DONE_DATA" | jq -e '.status == "completed" or .status == "failed"' || { echo "FAIL: done.status 非法值"; exit 1; }
echo "✅ Step 4 验证通过"
```

**硬阈值**: `event: done` 存在，`data.status ∈ {completed, failed}`

---

### Step 5: 前端实时日志区显示节点名+时间，完成时显示"Pipeline 已完成 ✅"

**可观测行为**: Playwright 打开详情页，模拟 SSE 注入 node_update + done 事件，验证：(a) `[data-testid="sse-log"]` 可见；(b) 日志行含节点 label 文本；(c) 完成消息含"Pipeline 已完成"

**验证命令**:
```bash
lsof -i:5211 2>/dev/null | grep LISTEN || \
  (cd /workspace/apps/dashboard && npm run dev -- --port 5211 > /tmp/dashboard.log 2>&1 & sleep 8)
cd /workspace && npx playwright test /workspace/sprints/tests/ws2/sse-ui.spec.ts \
  --project=chromium --base-url http://localhost:5211 --timeout=60000 2>&1
echo "✅ Step 5 验证通过"
```

**硬阈值**: Playwright 全部断言通过（exit 0）

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: user_facing

**完整验证脚本**:
```bash
#!/bin/bash
set -e
DB=cecelia

# === 准备测试数据 ===
echo "[e2e] 创建 completed planner task..."
TEST_ID=$(PGUSER=cecelia PGHOST=localhost psql -d $DB -t -c \
  "INSERT INTO tasks (task_type,status,payload,title,created_at)
   VALUES ('test_sse_e2e','completed','{}'::jsonb,'SSE E2E',NOW())
   RETURNING id" | tr -d ' \n')
[ -n "$TEST_ID" ] || { echo "FAIL: DB 插入失败"; exit 1; }
echo "[e2e] task_id=$TEST_ID"

PGUSER=cecelia PGHOST=localhost psql -d $DB -c "
  INSERT INTO task_events (task_id,event_type,payload,created_at) VALUES
  ('$TEST_ID','graph_node_update',
   '{\"initiativeId\":\"test\",\"threadId\":\"t1\",\"nodeName\":\"proposer\",\"attemptN\":1,\"payloadSummary\":{}}'::jsonb,
   NOW() - interval '2 seconds'),
  ('$TEST_ID','graph_node_update',
   '{\"initiativeId\":\"test\",\"threadId\":\"t1\",\"nodeName\":\"generator\",\"attemptN\":1,\"payloadSummary\":{}}'::jsonb,
   NOW() - interval '1 second')"

# === 验证 Backend SSE ===
echo "[e2e] 验证 SSE 端点..."
timeout 10 curl -sN -H "Accept: text/event-stream" \
  "localhost:5221/api/brain/harness/stream?planner_task_id=$TEST_ID" > /tmp/sse_e2e.txt 2>&1 || true

NODE_DATA=$(grep "^data:" /tmp/sse_e2e.txt | grep -v '"status"' | head -1 | sed 's/^data: //')
[ -n "$NODE_DATA" ] || { echo "FAIL: 未收到 node_update 事件"; cat /tmp/sse_e2e.txt; exit 1; }

echo "$NODE_DATA" | jq -e '.node == "proposer"' || { echo "FAIL: node 字段错误"; exit 1; }
echo "$NODE_DATA" | jq -e '.label | type == "string"' || { echo "FAIL: label 非 string"; exit 1; }
echo "$NODE_DATA" | jq -e '.attempt == 1' || { echo "FAIL: attempt 错误"; exit 1; }
echo "$NODE_DATA" | jq -e '.ts | type == "string"' || { echo "FAIL: ts 非 string"; exit 1; }
echo "$NODE_DATA" | jq -e 'keys == ["attempt","label","node","ts"]' || { echo "FAIL: keys 不完整"; exit 1; }
echo "$NODE_DATA" | jq -e 'has("name") | not' || { echo "FAIL: 禁用字段 name"; exit 1; }
echo "$NODE_DATA" | jq -e 'has("nodeName") | not' || { echo "FAIL: 禁用字段 nodeName"; exit 1; }
echo "$NODE_DATA" | jq -e 'has("timestamp") | not' || { echo "FAIL: 禁用字段 timestamp"; exit 1; }
grep -q "^event: done" /tmp/sse_e2e.txt || { echo "FAIL: 未收到 event: done"; exit 1; }
DONE_DATA=$(grep -A1 "^event: done" /tmp/sse_e2e.txt | grep "^data:" | sed 's/^data: //')
echo "$DONE_DATA" | jq -e '.status == "completed"' || { echo "FAIL: done.status 非 completed"; exit 1; }

# error path — 缺少 planner_task_id → 400
ERR_CODE=$(curl -s -o /tmp/sse_err.json -w "%{http_code}" "localhost:5221/api/brain/harness/stream")
[ "$ERR_CODE" = "400" ] || { echo "FAIL: 缺参数未返 400 (got $ERR_CODE)"; exit 1; }
jq -e 'has("error")' /tmp/sse_err.json || { echo "FAIL: 400 body 无 error 字段"; exit 1; }
jq -e 'has("message") | not' /tmp/sse_err.json || { echo "FAIL: 400 body 含禁用字段 message"; exit 1; }

# error path — 未知 UUID → 404
FAKE_ID="00000000-0000-0000-0000-000000000000"
NF_CODE=$(curl -s -o /tmp/sse_nf.json -w "%{http_code}" \
  "localhost:5221/api/brain/harness/stream?planner_task_id=$FAKE_ID")
[ "$NF_CODE" = "404" ] || { echo "FAIL: 未知 ID 未返 404 (got $NF_CODE)"; exit 1; }
jq -e '.error == "pipeline not found"' /tmp/sse_nf.json || { echo "FAIL: 404 error 消息不符"; exit 1; }

# === 验证 Frontend（Playwright）===
echo "[e2e] 验证前端日志区..."
lsof -i:5211 2>/dev/null | grep LISTEN || \
  (cd /workspace/apps/dashboard && npm run dev -- --port 5211 > /tmp/dashboard.log 2>&1 & sleep 8)
cd /workspace && npx playwright test /workspace/sprints/tests/ws2/sse-ui.spec.ts \
  --project=chromium --base-url http://localhost:5211 --timeout=60000

echo ""
echo "✅ Golden Path E2E 全部验证通过"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 2

### Workstream 1: Backend SSE stream 端点

**范围**: `packages/brain/src/routes/harness.js` 新增 `GET /stream` 端点；每 2s 轮询 `task_events`；推送 node_update + done + 30s keepalive；错误返 400/404
**大小**: M（100-150 行净增，1 文件）
**依赖**: 无

### Workstream 2: 前端实时日志区 + EventSource

**范围**: `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx` 新增 EventSource hook + SSE 日志区 UI；`data-testid="sse-log"`；完成消息"Pipeline 已完成 ✅"或"Pipeline 失败 ❌"
**大小**: M（80-120 行净增，1 文件）
**依赖**: Workstream 1 完成后

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/sse-stream.test.ts` | SSE schema + keys + 禁用字段 + error path | WS1 → 6 failures（端点未实现） |
| WS2 | `tests/ws2/sse-ui.spec.ts` | log 区 visible + 事件追加 + 完成消息 | WS2 → 3 failures（组件未改动） |
