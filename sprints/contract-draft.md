# Sprint Contract Draft (Round 1)

## Golden Path

[用户导航至 Dashboard `/harness/{initiative_id}`] → [浏览器向 `GET /api/brain/initiatives/:id/events` 建立 EventSource 连接] → [Brain flush 已有 `initiative_run_events` 历史行（每行为一条 SSE data）] → [harness 节点状态变更时实时推送新事件] → [页面渲染节点列表（节点名 + 状态 + 时间戳），无需刷新]

---

### Step 1: DB schema 就绪 — initiative_run_events 表

**可观测行为**: PostgreSQL 中存在 `initiative_run_events` 表，含 `id/initiative_id/node/status/payload/created_at` 列，复合索引 `(initiative_id, created_at)`，DDL 严格按 PRD

**验证命令**:
```bash
DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"
psql "$DB" -c "\dt initiative_run_events" | grep -q "initiative_run_events" \
  || { echo "FAIL: 表不存在"; exit 1; }
psql "$DB" -c "SELECT column_name FROM information_schema.columns WHERE table_name='initiative_run_events'" \
  | grep -qE "node|status|created_at" \
  || { echo "FAIL: 必填列缺失"; exit 1; }
echo "✅ Step 1: DB schema 就绪"
```

**硬阈值**: 表存在，含 PRD DDL 全部列

---

### Step 2: SSE 端点就绪 — GET /api/brain/initiatives/:id/events

**可观测行为**: Brain 返回 `Content-Type: text/event-stream`；已存在的 `initiative_run_events` 行按 `created_at` 升序 flush；每条 data JSON 键恰好为 `["event","node","status","ts"]`，`event` 严格等于 `"node_update"`

**验证命令**:
```bash
DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"
IID="e0000002-0000-0000-0000-000000000001"
psql "$DB" -c "INSERT INTO initiative_runs (initiative_id, phase) VALUES ('$IID'::uuid, 'done')" 2>/dev/null || true
psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, status) VALUES ('$IID'::uuid, 'planner', 'done')" 2>/dev/null || true
CT=$(curl -sI -H "Accept: text/event-stream" "localhost:5221/api/brain/initiatives/$IID/events" --max-time 3 | grep -i content-type | head -1)
echo "$CT" | grep -iq "text/event-stream" || { echo "FAIL: Content-Type: $CT"; exit 1; }
SSE=$(timeout 6 curl -N -s -H "Accept: text/event-stream" "localhost:5221/api/brain/initiatives/$IID/events" 2>/dev/null || true)
DATA=$(echo "$SSE" | grep "^data:" | head -1 | sed 's/^data: //')
echo "$DATA" | jq -e '.event == "node_update"' || { echo "FAIL: event != node_update"; exit 1; }
echo "$DATA" | jq -e 'keys == ["event","node","status","ts"]' || { echo "FAIL: schema keys 不符"; exit 1; }
echo "✅ Step 2: SSE 端点就绪"
```

**硬阈值**: Content-Type: text/event-stream；data keys 恰好 `["event","node","status","ts"]`；event = `"node_update"`

---

### Step 3: harness 图节点写入 initiative_run_events

**可观测行为**: `harness-initiative.graph.js` 在各节点（planner/proposer/reviewer/generator/evaluator/e2e）状态变更时，向 `initiative_run_events` 插入行，`node` 严格使用 PRD 枚举，`status` 严格使用 `started|running|done|failed`

**验证命令**:
```bash
grep -q "initiative_run_events" packages/brain/src/workflows/harness-initiative.graph.js \
  || { echo "FAIL: graph.js 未引用 initiative_run_events"; exit 1; }
grep -qE '"planner"|'"'"'planner'"'" packages/brain/src/workflows/harness-initiative.graph.js \
  || { echo "FAIL: graph.js 未写 planner 节点名"; exit 1; }
grep -qE '"started"|"running"|"done"|"failed"' packages/brain/src/workflows/harness-initiative.graph.js \
  || { echo "FAIL: graph.js 未写合法 status"; exit 1; }
echo "✅ Step 3: graph.js 写入逻辑存在"
```

**硬阈值**: graph.js 引用 initiative_run_events；写入合法节点名和 status 枚举

---

### Step 4: Dashboard /harness/:id 实时渲染

**可观测行为**: `/harness/{initiative_id}` 渲染 `HarnessRunPage` 组件；组件通过 `EventSource` 建立 SSE 连接至 `/api/brain/initiatives/:id/events`；接收 `node_update` 事件后更新节点列表显示

**验证命令**:
```bash
test -f "apps/dashboard/src/pages/harness/HarnessRunPage.tsx" \
  || { echo "FAIL: HarnessRunPage.tsx 不存在"; exit 1; }
grep -q "EventSource" "apps/dashboard/src/pages/harness/HarnessRunPage.tsx" \
  || { echo "FAIL: 未使用 EventSource"; exit 1; }
grep -q "api/brain/initiatives" "apps/dashboard/src/pages/harness/HarnessRunPage.tsx" \
  || { echo "FAIL: SSE URL 路径不正确"; exit 1; }
grep -q "node_update" "apps/dashboard/src/pages/harness/HarnessRunPage.tsx" \
  || { echo "FAIL: 未处理 node_update 事件"; exit 1; }
echo "✅ Step 4: Dashboard 页面验证通过"
```

**硬阈值**: 文件存在；使用 EventSource 连至 `/api/brain/initiatives/:id/events`；处理 `node_update` 事件

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: user_facing

**完整验证脚本**:
```bash
#!/bin/bash
set -e
DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"
IID="e0000099-0000-0000-0000-000000000001"
UNKNOWN_ID="99999999-9999-9999-9999-999999999999"

# 1. DB 表存在
psql "$DB" -c "\dt initiative_run_events" | grep -q "initiative_run_events" \
  || { echo "FAIL: initiative_run_events 表不存在"; exit 1; }

# 2. 预置：done 态 initiative（flush 后 SSE 连接自动关闭）
psql "$DB" -c "INSERT INTO initiative_runs (initiative_id, phase) VALUES ('$IID'::uuid, 'done')" 2>/dev/null || true
psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, status) VALUES ('$IID'::uuid, 'planner', 'done')" 2>/dev/null || true

# 3. SSE Content-Type
CT=$(curl -sI -H "Accept: text/event-stream" "localhost:5221/api/brain/initiatives/$IID/events" --max-time 3 | grep -i content-type | head -1)
echo "$CT" | grep -iq "text/event-stream" || { echo "FAIL: Content-Type: $CT"; exit 1; }

# 4. SSE 数据捕获
SSE=$(timeout 7 curl -N -s -H "Accept: text/event-stream" "localhost:5221/api/brain/initiatives/$IID/events" 2>/dev/null || true)
DATA=$(echo "$SSE" | grep "^data:" | head -1 | sed 's/^data: //')
[ -n "$DATA" ] || { echo "FAIL: 无 data 行"; exit 1; }

# 5. event 字段严格 = "node_update"
echo "$DATA" | jq -e '.event == "node_update"' || { echo "FAIL: event != node_update"; exit 1; }

# 6. node 字段合法枚举
echo "$DATA" | jq -e '.node | test("^(planner|proposer|reviewer|generator|evaluator|e2e)$")' \
  || { echo "FAIL: 非法 node 值"; exit 1; }

# 7. status 字段合法枚举
echo "$DATA" | jq -e '.status | test("^(started|running|done|failed)$")' \
  || { echo "FAIL: 非法 status 值"; exit 1; }

# 8. ts 字段是 number
echo "$DATA" | jq -e '.ts | type == "number"' || { echo "FAIL: ts 非 number"; exit 1; }

# 9. Schema 完整性：keys 恰好 ["event","node","status","ts"]
echo "$DATA" | jq -e 'keys == ["event","node","status","ts"]' \
  || { echo "FAIL: schema keys 不符"; exit 1; }

# 10. 禁用字段 timestamp 不存在
echo "$DATA" | jq -e 'has("timestamp") | not' || { echo "FAIL: 禁用字段 timestamp 存在"; exit 1; }

# 11. 禁用字段 time 不存在
echo "$DATA" | jq -e 'has("time") | not' || { echo "FAIL: 禁用字段 time 存在"; exit 1; }

# 12. 禁用字段 created_at 不存在
echo "$DATA" | jq -e 'has("created_at") | not' || { echo "FAIL: 禁用字段 created_at 存在"; exit 1; }

# 13. 禁用字段 t 不存在
echo "$DATA" | jq -e 'has("t") | not' || { echo "FAIL: 禁用字段 t 存在"; exit 1; }

# 14. event 禁用别名反向
echo "$DATA" | jq -e '.event | IN("update","change","status_change") | not' \
  || { echo "FAIL: 禁用 event 别名"; exit 1; }

# 15. node 禁用别名反向
echo "$DATA" | jq -e '.node | IN("agent","step","phase") | not' \
  || { echo "FAIL: 禁用 node 别名"; exit 1; }

# 16. status 禁用别名反向
echo "$DATA" | jq -e '.status | IN("success","complete","error","pending") | not' \
  || { echo "FAIL: 禁用 status 别名"; exit 1; }

# 17. 404：未知 initiative
CODE=$(curl -sf -o /tmp/sse_err404.json -w "%{http_code}" \
  "localhost:5221/api/brain/initiatives/$UNKNOWN_ID/events" --max-time 3 2>/dev/null || echo "000")
[ "$CODE" = "404" ] || { echo "FAIL: 未知 initiative 应返 404，实际 $CODE"; exit 1; }

# 18. 404 body error 字段存在（string 类型）
jq -e '.error | type == "string"' /tmp/sse_err404.json \
  || { echo "FAIL: 404 body 缺 error 字段"; exit 1; }

# 19. 404 body 禁用字段 message 不存在
jq -e 'has("message") | not' /tmp/sse_err404.json \
  || { echo "FAIL: 禁用字段 message 在 404 body"; exit 1; }

# 20. 404 body 禁用字段 msg 不存在
jq -e 'has("msg") | not' /tmp/sse_err404.json \
  || { echo "FAIL: 禁用字段 msg 在 404 body"; exit 1; }

# 21. 404 body 禁用字段 reason 不存在
jq -e 'has("reason") | not' /tmp/sse_err404.json \
  || { echo "FAIL: 禁用字段 reason 在 404 body"; exit 1; }

# 22. Dashboard 文件存在
test -f "apps/dashboard/src/pages/harness/HarnessRunPage.tsx" \
  || { echo "FAIL: HarnessRunPage.tsx 不存在"; exit 1; }

# 23. HarnessRunPage 使用正确 SSE 端点 URL
grep -q "api/brain/initiatives" "apps/dashboard/src/pages/harness/HarnessRunPage.tsx" \
  || { echo "FAIL: 未连接正确 SSE 端点"; exit 1; }

# 24. graph.js 写入 initiative_run_events
grep -q "initiative_run_events" "packages/brain/src/workflows/harness-initiative.graph.js" \
  || { echo "FAIL: graph.js 未写 initiative_run_events"; exit 1; }

echo "✅ Golden Path E2E 全部 24 项验证通过"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 4

### Workstream 1: DB Migration — initiative_run_events 表

**范围**: 创建 `packages/brain/migrations/276_initiative_run_events.sql`，DDL 严格按 PRD（id uuid PK, initiative_id uuid NOT NULL, node varchar(32) NOT NULL, status varchar(16) NOT NULL, payload jsonb, created_at timestamptz NOT NULL + 复合索引）
**大小**: S（<35 行，1 文件）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/migration.test.ts`

---

### Workstream 2: Brain SSE 端点 — GET /api/brain/initiatives/:id/events

**范围**: 新增 `packages/brain/src/routes/initiative-events-routes.js`（SSE 端点全量实现：历史 flush + 实时推送 + 404 处理）；更新 `packages/brain/server.js` 注册路由至 `/api/brain/initiatives`
**大小**: M（~160 行净增，2 文件）
**依赖**: Workstream 1 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws2/brain-sse-endpoint.test.ts`

---

### Workstream 3: harness-initiative.graph.js 节点事件写入

**范围**: 更新 `packages/brain/src/workflows/harness-initiative.graph.js`，各节点状态变更时向 `initiative_run_events` 写入行（node/status 严格使用 PRD 枚举，ts 字段由 created_at 推导）
**大小**: M（~80 行净增，1 文件）
**依赖**: Workstream 1 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws3/harness-graph-writes.test.ts`

---

### Workstream 4: Dashboard HarnessRunPage + 路由注册

**范围**: 新建 `apps/dashboard/src/pages/harness/HarnessRunPage.tsx`（EventSource 接入 + 节点列表渲染）；在 `apps/dashboard/src/App.tsx` DynamicRouter 注册 `/harness/:id` 静态路由
**大小**: M（~180 行净增，2 文件）
**依赖**: Workstream 2 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws4/harness-run-page.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/migration.test.ts` | 表存在/列完整/有效插入/NOT NULL 约束 | 4 failures（迁移文件不存在）|
| WS2 | `tests/ws2/brain-sse-endpoint.test.ts` | event 字段/keys 完整/ts 类型/404 error | 5 failures（路由不存在）|
| WS3 | `tests/ws3/harness-graph-writes.test.ts` | 写入调用/node 枚举/status 枚举/禁用别名 | 4 failures（写入逻辑不存在）|
| WS4 | `tests/ws4/harness-run-page.test.ts` | 文件存在/EventSource/端点 URL/node_update | 4 failures（文件不存在）|
