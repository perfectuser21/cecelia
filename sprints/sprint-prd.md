# Sprint PRD — Harness Pipeline 实时 Streaming 前台可见性

## OKR 对齐

- **对应 KR**：KR-3（Harness 可靠性 — pipeline 可观测性）
- **当前进度**：N/A（Brain API 不可达）
- **本次推进预期**：Dashboard 用户无需刷新即可实时看到 harness pipeline 每个节点的执行状态

## 背景

Harness pipeline 执行时，executor.js 已通过 `emitGraphNodeUpdate` 将节点完成事件写入 `task_events` 表。但 Dashboard 无实时可见性——用户无法知道 pipeline 当前跑到哪个节点。本 sprint 新增专用 `initiative_run_events` 表、Brain SSE 端点、Dashboard `/harness/:id` 页面，打通端到端实时流。

## Golden Path（核心场景）

用户打开运行中 pipeline 的详情页 → 页面建立 SSE 连接 → 每个节点执行完成时实时追加一行（节点名 + 时间戳）→ pipeline 结束后 SSE 关闭，页面显示完成状态。

具体步骤：
1. 用户打开 `/harness/:id`，页面对 `GET /api/brain/harness/stream?initiative_id={id}` 发起 `EventSource` 连接
2. Brain SSE 端点从 `initiative_run_events` 表轮询新行（每 2s），以 `event: node_update` 推送
3. 前端收到事件 → 追加到"实时日志"区，显示节点名和时间戳
4. `initiative_run_events` 有 `status=done` 行时，SSE 推 `event: done` 并关闭连接
5. 用户看到 "Pipeline 已完成" 或 "Pipeline 失败"，日志区停止

## Response Schema

### Endpoint: GET /api/brain/harness/stream

**Query Parameters**:
- `initiative_id` (string-UUID, 必填): 要订阅的 initiative UUID
- **禁用 query 名**: `id`/`taskId`/`task_id`/`planner_task_id`/`pipeline_id`/`tid`

**SSE Event Stream（Content-Type: text/event-stream）**:

节点更新事件（`event: node_update`）:
```
event: node_update
data: {"node":"proposer","label":"Proposer","attempt":1,"ts":"2026-05-17T10:00:00Z"}
```
- `node` (string, 必填): 节点英文名（`planner`/`proposer`/`reviewer`/`generator`/`evaluator`/`report`）
- `label` (string, 必填): 节点中文标签
- `attempt` (number, 必填): 第几次尝试（≥1）
- `ts` (string, 必填): ISO 8601 时间戳
- **禁用字段名**: `name`/`nodeName`/`step`/`stage`/`time`/`timestamp`

完成事件（`event: done`）:
```
event: done
data: {"status":"completed","verdict":"PASS"}
```
- `status`: `completed` | `failed`
- `verdict`: `PASS` | `FAIL` | `null`

错误（HTTP 400/404）:
```json
{"error": "<string>"}
```
- 必有 `error` key，禁用 `message`/`msg`

**Keepalive**: 每 30s 推一行 `: keepalive` comment

**禁用响应字段名**: `data`/`payload`/`result`/`event_type`/`type`

### initiative_run_events 表 Schema

```sql
CREATE TABLE initiative_run_events (
  id          BIGSERIAL PRIMARY KEY,
  initiative_id UUID NOT NULL,
  node        VARCHAR(64) NOT NULL,
  label       VARCHAR(128) NOT NULL,
  attempt     INTEGER NOT NULL DEFAULT 1,
  status      VARCHAR(32) NOT NULL DEFAULT 'node_update',
  verdict     VARCHAR(16),
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload     JSONB
);
CREATE INDEX ON initiative_run_events (initiative_id, ts);
```

- `status`: `'node_update'` | `'done'`（done 行触发 SSE 关闭）
- `verdict`: `'PASS'` | `'FAIL'` | `null`（仅 done 行有值）

## 边界情况

- `initiative_id` 不存在 → HTTP 404 `{"error":"initiative not found"}`
- pipeline 已完成 → 推送所有历史行后立即发 `event: done`
- SSE 断连 → 浏览器 EventSource 自动重连（后端无需额外处理）
- 无新事件 → 保持连接 + 30s keepalive

## 范围限定

**在范围内**：
- 新建 `initiative_run_events` 表（DB migration）
- `packages/brain/src/routes/harness.js` 新增 `GET /stream` SSE 端点
- executor.js 中 `emitGraphNodeUpdate` 同步写入 `initiative_run_events`
- `apps/dashboard/src/pages/harness/HarnessDetailPage.tsx` — 新页面 `/harness/:id`，含 EventSource 实时日志区

**不在范围内**：
- 修改 `task_events` 表结构或 WebSocket 推送
- pipeline 列表页（`HarnessPipelinePage.tsx`）15s 轮询改造
- 历史 pipeline 回放 / 复杂交互 UI

## 假设

- [ASSUMPTION: `initiative_id` 与 Brain tasks 表的 `initiative_id` 字段一致（UUID 格式）]
- [ASSUMPTION: Dashboard 通过 Vite proxy 访问 Brain API，无跨域问题]
- [ASSUMPTION: executor.js 调用 emitGraphNodeUpdate 的时序与 initiative_id 一一对应]

## 预期受影响文件

- `packages/brain/src/routes/harness.js`: 新增 `GET /stream` SSE 端点
- `packages/brain/src/events/taskEvents.js` 或新建 `initiativeRunEvents.js`: 写入 `initiative_run_events`
- `packages/brain/migrations/`: 新增 `initiative_run_events` 表的 migration 文件
- `apps/dashboard/src/pages/harness/HarnessDetailPage.tsx`: 新建 `/harness/:id` 页面
- `apps/dashboard/src/config/`: 注册 `/harness/:id` 路由

## E2E 验收

```bash
# ✅ 测 Brain SSE 端点（Brain 端口 5221）
INIT_ID="test-$(uuidgen | tr '[:upper:]' '[:lower:]')"
# 插一条 node_update 行
psql $DATABASE_URL -c "INSERT INTO initiative_run_events (initiative_id, node, label, attempt) VALUES ('$INIT_ID', 'proposer', 'Proposer', 1);"
# 建立 SSE 连接，收到 node_update 事件
curl -s -N "localhost:5221/api/brain/harness/stream?initiative_id=$INIT_ID" \
  | timeout 5 grep -m1 "event: node_update" && echo "✅ SSE node_update 事件验证通过"
```

## journey_type: user_facing
## journey_type_reason: 入口是 Dashboard /harness/:id 页面（apps/dashboard/），用户直接感知实时节点推进
