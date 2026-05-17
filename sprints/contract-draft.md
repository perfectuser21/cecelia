# Sprint Contract Draft (Round 1)

## Golden Path

[用户打开 `/pipeline/:id`] → [HarnessPipelineDetailPage 建立 EventSource 连接到 `GET /api/brain/harness/stream?planner_task_id={id}`] → [Brain SSE 从 `task_events` 表 2s 轮询 `event_type='graph_node_update'` 行推 `event: node_update` data `{node,label,attempt,ts}`] → [前端实时追加节点行（节点名 + 时间戳）] → [task.status 变为 `completed`/`failed` → SSE 推 `event: done` data `{status,verdict}` → 页面显示"Pipeline 已完成"或"Pipeline 失败"]

---

### Step 1: Brain SSE 端点接受 planner_task_id，返回 text/event-stream

**可观测行为**: `GET /api/brain/harness/stream?planner_task_id={uuid}` 返回 `Content-Type: text/event-stream`；缺少参数返 400；未知 UUID 返 404

**验证命令**:
```bash
DB="${DATABASE_URL:-postgresql://localhost/cecelia}"

# 400 — 缺少 planner_task_id
CODE_400=$(curl -s -o /tmp/c400.json -w "%{http_code}" "localhost:5221/api/brain/harness/stream")
[ "$CODE_400" = "400" ] && echo "400_OK"
jq -e '.error | type == "string"' /tmp/c400.json && echo "400_ERROR_OK"
jq -e 'has("message") | not' /tmp/c400.json && echo "400_NO_MSG_OK"

# 404 — 未知 planner_task_id
CODE_404=$(curl -s -o /tmp/c404.json -w "%{http_code}" \
  "localhost:5221/api/brain/harness/stream?planner_task_id=00000000-0000-0000-0000-000000000000")
[ "$CODE_404" = "404" ] && echo "404_OK"
jq -e '.error | type == "string"' /tmp/c404.json && echo "404_ERROR_OK"
```

**硬阈值**: 400_OK + 400_ERROR_OK + 400_NO_MSG_OK + 404_OK + 404_ERROR_OK

---

### Step 2: SSE 推 event: node_update，data schema 严格符合 PRD

**可观测行为**: 推送 `event: node_update`；data JSON 含且仅含 `node`/`label`/`attempt`/`ts` 字段；禁用字段 `name`/`nodeName`/`step`/`timestamp` 不存在

**验证命令**:
```bash
DB="${DATABASE_URL:-postgresql://localhost/cecelia}"

# 创建测试 task
TASK_ID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type, status, title, payload) \
  VALUES ('test', 'running', 'SSE contract test', '{}') RETURNING id" | tr -d ' \n')

# 插入 graph_node_update 事件
psql "$DB" -c "INSERT INTO task_events (task_id, event_type, payload, created_at) \
  VALUES ('$TASK_ID', 'graph_node_update', \
  '{\"nodeName\":\"proposer\",\"attemptN\":1,\"initiativeId\":\"test\"}'::jsonb, NOW())"

# 获取 SSE 流（6s 超时）
SSE=$(curl -s --max-time 6 \
  "localhost:5221/api/brain/harness/stream?planner_task_id=$TASK_ID" 2>&1 || true)
echo "$SSE" | grep -q "event: node_update" && echo "EVENT_OK"

DATA=$(echo "$SSE" | grep "^data:" | grep -v "keepalive" | head -1 | sed 's/^data: //')
echo "$DATA" | jq -e '.node | type == "string"' && echo "NODE_TYPE_OK"
echo "$DATA" | jq -e '.label | type == "string"' && echo "LABEL_TYPE_OK"
echo "$DATA" | jq -e '.attempt | type == "number"' && echo "ATTEMPT_TYPE_OK"
echo "$DATA" | jq -e '.ts | type == "string"' && echo "TS_TYPE_OK"
echo "$DATA" | jq -e 'keys | sort == ["attempt","label","node","ts"]' && echo "SCHEMA_OK"
echo "$DATA" | jq -e 'has("name") | not' && echo "NO_NAME_OK"
echo "$DATA" | jq -e 'has("nodeName") | not' && echo "NO_NODENAME_OK"
echo "$DATA" | jq -e 'has("timestamp") | not' && echo "NO_TIMESTAMP_OK"
```

**硬阈值**: EVENT_OK + 5 字段/schema/禁用字段验证全过

---

### Step 3: task 完成 → SSE 推 event: done

**可观测行为**: task.status 为 `completed` 或 `failed` 时，SSE 推 `event: done`；data 含 `status`/`verdict` 字段

**验证命令**:
```bash
DB="${DATABASE_URL:-postgresql://localhost/cecelia}"

TASK_ID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type, status, title, payload, result) \
  VALUES ('test', 'completed', 'SSE done test', '{}', '{\"verdict\":\"PASS\"}'::jsonb) \
  RETURNING id" | tr -d ' \n')

SSE=$(curl -s --max-time 8 \
  "localhost:5221/api/brain/harness/stream?planner_task_id=$TASK_ID" 2>&1 || true)
echo "$SSE" | grep -q "event: done" && echo "DONE_OK"
DONE=$(echo "$SSE" | grep -A1 "event: done" | grep "^data:" | head -1 | sed 's/^data: //')
echo "$DONE" | jq -e '.status | . == "completed" or . == "failed"' && echo "STATUS_OK"
echo "$DONE" | jq -e '.verdict | . == "PASS" or . == "FAIL" or . == null' && echo "VERDICT_OK"
```

**硬阈值**: DONE_OK + STATUS_OK + VERDICT_OK

---

### Step 4: HarnessPipelineDetailPage 建立 EventSource，实时展示节点日志

**可观测行为**: 浏览器打开 `/pipeline/{id}`，页面含 `data-testid="realtime-log"` 实时日志区；EventSource URL 含 `planner_task_id={id}` 参数（禁用 `initiative_id`/`taskId`/`task_id`）；收到 node_update 后追加 `data-testid="log-entry"` 节点行

**验证命令**（Playwright）:
```typescript
await page.goto(`http://localhost:5173/pipeline/${TASK_ID}`);
await expect(page.locator('[data-testid="realtime-log"]')).toBeVisible({ timeout: 5000 });
await expect(page.locator('[data-testid="log-entry"]').first()).toBeVisible({ timeout: 8000 });
```

**硬阈值**: realtime-log 可见，至少一条 log-entry 可见

---

### Step 5: pipeline 完成 → 页面显示完成状态文字

**可观测行为**: 收到 `event: done` 后前端显示"Pipeline 已完成"或"Pipeline 失败"文字

**验证命令**（Playwright）:
```typescript
// 插入 completed task，打开页面
await page.goto(`http://localhost:5173/pipeline/${COMPLETED_TASK_ID}`);
await expect(page.locator('text=/Pipeline 已完成|Pipeline 失败/')).toBeVisible({ timeout: 10000 });
```

**硬阈值**: 完成状态文字可见

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: user_facing

**完整验证脚本**:
```bash
#!/bin/bash
set -e

DB="${DATABASE_URL:-postgresql://localhost/cecelia}"

# 1. 创建 running task + node_update 事件
TASK_ID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type, status, title, payload) \
  VALUES ('test', 'running', 'E2E SSE test', '{}') RETURNING id" | tr -d ' \n')
psql "$DB" -c "INSERT INTO task_events (task_id, event_type, payload, created_at) \
  VALUES ('$TASK_ID', 'graph_node_update', \
  '{\"nodeName\":\"proposer\",\"attemptN\":1,\"initiativeId\":\"test\"}'::jsonb, NOW())"

# 2. SSE 推 node_update
SSE=$(curl -s --max-time 6 \
  "localhost:5221/api/brain/harness/stream?planner_task_id=$TASK_ID" 2>&1 || true)
echo "$SSE" | grep -q "event: node_update" \
  || { echo "FAIL: 无 node_update 事件"; exit 1; }

# 3. node_update data schema 完整性
DATA=$(echo "$SSE" | grep "^data:" | grep -v "keepalive" | head -1 | sed 's/^data: //')
echo "$DATA" | jq -e 'keys | sort == ["attempt","label","node","ts"]' \
  || { echo "FAIL: node_update schema 不符，实际=$(echo "$DATA" | jq -c 'keys')"; exit 1; }
echo "$DATA" | jq -e '.node | type == "string"' || { echo "FAIL: node 非 string"; exit 1; }
echo "$DATA" | jq -e '.label | type == "string"' || { echo "FAIL: label 非 string"; exit 1; }
echo "$DATA" | jq -e '.attempt | type == "number"' || { echo "FAIL: attempt 非 number"; exit 1; }
echo "$DATA" | jq -e '.ts | type == "string"' || { echo "FAIL: ts 非 string"; exit 1; }

# 4. 禁用字段反向
echo "$DATA" | jq -e 'has("name") | not' || { echo "FAIL: 禁用字段 name 存在"; exit 1; }
echo "$DATA" | jq -e 'has("nodeName") | not' || { echo "FAIL: 禁用字段 nodeName 存在"; exit 1; }
echo "$DATA" | jq -e 'has("timestamp") | not' || { echo "FAIL: 禁用字段 timestamp 存在"; exit 1; }

# 5. error path — 缺 planner_task_id → 400
CODE_400=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/stream")
[ "$CODE_400" = "400" ] || { echo "FAIL: 缺参数应 400，实际 $CODE_400"; exit 1; }

# 6. error path — 未知 planner_task_id → 404
CODE_404=$(curl -s -o /tmp/e2e_err.json -w "%{http_code}" \
  "localhost:5221/api/brain/harness/stream?planner_task_id=00000000-0000-0000-0000-000000000000")
[ "$CODE_404" = "404" ] || { echo "FAIL: 未知 task 应 404，实际 $CODE_404"; exit 1; }
jq -e '.error | type == "string"' /tmp/e2e_err.json \
  || { echo "FAIL: 404 body 缺 error 字段"; exit 1; }
jq -e 'has("message") | not' /tmp/e2e_err.json \
  || { echo "FAIL: 404 body 含禁用字段 message"; exit 1; }

# 7. done event — task completed → event: done
DONE_TASK_ID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type, status, title, payload, result) \
  VALUES ('test', 'completed', 'E2E done test', '{}', '{\"verdict\":\"PASS\"}'::jsonb) \
  RETURNING id" | tr -d ' \n')
SSE2=$(curl -s --max-time 8 \
  "localhost:5221/api/brain/harness/stream?planner_task_id=$DONE_TASK_ID" 2>&1 || true)
echo "$SSE2" | grep -q "event: done" || { echo "FAIL: 无 done 事件"; exit 1; }
DONE_DATA=$(echo "$SSE2" | grep -A1 "event: done" | grep "^data:" | head -1 | sed 's/^data: //')
echo "$DONE_DATA" | jq -e '.status | . == "completed" or . == "failed"' \
  || { echo "FAIL: done.status 不合法"; exit 1; }
echo "$DONE_DATA" | jq -e '.verdict | . == "PASS" or . == "FAIL" or . == null' \
  || { echo "FAIL: done.verdict 不合法"; exit 1; }

echo "✅ E2E Golden Path 全过"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 2

### Workstream 1: Brain SSE 端点 GET /api/brain/harness/stream

**范围**: `packages/brain/src/routes/harness.js` 新增 `GET /stream` SSE 端点（`planner_task_id` 参数校验，从 `task_events` 表 2s 轮询 `event_type=graph_node_update` 行，30s keepalive `: keepalive`，task 完成时推 `event: done`）
**大小**: M(100-300行)
**依赖**: 无（`task_events` 表和 `emitGraphNodeUpdate` 已存在）

**BEHAVIOR 覆盖测试文件**: `tests/ws1/sse.test.ts`

---

### Workstream 2: Dashboard HarnessPipelineDetailPage 实时日志区

**范围**: `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx` 新增实时日志区（EventSource 连接到 `/api/brain/harness/stream?planner_task_id=:id`，`data-testid=realtime-log`，`data-testid=log-entry`，完成状态文字）
**大小**: M(100-300行)
**依赖**: Workstream 1 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws2/harness-pipeline-detail-page.test.ts`

---

## Workstreams 切分验证

| WS | 文件数 | 预估行数 | 依赖 |
|---|---|---|---|
| WS1 | 1 | ~150 行 | — |
| WS2 | 1 | ~120 行 | WS1 |

各 WS 均 ≤ 200 行 + ≤ 3 文件 ✓

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/sse.test.ts` | 400/404 error path、node_update schema、done event | 4 failures（/stream 端点不存在） |
| WS2 | `tests/ws2/harness-pipeline-detail-page.test.ts` | 页面渲染、EventSource URL、log-entry 追加、完成状态 | 3 failures（实时日志区未实现） |
