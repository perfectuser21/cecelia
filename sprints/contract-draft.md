# Sprint Contract Draft (Round 1)

## Golden Path

[用户打开 `/harness/:id`] → [HarnessDetailPage 建立 EventSource 连接到 `GET /api/brain/harness/stream?initiative_id={id}`] → [Brain SSE 从 `initiative_run_events` 表 2s 轮询推 `event: node_update`] → [前端实时追加节点行（node + ts）] → [`status=done` 行触发 SSE 推 `event: done` → 页面显示"Pipeline 已完成"或"Pipeline 失败"]

---

### Step 1: `initiative_run_events` 表就绪，可写入节点事件

**可观测行为**: psql 可查到表结构；含 node/label/attempt/ts/status/verdict 列；(initiative_id, ts) 索引存在；可插入 node_update 行

**验证命令**:
```bash
DB="${DATABASE_URL:-postgresql://localhost/cecelia}"
psql "$DB" -c "\d initiative_run_events" | grep -q "node" && echo "TABLE_OK"
psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, label, attempt) \
  VALUES ('aaaaaaaa-bbbb-cccc-dddd-ee0000000001', 'proposer', 'Proposer', 1) \
  RETURNING id" | grep -q "[0-9]" && echo "INSERT_OK"
psql "$DB" -t -c "SELECT indexname FROM pg_indexes WHERE tablename='initiative_run_events'" \
  | grep -q "initiative_run_events" && echo "INDEX_OK"
```

**硬阈值**: TABLE_OK + INSERT_OK + INDEX_OK

---

### Step 2: Brain SSE 端点推 node_update 事件，data 严格符合 schema

**可观测行为**: `GET /api/brain/harness/stream?initiative_id={id}` 返回 `text/event-stream`；推送 `event: node_update`；data JSON 含且仅含 `node`/`label`/`attempt`/`ts` 字段；禁用字段 `name`/`step`/`timestamp` 不存在

**验证命令**:
```bash
DB="${DATABASE_URL:-postgresql://localhost/cecelia}"
IAID="bbbbbbbb-cccc-dddd-eeee-ff0000000001"
psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, label, attempt) \
  VALUES ('$IAID', 'proposer', 'Proposer', 1) ON CONFLICT DO NOTHING" 2>/dev/null || true
SSE=$(curl -s --max-time 6 "localhost:5221/api/brain/harness/stream?initiative_id=$IAID" 2>&1 || true)
echo "$SSE" | grep -q "event: node_update" && echo "EVENT_OK"
DATA=$(echo "$SSE" | grep "^data:" | grep -v "keepalive" | head -1 | sed 's/^data: //')
echo "$DATA" | jq -e '.node | type == "string"' && echo "NODE_OK"
echo "$DATA" | jq -e '.label | type == "string"' && echo "LABEL_OK"
echo "$DATA" | jq -e '.attempt | type == "number"' && echo "ATTEMPT_OK"
echo "$DATA" | jq -e '.ts | type == "string"' && echo "TS_OK"
echo "$DATA" | jq -e 'keys | sort == ["attempt","label","node","ts"]' && echo "SCHEMA_COMPLETE_OK"
echo "$DATA" | jq -e 'has("name") | not' && echo "NO_FORBIDDEN_NAME"
echo "$DATA" | jq -e 'has("timestamp") | not' && echo "NO_FORBIDDEN_TIMESTAMP"
```

**硬阈值**: EVENT_OK + 6 个字段/schema/禁用字段验证全过

---

### Step 3: initiative_id 不合法时 SSE 端点返回正确错误

**可观测行为**: `initiative_id` 不存在 → HTTP 404 `{"error":"..."}`；缺 `initiative_id` → HTTP 400 `{"error":"..."}`；`message`/`msg` 不存在

**验证命令**:
```bash
CODE_404=$(curl -s -o /tmp/err404.json -w "%{http_code}" \
  "localhost:5221/api/brain/harness/stream?initiative_id=00000000-0000-0000-0000-000000000000")
[ "$CODE_404" = "404" ] && echo "404_OK"
jq -e '.error | type == "string"' /tmp/err404.json && echo "ERROR_FIELD_OK"
jq -e 'has("message") | not' /tmp/err404.json && echo "NO_MESSAGE_OK"

CODE_400=$(curl -s -o /tmp/err400.json -w "%{http_code}" \
  "localhost:5221/api/brain/harness/stream")
[ "$CODE_400" = "400" ] && echo "400_OK"
jq -e '.error | type == "string"' /tmp/err400.json && echo "400_ERROR_FIELD_OK"
```

**硬阈值**: 404_OK + ERROR_FIELD_OK + NO_MESSAGE_OK + 400_OK + 400_ERROR_FIELD_OK

---

### Step 4: executor.js emitGraphNodeUpdate 同步写入 initiative_run_events

**可观测行为**: `writeInitiativeRunEvent` helper 可直接调用；调用后 1 分钟内 `initiative_run_events` 有对应行；node/attempt 字段值正确

**验证命令**:
```bash
DB="${DATABASE_URL:-postgresql://localhost/cecelia}"
IAID="cccccccc-dddd-eeee-ffff-aa0000000001"
node -e "
const m = require('./packages/brain/src/events/initiativeRunEvents.js');
m.writeInitiativeRunEvent({initiativeId:'$IAID',node:'proposer',label:'Proposer',attempt:1})
  .then(()=>{console.log('WRITE_OK');process.exit(0);})
  .catch(e=>{console.error(e.message);process.exit(1);});
"
COUNT=$(psql "$DB" -t -c "SELECT count(*) FROM initiative_run_events \
  WHERE initiative_id='$IAID' AND created_at > NOW() - interval '1 minute'" | tr -d ' ')
[ "$COUNT" -ge 1 ] && echo "DB_ROW_OK"
```

**硬阈值**: WRITE_OK + DB_ROW_OK

---

### Step 5: Dashboard /harness/:id 页面建立 SSE 连接，实时显示节点日志

**可观测行为**: 浏览器打开 `/harness/{id}`，页面含 `data-testid="realtime-log"` 实时日志区；EventSource URL 含 `initiative_id={id}` 参数（禁用 `taskId`/`task_id`/`id`）；收到 node_update 后追加 `data-testid="log-entry"` 节点行

**验证命令**（Playwright）:
```typescript
await page.goto(`http://localhost:5173/harness/${INIT_ID}`);
await expect(page.locator('[data-testid="realtime-log"]')).toBeVisible({ timeout: 5000 });
await expect(page.locator('[data-testid="log-entry"]').first()).toBeVisible({ timeout: 8000 });
```

**硬阈值**: 页面渲染成功，realtime-log 和至少一条 log-entry 可见

---

### Step 6: pipeline 完成 → event: done → 页面显示完成状态

**可观测行为**: `initiative_run_events` 插入 `status=done` 行后，SSE 推 `event: done`，data 含 `status`/`verdict` 字段；前端显示"Pipeline 已完成"或"Pipeline 失败"

**验证命令**:
```bash
DB="${DATABASE_URL:-postgresql://localhost/cecelia}"
IAID="bbbbbbbb-cccc-dddd-eeee-ff0000000004"
psql "$DB" -c "INSERT INTO initiative_run_events \
  (initiative_id, node, label, attempt, status, verdict) \
  VALUES ('$IAID', 'report', 'Report', 1, 'done', 'PASS') ON CONFLICT DO NOTHING"
SSE=$(curl -s --max-time 8 "localhost:5221/api/brain/harness/stream?initiative_id=$IAID" 2>&1 || true)
echo "$SSE" | grep -q "event: done" && echo "DONE_EVENT_OK"
DONE_DATA=$(echo "$SSE" | grep -A1 "event: done" | grep "^data:" | head -1 | sed 's/^data: //')
echo "$DONE_DATA" | jq -e '.status | . == "completed" or . == "failed"' && echo "STATUS_FIELD_OK"
echo "$DONE_DATA" | jq -e '.verdict | . == "PASS" or . == "FAIL" or . == null' && echo "VERDICT_FIELD_OK"
```

**硬阈值**: DONE_EVENT_OK + STATUS_FIELD_OK + VERDICT_FIELD_OK

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: user_facing

**完整验证脚本**:
```bash
#!/bin/bash
set -e

DB="${DATABASE_URL:-postgresql://localhost/cecelia}"
IAID=$(python3 -c "import uuid; print(str(uuid.uuid4()))" 2>/dev/null \
  || cat /proc/sys/kernel/random/uuid 2>/dev/null \
  || echo "e2etest1-0000-0000-$(date +%s | tail -c 4)-$(date +%s)aa")

# 1. 表存在
psql "$DB" -c "\d initiative_run_events" > /dev/null 2>&1 \
  || { echo "FAIL: initiative_run_events 表不存在"; exit 1; }

# 2. 插入 node_update 行
psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, label, attempt) \
  VALUES ('$IAID', 'proposer', 'Proposer', 1)"

# 3. SSE 推 node_update
SSE=$(curl -s --max-time 6 "localhost:5221/api/brain/harness/stream?initiative_id=$IAID" 2>&1 || true)
echo "$SSE" | grep -q "event: node_update" \
  || { echo "FAIL: 无 node_update 事件，SSE 输出=$SSE"; exit 1; }

# 4. node_update data schema 完整性（恰好 4 字段）
DATA=$(echo "$SSE" | grep "^data:" | grep -v "keepalive" | head -1 | sed 's/^data: //')
echo "$DATA" | jq -e 'keys | sort == ["attempt","label","node","ts"]' \
  || { echo "FAIL: node_update schema 不符，实际=$(echo "$DATA" | jq -c 'keys')"; exit 1; }

# 5. 字段值类型
echo "$DATA" | jq -e '.node | type == "string"' || { echo "FAIL: node 非 string"; exit 1; }
echo "$DATA" | jq -e '.label | type == "string"' || { echo "FAIL: label 非 string"; exit 1; }
echo "$DATA" | jq -e '.attempt | type == "number"' || { echo "FAIL: attempt 非 number"; exit 1; }
echo "$DATA" | jq -e '.ts | type == "string"' || { echo "FAIL: ts 非 string"; exit 1; }

# 6. 禁用字段反向
echo "$DATA" | jq -e 'has("name") | not' || { echo "FAIL: 禁用字段 name 存在"; exit 1; }
echo "$DATA" | jq -e 'has("timestamp") | not' || { echo "FAIL: 禁用字段 timestamp 存在"; exit 1; }
echo "$DATA" | jq -e 'has("step") | not' || { echo "FAIL: 禁用字段 step 存在"; exit 1; }

# 7. done 事件
psql "$DB" -c "INSERT INTO initiative_run_events \
  (initiative_id, node, label, attempt, status, verdict) \
  VALUES ('$IAID', 'report', 'Report', 1, 'done', 'PASS')"
SSE2=$(curl -s --max-time 8 "localhost:5221/api/brain/harness/stream?initiative_id=$IAID" 2>&1 || true)
echo "$SSE2" | grep -q "event: done" || { echo "FAIL: 无 done 事件"; exit 1; }
DONE_DATA=$(echo "$SSE2" | grep -A1 "event: done" | grep "^data:" | head -1 | sed 's/^data: //')
echo "$DONE_DATA" | jq -e '.status | . == "completed" or . == "failed"' \
  || { echo "FAIL: done.status 不合法"; exit 1; }
echo "$DONE_DATA" | jq -e '.verdict | . == "PASS" or . == "FAIL" or . == null' \
  || { echo "FAIL: done.verdict 不合法"; exit 1; }

# 8. error path — unknown initiative_id → 404
ECODE=$(curl -s -o /tmp/e2e_err.json -w "%{http_code}" \
  "localhost:5221/api/brain/harness/stream?initiative_id=00000000-0000-0000-0000-000000000000")
[ "$ECODE" = "404" ] || { echo "FAIL: 未知 initiative_id 应 404，实际 $ECODE"; exit 1; }
jq -e '.error | type == "string"' /tmp/e2e_err.json \
  || { echo "FAIL: 404 body 缺 error 字段"; exit 1; }
jq -e 'has("message") | not' /tmp/e2e_err.json \
  || { echo "FAIL: 404 body 含禁用字段 message"; exit 1; }

# 9. error path — 缺 initiative_id → 400
ECODE2=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/stream")
[ "$ECODE2" = "400" ] || { echo "FAIL: 缺 initiative_id 应 400，实际 $ECODE2"; exit 1; }

echo "✅ E2E Golden Path 全过"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 4

### Workstream 1: DB Migration — initiative_run_events 表

**范围**: 新建 `initiative_run_events` 表 + `(initiative_id, ts)` 索引的 migration SQL 文件
**大小**: S(<100行)
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/migration.test.ts`

---

### Workstream 2: Brain SSE 端点

**范围**: `packages/brain/src/routes/harness.js` 新增 `GET /stream`（initiative_id 参数校验，2s 轮询 initiative_run_events 表，30s keepalive）+ `packages/brain/src/events/initiativeRunEvents.js` 事件写入 helper
**大小**: M(100-300行)
**依赖**: Workstream 1 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws2/sse.test.ts`

---

### Workstream 3: executor.js 写入 initiative_run_events

**范围**: `packages/brain/src/executor.js` 内 `emitGraphNodeUpdate` 同步调用 `writeInitiativeRunEvent`
**大小**: S(<100行)
**依赖**: Workstream 1 + Workstream 2 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws3/executor.test.ts`

---

### Workstream 4: Dashboard HarnessDetailPage

**范围**: `apps/dashboard/src/pages/harness/HarnessDetailPage.tsx`（新建，含 EventSource 实时日志区）+ router 注册 `/harness/:id`
**大小**: M(100-300行)
**依赖**: Workstream 2 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws4/harness-detail-page.test.ts`

---

## Workstreams 切分验证

| WS | 文件数 | 预估行数 | 依赖 |
|---|---|---|---|
| WS1 | 1 | ~30 行 | — |
| WS2 | 2 | ~180 行 | WS1 |
| WS3 | 1 | ~40 行 | WS1, WS2 |
| WS4 | 2 | ~160 行 | WS2 |

各 WS 均 ≤ 200 行 + ≤ 3 文件 ✓

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/migration.test.ts` | 表结构、索引、INSERT 成功 | 2 failures（表不存在） |
| WS2 | `tests/ws2/sse.test.ts` | SSE 连接、node_update schema、禁用字段、error path | 4 failures（端点不存在） |
| WS3 | `tests/ws3/executor.test.ts` | writeInitiativeRunEvent 写入、字段值 | 2 failures（helper 不存在） |
| WS4 | `tests/ws4/harness-detail-page.test.ts` | 页面渲染、EventSource URL、log-entry 可见 | 3 failures（组件不存在） |
