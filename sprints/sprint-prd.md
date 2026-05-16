# Sprint PRD — Harness Pipeline 实时 Streaming 前台可见性

## OKR 对齐

- **对应 KR**：KR-3（Harness 可靠性 — pipeline 可观测性）
- **当前进度**：N/A（Brain API 不可达）
- **本次推进预期**：dashboard 用户无需手动刷新即可看到 harness pipeline 节点实时执行状态

## 背景

Harness pipeline 执行时，`executor.js` 已通过 `emitGraphNodeUpdate` 将每个图节点完成事件写入 `task_events` 表（`event_type='graph_node_update'`）。但 dashboard 的 `HarnessPipelineDetailPage` 仅在页面加载时获取一次数据，`HarnessPipelinePage` 每 15 秒轮询一次。用户无法实时看到节点推进，debug 体验差。

## Golden Path（核心场景）

用户打开运行中 pipeline 的详情页 → 页面自动建立 SSE 连接 → 每当一个 harness 图节点执行完成，日志区实时追加一行（节点名 + 时间戳 + 简要 payload）→ pipeline 结束时 SSE 自动关闭，日志区显示"Pipeline 已完成"。

具体步骤：
1. 用户打开 `/pipeline/:id`，`HarnessPipelineDetailPage` 发起 `EventSource` 连接到 `GET /api/brain/harness/stream?planner_task_id={id}`
2. Brain SSE 端点从 `task_events` 表按 `created_at` 轮询新 `graph_node_update` 行（每 2s 一次），以 `data:` 格式推送
3. 前端收到事件 → 追加到页面"实时日志"区，显示节点名（中文标签）和时间
4. pipeline 对应 task 状态变为 `completed`/`failed` 时，SSE 发送 `event: done` 然后服务端关闭连接
5. 用户看到"Pipeline 已完成 ✅"或"Pipeline 失败 ❌"，日志区停止滚动

## Response Schema

### Endpoint: GET /api/brain/harness/stream

**Query Parameters**:
- `planner_task_id` (string, 必填): pipeline 的 planner task ID（UUID）
- **禁用 query 名**: `id`/`taskId`/`task_id`/`pipeline_id`/`tid`

**SSE Event Stream（Content-Type: text/event-stream）**:

普通节点更新事件（`event: node_update`）:
```
event: node_update
data: {"node":"proposer","label":"Proposer","attempt":1,"ts":"2026-05-16T10:00:00Z"}
```
- `node` (string, 必填): 节点英文名（如 `planner`/`proposer`/`reviewer`/`generator`/`evaluator`/`report`）
- `label` (string, 必填): 节点中文标签
- `attempt` (number, 必填): 第几次尝试（≥1）
- `ts` (string, 必填): ISO 8601 时间戳
- **禁用字段名**: `name`/`nodeName`/`step`/`phase`/`stage`/`time`/`timestamp`

完成事件（`event: done`）:
```
event: done
data: {"status":"completed","verdict":"PASS"}
```
- `status`: `completed` | `failed`
- `verdict`: `PASS` | `FAIL` | `null`

错误事件（HTTP 400/404）:
```json
{"error": "<string>"}
```
- 必有 `error` key，禁用 `message`/`msg`

**禁用响应字段名**: `data`/`payload`/`result`/`event_type`/`type`（SSE `event:` 行已表达类型）

**Keepalive**: 每 30s 发一行 `: keepalive` comment（空事件，维持连接）

## 边界情况

- `planner_task_id` 不存在 → HTTP 404 `{"error":"pipeline not found"}`
- pipeline 已完成 → 推送所有历史 `graph_node_update` 事件后立即发 `event: done` 关闭
- SSE 断连 → 前端 EventSource 自动重连（浏览器原生行为；后端无需额外处理）
- 同一 pipeline 无新事件 → 保持连接 + 30s keepalive comment

## 范围限定

**在范围内**：
- `packages/brain/src/routes/harness.js` 新增 `GET /stream` 端点
- `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx` 新增实时日志区（EventSource）

**不在范围内**：
- 修改 `emitGraphNodeUpdate` 写入逻辑
- WebSocket 推送（已有 ws 系统不纳入，SSE 已足够）
- pipeline 列表页（`HarnessPipelinePage.tsx`）的 15s 轮询改造
- 历史 pipeline 回放 UI（复杂交互，不在本 sprint）

## 假设

- [ASSUMPTION: `task_events` 表有索引 `(task_id, event_type, created_at)`，2s 轮询不会造成性能问题]
- [ASSUMPTION: Brain API 在 `localhost:5221` 上运行，dashboard 通过 Vite proxy 访问]
- [ASSUMPTION: dashboard 已有 EventSource polyfill 或目标浏览器原生支持]

## 预期受影响文件

- `packages/brain/src/routes/harness.js`: 新增 SSE stream 端点 `/stream`
- `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx`: 新增实时日志区 + EventSource hook

## journey_type: user_facing
## journey_type_reason: 入口是 dashboard 详情页（`apps/dashboard/`），用户直接感知实时节点推进
