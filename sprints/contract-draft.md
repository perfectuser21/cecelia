# Sprint Contract Draft (Round 1)

## Golden Path

[用户打开 `/harness/{initiative_id}`] → [页面建立 `EventSource` 到 `/api/brain/harness/pipeline/:initiative_id/stream`] → [Brain flush 历史 `initiative_run_events` 事件（catchup）] → [Brain 每 2s 轮询新事件实时推 `event: node_update`] → [pipeline 完成推 `event: done` 并关闭连接]

---

### Step 1: 用户打开 Dashboard `/harness/{initiative_id}` 页面

**可观测行为**: 浏览器加载 `HarnessStreamPage`，页面向 `GET /api/brain/harness/pipeline/{initiative_id}/stream` 发起 `EventSource` 连接，服务端返回 HTTP 200 + `Content-Type: text/event-stream`

**验证命令**:
```bash
TEST_ID="00000000-0000-0000-0000-000000000001"
CT=$(curl -sI -H "Accept: text/event-stream" \
  "localhost:5221/api/brain/harness/pipeline/${TEST_ID}/stream" --max-time 3 \
  | grep -i "content-type" | head -1)
echo "$CT" | grep -iq "text/event-stream" || { echo "FAIL: Content-Type 不是 text/event-stream"; exit 1; }
echo "✅ Step 1: SSE 握手通过"
```

**硬阈值**: HTTP 200，Content-Type: text/event-stream

---

### Step 2: Brain catchup flush 历史事件

**可观测行为**: SSE 连接建立后，Brain 立即按 `created_at` 升序 flush 已存在的 `initiative_run_events` 历史记录，每条推送格式为 `event: node_update\ndata: {event_id,initiative_id,node,status,payload,ts}\n\n`

**验证命令**:
```bash
TEST_ID="00000000-0000-0000-0000-000000000001"
DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"
psql "$DB" -c "
  INSERT INTO initiative_run_events (event_id, initiative_id, node, status, payload)
  VALUES ('11111111-0000-0000-0000-000000000001', '${TEST_ID}', 'planner', 'completed', '{}')
  ON CONFLICT (event_id) DO NOTHING;
" 2>/dev/null || true
DATA=$(timeout 5 curl -N -sf -H "Accept: text/event-stream" \
  "localhost:5221/api/brain/harness/pipeline/${TEST_ID}/stream" 2>/dev/null \
  | grep "^data:" | head -1 | sed 's/^data: //')
echo "$DATA" | jq -e 'has("event_id") and has("initiative_id") and has("node") and has("status") and has("payload") and has("ts")' \
  || { echo "FAIL: node_update data 字段不完整"; exit 1; }
echo "✅ Step 2: catchup 事件 schema 通过"
```

**硬阈值**: 每条 data 包含 event_id/initiative_id/node/status/payload/ts 全 6 个必填字段

---

### Step 3: Brain 实时推送新事件（2s 轮询）

**可观测行为**: 新事件写入 `initiative_run_events` 后，REST 端点可立即返回；SSE 客户端在下一轮轮询（≤ 2s）后收到对应推送

**验证命令**:
```bash
TEST_ID="00000000-0000-0000-0000-000000000002"
DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"
psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, status) VALUES ('${TEST_ID}', 'proposer', 'running')" 2>/dev/null || true
RESP=$(curl -sf "localhost:5221/api/brain/harness/pipeline/${TEST_ID}/events")
echo "$RESP" | jq -e '.events | length > 0' || { echo "FAIL: 写入后 REST /events 未返回事件"; exit 1; }
echo "✅ Step 3: 实时写入可被读取"
```

**硬阈值**: 事件写入后通过 REST 端点即时可见；SSE 端点 ≤ 4s 推送

---

### Step 4: node 和 status 枚举严格验证

**可观测行为**: `node_update` 事件的 `node` 字段严格为 `planner|proposer|reviewer|generator|evaluator|report`；`status` 严格为 `pending|running|completed|failed`；禁用别名（如 `in_progress/done/step`）不出现

**验证命令**:
```bash
TEST_ID="00000000-0000-0000-0000-000000000001"
RESP=$(curl -sf "localhost:5221/api/brain/harness/pipeline/${TEST_ID}/events")
STATUS=$(echo "$RESP" | jq -r '.events[0].status')
echo "$STATUS" | grep -qE '^(pending|running|completed|failed)$' \
  || { echo "FAIL: 非法 status 值 $STATUS"; exit 1; }
NODE=$(echo "$RESP" | jq -r '.events[0].node')
echo "$NODE" | grep -qE '^(planner|proposer|reviewer|generator|evaluator|report)$' \
  || { echo "FAIL: 非法 node 值 $NODE"; exit 1; }
echo "$RESP" | jq -e '.events[0] | has("type") | not' || { echo "FAIL: 禁用字段 type 存在"; exit 1; }
echo "✅ Step 4: 枚举和禁用字段验证通过"
```

**硬阈值**: status/node 枚举合规；禁用字段 type/data/body/result 不存在于 node_update data

---

### Step 5: pipeline 完成后推 `event: done` 并关闭连接

**可观测行为**: Brain 确认 pipeline 终结后推 `event: done\ndata: {"status":"completed","verdict":"PASS"}\n\n`，SSE 连接随后关闭；done data 严格含 `status` 和 `verdict`，禁用 `result/outcome/state/message`

**验证命令**:
```bash
TEST_ID="00000000-0000-0000-0000-000000000001"
# 已完成 pipeline 的 SSE 应 flush 历史 + 推 done 后关闭
OUT=$(timeout 8 curl -N -sf -H "Accept: text/event-stream" \
  "localhost:5221/api/brain/harness/pipeline/${TEST_ID}/stream" 2>&1 || true)
echo "$OUT" | grep -q "event: done" || { echo "FAIL: 未收到 done 事件"; exit 1; }
DONE_DATA=$(echo "$OUT" | grep -A1 "event: done" | grep "^data:" | head -1 | sed 's/^data: //')
echo "$DONE_DATA" | jq -e 'has("status") and has("verdict")' || { echo "FAIL: done data 字段缺失"; exit 1; }
echo "$DONE_DATA" | jq -e 'has("result") | not' || { echo "FAIL: 禁用字段 result 出现在 done data"; exit 1; }
echo "$DONE_DATA" | jq -e 'has("message") | not' || { echo "FAIL: 禁用字段 message 出现在 done data"; exit 1; }
echo "✅ Step 5: done 事件 schema 通过"
```

**硬阈值**: event: done 推送后连接关闭；data keys ⊆ {status, verdict}

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: user_facing

**完整验证脚本**:
```bash
#!/bin/bash
set -e

DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"
TEST_ID="00000000-0000-0000-0000-000000000001"
UNKNOWN_ID="99999999-9999-9999-9999-999999999999"

# 1. 预置历史事件（幂等）
psql "$DB" -c "
  INSERT INTO initiative_run_events (event_id, initiative_id, node, status, payload)
  VALUES ('11111111-0000-0000-0000-000000000001', '${TEST_ID}', 'planner', 'completed', '{}')
  ON CONFLICT (event_id) DO NOTHING;
" 2>/dev/null || true

# 2. REST /events 字段完整性（event_id/initiative_id/node/status/payload/ts 全 6 项）
RESP=$(curl -sf "localhost:5221/api/brain/harness/pipeline/${TEST_ID}/events")
echo "$RESP" | jq -e '.events | length > 0' || { echo "FAIL: /events 返回空"; exit 1; }
echo "$RESP" | jq -e '.events[0] | has("event_id") and has("initiative_id") and has("node") and has("status") and has("payload") and has("ts")' \
  || { echo "FAIL: /events 事件字段不完整"; exit 1; }

# 3. REST /events 顶层 schema 完整性 — keys 恰好 == ["events"]
echo "$RESP" | jq -e 'keys == ["events"]' || { echo "FAIL: /events 顶层 keys 不合规"; exit 1; }

# 4. 禁用顶层字段不存在（data/result/items/records/rows）
echo "$RESP" | jq -e 'has("data") | not' || { echo "FAIL: 禁用顶层字段 data 存在"; exit 1; }
echo "$RESP" | jq -e 'has("result") | not' || { echo "FAIL: 禁用顶层字段 result 存在"; exit 1; }
echo "$RESP" | jq -e 'has("items") | not' || { echo "FAIL: 禁用顶层字段 items 存在"; exit 1; }

# 5. node_update 事件禁用字段不存在（type/data/body/event_type）
echo "$RESP" | jq -e '.events[0] | has("type") | not' || { echo "FAIL: 禁用字段 type 存在"; exit 1; }
echo "$RESP" | jq -e '.events[0] | has("data") | not' || { echo "FAIL: 禁用字段 data 存在"; exit 1; }
echo "$RESP" | jq -e '.events[0] | has("timestamp") | not' || { echo "FAIL: 禁用字段 timestamp 存在（应用 ts）"; exit 1; }

# 6. SSE /stream 推送 event: node_update
SSE_OUT=$(timeout 6 curl -N -sf -H "Accept: text/event-stream" \
  "localhost:5221/api/brain/harness/pipeline/${TEST_ID}/stream" 2>&1 || true)
echo "$SSE_OUT" | grep -q "event: node_update" || { echo "FAIL: SSE 未推 node_update"; exit 1; }

# 7. SSE node_update data 字段完整性
SSE_DATA=$(echo "$SSE_OUT" | grep "^data:" | head -1 | sed 's/^data: //')
echo "$SSE_DATA" | jq -e 'has("event_id") and has("initiative_id") and has("node") and has("status") and has("payload") and has("ts")' \
  || { echo "FAIL: SSE node_update data 字段不完整"; exit 1; }

# 8. 404 路径 — 不存在 initiative_id 返 404 + {"error":"..."}
CODE=$(curl -sf -o /tmp/err404.json -w "%{http_code}" \
  "localhost:5221/api/brain/harness/pipeline/${UNKNOWN_ID}/events" 2>/dev/null || echo "404")
[ "$CODE" = "404" ] || { echo "FAIL: 未知 id 应返 404，实际 $CODE"; exit 1; }
cat /tmp/err404.json | jq -e 'has("error")' || { echo "FAIL: 404 body 缺 error 字段"; exit 1; }
cat /tmp/err404.json | jq -e 'has("message") | not' || { echo "FAIL: 禁用字段 message 出现在 404 body"; exit 1; }

# 9. after_event_id 断线重连参数不报错（有效性验证）
LAST_EID=$(echo "$RESP" | jq -r '.events[-1].event_id // empty')
if [ -n "$LAST_EID" ]; then
  CODE2=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 3 \
    -H "Accept: text/event-stream" \
    "localhost:5221/api/brain/harness/pipeline/${TEST_ID}/stream?after_event_id=${LAST_EID}" 2>/dev/null || echo "200")
  [ "$CODE2" != "400" ] || { echo "FAIL: after_event_id 参数被拒绝 400"; exit 1; }
fi

echo "✅ E2E Golden Path 全部 9 项验证通过"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 3

### Workstream 1: DB Migration — initiative_run_events 表

**范围**: 创建 `packages/brain/src/db/migrations/010-initiative-run-events.sql`，建表 DDL + 复合索引
**大小**: S（<30 行，1 文件）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/migration.test.ts`

---

### Workstream 2: Brain SSE + REST 端点

**范围**: 在 `packages/brain/src/routes/harness.js` 新增 `/pipeline/:initiative_id/stream`（SSE）和 `/pipeline/:initiative_id/events`（REST）
**大小**: M（150-180 行净增，1 文件）
**依赖**: Workstream 1 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws2/brain-endpoints.test.ts`

---

### Workstream 3: Dashboard HarnessStreamPage + 路由注册

**范围**: 新建 `apps/dashboard/src/pages/harness/HarnessStreamPage.tsx`；在 `apps/api/features/system-hub/index.ts` 新增 `/harness/:id` 路由
**大小**: M（120-150 行净增，2 文件）
**依赖**: Workstream 2 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws3/harness-stream-page.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/migration.test.ts` | 表结构/列/索引/CHECK 约束 | 4 failures（表不存在）|
| WS2 | `tests/ws2/brain-endpoints.test.ts` | REST schema/SSE 格式/404/禁用字段/done 事件 | 6 failures（路由不存在）|
| WS3 | `tests/ws3/harness-stream-page.test.ts` | 文件存在/路由注册/EventSource 引用 | 3 failures（文件不存在）|
