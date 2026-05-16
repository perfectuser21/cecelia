# Sprint PRD — Harness Pipeline 实时 Streaming 前台可见性

## OKR 对齐

- **对应 KR**：KR-3（Harness 系统可观测性与研发效率）
- **当前进度**：待 Brain API 确认
- **本次推进预期**：dashboard 用户实时看到 harness pipeline 每个节点执行状态，无需手动刷新

## 背景

Harness pipeline 执行期间，前台 `/pipeline/:id` 详情页仅在加载时获取一次快照，用户无法实时感知各节点（Planner → Proposer → Reviewer → Generator → Evaluator）推进过程，debug 体验差。本 sprint 新增专用事件表 `initiative_run_events` + Brain SSE 端点 + Dashboard `/harness/:id` 实时流页面，打通从执行层到用户视野的可见性链路。

## Golden Path（核心场景）

用户从 Dashboard 进入 `/harness/{initiative_id}` → 页面建立 SSE 连接 → 实时看到每个节点状态更新 → pipeline 结束后连接自动关闭。

具体步骤：

1. **触发条件**：用户打开 Dashboard `/harness/{initiative_id}` 页面（initiative_id = planner task UUID）
2. **系统处理（catchup）**：页面建立 `EventSource` 到 `GET /api/brain/harness/pipeline/:initiative_id/stream`，Brain 先 flush 已存在的 `initiative_run_events` 历史记录（按 `created_at` 升序）
3. **系统处理（实时推送）**：Brain 轮询 `initiative_run_events` 新行（每 2s），推送 `event: node_update\ndata: <JSON>\n\n`，每 30s 发 keepalive comment `: keepalive\n\n`
4. **可观测结果**：用户看到节点卡片依次从 `pending → running → completed/failed`，含时间戳和错误摘要
5. **结束**：Brain 检测到 pipeline task 状态为 `completed/failed` 且无新事件时，推送 `event: done\ndata: {"status":"..."}\n\n`，关闭 SSE 连接

## Response Schema

### SSE 端点：GET /api/brain/harness/pipeline/:initiative_id/stream

**Query Parameters**：
- `after_event_id` (UUID string, 可选)：断线重连时从此 event_id 之后续接；首次连接不传
- **禁用 query 名**：`id`/`taskId`/`task_id`/`since`/`offset`/`cursor`/`from`/`last`/`planner_task_id`

**Content-Type**: `text/event-stream`

**节点更新事件** (`event: node_update`)：
```
event: node_update
data: {"event_id":"uuid","initiative_id":"uuid","node":"proposer","status":"running","payload":{},"ts":"2026-05-16T10:00:00.000Z"}
```
- `event_id` (string UUID, 必填)：唯一标识该事件，供 `after_event_id` 断点续接使用
- `initiative_id` (string UUID, 必填)：对应 planner task id
- `node` (string, 必填)：节点名，枚举 `planner|proposer|reviewer|generator|evaluator|report`
  - **禁用节点名别名**：`step`/`stage`/`phase`/`agent`/`task_type`/`name`/`label`/`nodeName`
- `status` (string, 必填)：枚举 `pending|running|completed|failed`
  - **禁用状态别名**：`in_progress`/`done`/`error`/`success`/`ok`
- `payload` (object, 必填)：节点输出摘要（可含 `verdict`/`pr_url`/`error_message`），空时为 `{}`
- `ts` (string ISO8601, 必填)
- **禁用 data 顶层 key**：`data`/`body`/`response`/`event_type`/`type`/`result`/`attempt`/`time`/`timestamp`

**完成事件** (`event: done`)：
```
event: done
data: {"status":"completed","verdict":"PASS"}
```
- `status` (string, 必填)：`completed` | `failed`
- `verdict` (string|null, 必填)：`PASS` | `FAIL` | `null`
- **禁用字段名**：`result`/`outcome`/`state`/`message`

**Error（HTTP 404）**：
```json
{"error": "initiative not found"}
```
- 必有 `error` key，禁用 `message`/`msg`/`reason`/`detail`

---

### REST 端点：GET /api/brain/harness/pipeline/:initiative_id/events

**用途**：一次性获取历史事件列表（E2E 验收 + catchup 替代方案）

**Success (HTTP 200)**：
```json
{
  "events": [
    {
      "event_id": "uuid",
      "initiative_id": "uuid",
      "node": "planner",
      "status": "completed",
      "payload": {},
      "ts": "2026-05-16T10:00:00.000Z"
    }
  ]
}
```
- `events` (array, 必填)：按 `ts` 升序排列
- **禁用顶层 key**：`data`/`result`/`items`/`records`/`rows`

---

### initiative_run_events 表结构（新建）

```sql
CREATE TABLE initiative_run_events (
  event_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id UUID NOT NULL,
  node          TEXT NOT NULL CHECK (node IN ('planner','proposer','reviewer','generator','evaluator','report')),
  status        TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed')),
  payload       JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON initiative_run_events (initiative_id, created_at);
```

## 边界情况

- **SSE 断线重连**：前台传 `?after_event_id=<last_seen_uuid>`，Brain 从该 event_id 之后续接推送
- **已完成 pipeline**：flush 所有历史事件后立即发 `event: done` 关闭连接，不保持 open
- **initiative_id 不存在**：HTTP 404 `{"error":"initiative not found"}`
- **无事件（pipeline 刚创建）**：`/events` 返回 `{"events":[]}`；SSE 保持连接 + 30s keepalive，等待首条事件
- **并发多标签页**：每个 EventSource 独立轮询，Brain 无状态处理

## 范围限定

**在范围内**：
- `initiative_run_events` 表 DDL + 索引（migration 文件）
- Brain SSE 端点 `GET /api/brain/harness/pipeline/:initiative_id/stream`
- Brain REST 端点 `GET /api/brain/harness/pipeline/:initiative_id/events`
- Dashboard 新页面 `apps/dashboard/src/pages/harness/HarnessStreamPage.tsx`，路由 `/harness/:id`
- 路由注册：`apps/api/features/system-hub/index.ts` 新增 `/harness/:id` → `HarnessStreamPage`

**不在范围内**：
- 修改现有 `/pipeline/:id`（`HarnessPipelineDetailPage`）
- 在 Brain 执行层（harness-gan-graph.js 等）写入 `initiative_run_events`（Proposer 合同阶段定义）
- WebSocket 实现
- 事件回放动画 / 时间轴 UI

## 假设

- [ASSUMPTION: initiative_id 与 planner task id 相同，前台从 URL param 直接取]
- [ASSUMPTION: Brain SSE 端点以 2s 轮询 DB 新事件，不用 PostgreSQL NOTIFY（与现有 ops.js SSE 模式一致）]
- [ASSUMPTION: 前台使用浏览器原生 EventSource API，不引入额外 SSE 库]
- [ASSUMPTION: /harness/:id 路由注册在 system-hub feature，与 /pipeline/:id 平行存在，不替代]
- [ASSUMPTION: migration 文件放在 packages/brain/src/db/migrations/ 目录]

## 预期受影响文件

- `packages/brain/src/routes/harness.js`：新增 SSE + REST 端点（`/pipeline/:initiative_id/stream` 和 `/pipeline/:initiative_id/events`）
- `packages/brain/src/db/migrations/<timestamp>_initiative_run_events.sql`：新建表 DDL
- `apps/dashboard/src/pages/harness/HarnessStreamPage.tsx`：新建实时流页面
- `apps/api/features/system-hub/index.ts`：注册 `/harness/:id` 路由 → `HarnessStreamPage`

## E2E 验收

```bash
# ① 插入测试事件（需 DB 连接）
psql "$DATABASE_URL" -c "
  INSERT INTO initiative_run_events (initiative_id, node, status)
  VALUES ('00000000-0000-0000-0000-000000000001', 'planner', 'completed');
"

# ② 验证 REST 历史端点（localhost:5221 = Brain，非 playground）
curl -sf localhost:5221/api/brain/harness/pipeline/00000000-0000-0000-0000-000000000001/events \
  | jq -e '.events | length > 0 and .[0].node == "planner" and .[0].status == "completed"'

# ③ 验证 SSE 端点推送 node_update 事件格式
curl -N -H "Accept: text/event-stream" \
  localhost:5221/api/brain/harness/pipeline/00000000-0000-0000-0000-000000000001/stream \
  --max-time 5 | grep -q "event: node_update"

echo "✅ harness /harness/:id SSE 端点验证通过"
```

---

## journey_type: user_facing
## journey_type_reason: 入口是 Dashboard `/harness/:id` 新页面（apps/dashboard/），核心场景以用户前台实时观察 pipeline 执行状态为起点
