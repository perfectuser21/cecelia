# Sprint Contract Draft (Round 1)

## Golden Path

[用户打开 `/pipeline/:id`] → [HarnessPipelineDetailPage 建立 EventSource 连接到 `GET /api/brain/harness/stream?planner_task_id={id}`] → [Brain SSE 端点从 `task_events` 表实时推送 `graph_node_update` 事件] → [前端实时日志区追加节点中文标签 + 时间戳] → [pipeline task 变 `completed`/`failed` 时 SSE 发 `event: done`，页面显示"Pipeline 已完成 ✅"/"Pipeline 失败 ❌"]

---

### Step 1: 用户打开详情页，建立 SSE 连接，使用合规 query param

**可观测行为**: `HarnessPipelineDetailPage` 挂载时，使用 `planner_task_id` 拼接 EventSource URL（禁用 `id`/`taskId`/`task_id`/`pipeline_id`/`tid`），建立连接；页面出现"实时日志"区块

**验证命令**:
```bash
grep -q "planner_task_id" \
  apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx \
  || { echo "FAIL: 未使用 planner_task_id query param"; exit 1; }
! grep -qE "EventSource.*[?&](taskId|task_id|pipeline_id|tid)=" \
  apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx \
  || { echo "FAIL: 使用了禁用 query param"; exit 1; }
echo "Step 1 OK"
```

**硬阈值**: 文件含 `planner_task_id`，不含禁用 query param 名

---

### Step 2: Brain SSE 端点推送 node_update 事件，字段严格符合 PRD schema

**可观测行为**: `GET /api/brain/harness/stream?planner_task_id={id}` 返回 `text/event-stream`，每条 `event: node_update` data JSON 包含 `node`/`label`/`attempt`/`ts` 四个字段

**验证命令**:
```bash
DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"
TASK_ID=$(psql "$DB" -t -c "
  INSERT INTO tasks (task_type, status, payload)
  VALUES ('harness_test_sse', 'completed', '{\"initiative_id\":\"test-sse-001\"}'::jsonb)
  RETURNING id" | tr -d ' \n')
psql "$DB" -c "INSERT INTO task_events (task_id, event_type, payload, created_at)
  VALUES ('$TASK_ID', 'graph_node_update',
    '{\"nodeName\":\"proposer\",\"attemptN\":1,\"payloadSummary\":{}}'::jsonb,
    NOW() - interval '2 seconds')" >/dev/null
EVENT_DATA=$(curl -N -s --max-time 6 \
  "localhost:5221/api/brain/harness/stream?planner_task_id=$TASK_ID" \
  | grep "^data:" | grep -v "event: done" | head -1 | sed 's/^data: //')
[ -n "$EVENT_DATA" ] || { echo "FAIL: 未收到 data 行"; exit 1; }
echo "$EVENT_DATA" | jq -e '.node | type == "string"' \
  || { echo "FAIL: node 字段缺失/非 string"; exit 1; }
echo "$EVENT_DATA" | jq -e '.label | type == "string"' \
  || { echo "FAIL: label 字段缺失/非 string"; exit 1; }
echo "$EVENT_DATA" | jq -e '.attempt >= 1' \
  || { echo "FAIL: attempt 字段缺失或 < 1"; exit 1; }
echo "$EVENT_DATA" | jq -e '.ts | type == "string"' \
  || { echo "FAIL: ts 字段缺失/非 string"; exit 1; }
psql "$DB" -c "DELETE FROM task_events WHERE task_id='$TASK_ID';
  DELETE FROM tasks WHERE id='$TASK_ID'" >/dev/null 2>&1 || true
echo "Step 2 OK"
```

**硬阈值**: 4 个 jq -e 断言全通过，exit 0

---

### Step 3: SSE data keys 精确等于 `["attempt","label","node","ts"]`，禁用字段不存在

**可观测行为**: node_update 事件 data JSON 顶层 keys 恰好为 `["attempt","label","node","ts"]`（字母序），无禁用字段 `nodeName`/`timestamp`/`name`/`type`/`payload`

**验证命令**:
```bash
DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"
TASK_ID=$(psql "$DB" -t -c "
  INSERT INTO tasks (task_type, status, payload)
  VALUES ('harness_test_sse2', 'completed', '{}'::jsonb)
  RETURNING id" | tr -d ' \n')
psql "$DB" -c "INSERT INTO task_events (task_id, event_type, payload, created_at)
  VALUES ('$TASK_ID', 'graph_node_update',
    '{\"nodeName\":\"generator\",\"attemptN\":2,\"payloadSummary\":{}}'::jsonb,
    NOW() - interval '2 seconds')" >/dev/null
EVENT_DATA=$(curl -N -s --max-time 6 \
  "localhost:5221/api/brain/harness/stream?planner_task_id=$TASK_ID" \
  | grep "^data:" | grep -v "event: done" | head -1 | sed 's/^data: //')
[ -n "$EVENT_DATA" ] || { echo "FAIL: 未收到 data"; exit 1; }
echo "$EVENT_DATA" | jq -e 'keys == ["attempt","label","node","ts"]' \
  || { echo "FAIL: keys 不精确，实际: $(echo $EVENT_DATA | jq 'keys')"; exit 1; }
echo "$EVENT_DATA" | jq -e 'has("nodeName") | not' \
  || { echo "FAIL: 禁用字段 nodeName 出现"; exit 1; }
echo "$EVENT_DATA" | jq -e 'has("timestamp") | not' \
  || { echo "FAIL: 禁用字段 timestamp 出现"; exit 1; }
echo "$EVENT_DATA" | jq -e 'has("name") | not' \
  || { echo "FAIL: 禁用字段 name 出现"; exit 1; }
psql "$DB" -c "DELETE FROM task_events WHERE task_id='$TASK_ID';
  DELETE FROM tasks WHERE id='$TASK_ID'" >/dev/null 2>&1 || true
echo "Step 3 OK"
```

**硬阈值**: keys 精确等于 `["attempt","label","node","ts"]`，3 个禁用字段反向检查通过

---

### Step 4: pipeline 完成时 SSE 发 `event: done`，data 含 `status`/`verdict`

**可观测行为**: task status = `completed` 时，SSE flush 历史后发送 `event: done\ndata: {"status":"completed","verdict":"PASS"}`，不含禁用字段 `result`/`type`/`event_type`

**验证命令**:
```bash
DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"
TASK_ID=$(psql "$DB" -t -c "
  INSERT INTO tasks (task_type, status, payload, result)
  VALUES ('harness_test_done', 'completed', '{}'::jsonb,
    '{\"verdict\":\"PASS\"}'::jsonb)
  RETURNING id" | tr -d ' \n')
STREAM=$(curl -N -s --max-time 6 \
  "localhost:5221/api/brain/harness/stream?planner_task_id=$TASK_ID")
echo "$STREAM" | grep -q "event: done" \
  || { echo "FAIL: 未发送 event: done"; exit 1; }
DONE_DATA=$(echo "$STREAM" | grep -A1 "event: done" \
  | grep "^data:" | head -1 | sed 's/^data: //')
echo "$DONE_DATA" | jq -e '.status == "completed" or .status == "failed"' \
  || { echo "FAIL: done data.status 不合规"; exit 1; }
echo "$DONE_DATA" | jq -e 'has("result") | not' \
  || { echo "FAIL: 禁用字段 result 出现在 done data"; exit 1; }
psql "$DB" -c "DELETE FROM tasks WHERE id='$TASK_ID'" >/dev/null 2>&1 || true
echo "Step 4 OK"
```

**硬阈值**: 含 `event: done`，data.status 合规，无禁用字段 `result`

---

### Step 5: error path — 缺参数 400，未知 ID 404

**可观测行为**:
- 缺 `planner_task_id` → HTTP 400，body `{"error": "..."}` 含 `error` key，不含 `message`/`msg`
- 未知 UUID → HTTP 404，body `{"error": "pipeline not found"}`

**验证命令**:
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "localhost:5221/api/brain/harness/stream")
[ "$CODE" = "400" ] || { echo "FAIL: 缺参数应 400，实返 $CODE"; exit 1; }
ERR_BODY=$(curl -s "localhost:5221/api/brain/harness/stream")
echo "$ERR_BODY" | jq -e '.error | type == "string"' \
  || { echo "FAIL: error 字段缺失"; exit 1; }
echo "$ERR_BODY" | jq -e 'has("message") | not' \
  || { echo "FAIL: 禁用字段 message 出现"; exit 1; }
CODE404=$(curl -s -o /dev/null -w "%{http_code}" \
  "localhost:5221/api/brain/harness/stream?planner_task_id=00000000-0000-0000-0000-000000000000")
[ "$CODE404" = "404" ] || { echo "FAIL: 未知 ID 应 404，实返 $CODE404"; exit 1; }
echo "Step 5 OK"
```

**硬阈值**: 400 含 `error` key 无 `message`；404 正确返回

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: user_facing

**完整验证脚本**:
```bash
#!/bin/bash
set -e

DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"

echo "=== Harness SSE Streaming E2E 验证 ==="

# 1. 静态：组件文件使用 planner_task_id
grep -q "planner_task_id" \
  apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx \
  || { echo "FAIL: 组件未使用 planner_task_id"; exit 1; }

# 2. 插入已完成 task + 多条历史事件
TASK_ID=$(psql "$DB" -t -c "
  INSERT INTO tasks (task_type, status, payload, result)
  VALUES ('harness_e2e', 'completed',
    '{\"initiative_id\":\"e2e-$(date +%s)\"}'::jsonb,
    '{\"verdict\":\"PASS\"}'::jsonb)
  RETURNING id" | tr -d ' \n')

for NODE in planner proposer reviewer generator; do
  psql "$DB" -c "INSERT INTO task_events (task_id, event_type, payload, created_at)
    VALUES ('$TASK_ID', 'graph_node_update',
      json_build_object('nodeName', '$NODE', 'attemptN', 1,
        'payloadSummary', '{}'::jsonb)::jsonb,
      NOW() - interval '10 seconds')" >/dev/null
done

# 3. 捕获完整 SSE stream
STREAM=$(curl -N -s --max-time 10 \
  "localhost:5221/api/brain/harness/stream?planner_task_id=$TASK_ID")

# 4. 至少 1 条 data 行
NODE_COUNT=$(echo "$STREAM" | grep "^data:" | wc -l | tr -d ' ')
[ "$NODE_COUNT" -ge 1 ] || { echo "FAIL: 未收到 node_update 事件 (got $NODE_COUNT)"; exit 1; }

# 5. 第一条 data 字段断言
FIRST=$(echo "$STREAM" | grep "^data:" | head -1 | sed 's/^data: //')
echo "$FIRST" | jq -e '.node | type == "string"' \
  || { echo "FAIL: node not string"; exit 1; }
echo "$FIRST" | jq -e '.label | type == "string"' \
  || { echo "FAIL: label not string"; exit 1; }
echo "$FIRST" | jq -e '.attempt >= 1' \
  || { echo "FAIL: attempt < 1"; exit 1; }
echo "$FIRST" | jq -e '.ts | type == "string"' \
  || { echo "FAIL: ts not string"; exit 1; }

# 6. keys 完整性
echo "$FIRST" | jq -e 'keys == ["attempt","label","node","ts"]' \
  || { echo "FAIL: keys 不精确，实际: $(echo $FIRST | jq 'keys')"; exit 1; }

# 7. 禁用字段反向验证
for BANNED in nodeName name timestamp time step phase stage type payload result event_type; do
  echo "$FIRST" | jq -e "has(\"$BANNED\") | not" \
    || { echo "FAIL: 禁用字段 $BANNED 出现"; exit 1; }
done

# 8. done 事件
echo "$STREAM" | grep -q "event: done" \
  || { echo "FAIL: 无 event: done"; exit 1; }

# 9. done data 字段
DONE_DATA=$(echo "$STREAM" | grep -A1 "event: done" \
  | grep "^data:" | head -1 | sed 's/^data: //')
echo "$DONE_DATA" | jq -e '.status == "completed" or .status == "failed"' \
  || { echo "FAIL: done.status 不合规"; exit 1; }

# 10. error path
CODE400=$(curl -s -o /dev/null -w "%{http_code}" \
  "localhost:5221/api/brain/harness/stream")
[ "$CODE400" = "400" ] || { echo "FAIL: 缺参数应 400，实返 $CODE400"; exit 1; }

# 11. 清理
psql "$DB" -c "DELETE FROM task_events WHERE task_id='$TASK_ID';
  DELETE FROM tasks WHERE id='$TASK_ID'" >/dev/null 2>&1 || true

echo "✅ E2E 全部验证通过"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 2

### Workstream 1: Brain SSE 端点

**范围**: 在 `packages/brain/src/routes/harness.js` 新增 `GET /stream` SSE 端点。从 `task_events` 表每 2s 轮询 `graph_node_update` 行，按 PRD schema 推送（`node`/`label`/`attempt`/`ts`）；task 完成/失败后发 `event: done`；每 30s 发 keepalive comment `: keepalive`；缺参数 400，未知 ID 404
**大小**: M (100-130 行)
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/sse-stream.test.ts`

---

### Workstream 2: Dashboard 实时日志区

**范围**: 在 `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx` 新增实时日志区 + EventSource hook。连接 `GET /api/brain/harness/stream?planner_task_id={id}`，渲染 node_update 列表（节点中文标签 + 时间），done 事件后显示"Pipeline 已完成 ✅"/"Pipeline 失败 ❌"
**大小**: M (100-150 行)
**依赖**: Workstream 1 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws2/harness-detail-page.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/sse-stream.test.ts` | SSE 路由存在 / 字段 schema / keys 完整性 / 禁用字段 / error path | WS1 → 4+ failures（路由不存在） |
| WS2 | `tests/ws2/harness-detail-page.test.ts` | EventSource planner_task_id / 禁用 param / EventSource 存在 / done 处理 | WS2 → 2+ failures（组件未改） |
