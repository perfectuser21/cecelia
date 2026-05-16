# Sprint PRD — Harness Pipeline 实时 Streaming 前台可见性

## OKR 对齐

- **对应 KR**：KR-3（Harness Pipeline 端到端可观测性）
- **当前进度**：已有 initiative_runs 表 + HarnessPipelineDetailPage（静态快照）
- **本次推进预期**：补全实时事件流通路（DB → SSE → Dashboard）

## 背景

现有 Harness pipeline 执行信息只能通过静态 DB 快照查看；用户无法在执行过程中实时感知各节点状态。本次在 Brain 层新增 `initiative_run_events` 事件表 + SSE 端点，并在 Dashboard 新建 `/harness/:id` 页面接入实时流。

## Golden Path（核心场景）

用户从 [Dashboard 导航 → /harness/:id] → 经过 [浏览器建立 SSE 连接，接收节点状态事件] → 到达 [实时看到 planner/proposer/reviewer/generator/evaluator 各节点状态更新]

具体：
1. 用户访问 `Dashboard /harness/<initiative_id>`
2. 页面向 `GET /api/brain/initiatives/:id/events` 建立 SSE 长连接
3. Brain 在每个 harness 节点状态变更时，向 `initiative_run_events` 插入一行，并通过 SSE 推送事件
4. 页面接收事件，渲染节点列表（节点名 + 状态 + 时间戳），无需刷新

## Response Schema

### Endpoint: GET /api/brain/initiatives/:id/events

**协议**: Server-Sent Events (`Content-Type: text/event-stream`)

**SSE 事件流格式**（每条事件）：
```
data: {"event":"node_update","node":"planner","status":"running","ts":1716000000000}\n\n
```

**字段定义**：
- `event` (string, 必填): 字面量 `node_update`，禁用 `update`/`change`/`status_change`
- `node` (string, 必填): 枚举 `planner|proposer|reviewer|generator|evaluator|e2e`，禁用 `agent`/`step`/`phase`
- `status` (string, 必填): 枚举 `started|running|done|failed`，禁用 `success`/`complete`/`error`/`pending`
- `ts` (number, 必填): Unix 毫秒时间戳，禁用 `timestamp`/`time`/`created_at`/`t`

**连接建立时**（历史事件回放）：
- 向客户端 flush 当前 initiative 已有的所有 `initiative_run_events` 行，再持续推送新事件

**initiative 不存在 (HTTP 404)**：
```json
{"error": "initiative not found"}
```
- 必有 `error` key，禁用 `message`/`msg`/`reason`

**Schema 完整性**: 每条 SSE data 顶层 keys 必须完全等于 `["event","node","status","ts"]`，不允许多余字段

---

### DB: initiative_run_events 表

```sql
CREATE TABLE initiative_run_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id uuid NOT NULL,
  node         varchar(32) NOT NULL,
  status       varchar(16) NOT NULL,
  payload      jsonb,
  created_at   timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX ON initiative_run_events(initiative_id, created_at);
```

## 边界情况

- `initiative_id` 不存在：SSE 端点立即关闭连接并返回 404 JSON
- SSE 客户端断线：浏览器 EventSource 自动重连，服务端无需特殊处理
- 无事件（pipeline 尚未启动）：SSE 连接保持，不发任何数据
- initiative 已 done/failed：flush 历史事件后关闭 SSE 连接

## 范围限定

**在范围内**：
- `initiative_run_events` 表（DB migration）
- Brain `GET /api/brain/initiatives/:id/events` SSE 端点
- harness-initiative.graph.js 各节点写入 initiative_run_events
- Dashboard `/harness/:id` 页面（新路由，EventSource 接入）

**不在范围内**：
- 替换现有 `/pipeline/:id` 页面（两者并存）
- 事件告警/通知
- 多 initiative 并发展示
- 离线/历史回放（仅限 flush 已有行）

## 假设

- [ASSUMPTION: /harness/:id 为新路由，使用 DynamicRouter 注册，不替换 /pipeline/:id]
- [ASSUMPTION: SSE 端点无需认证，与现有 Brain API 一致]
- [ASSUMPTION: initiative_id 与现有 initiative_runs.initiative_id 类型一致（uuid）]
- [ASSUMPTION: OKR KR 编号参考现有 kr3-progress-calculator，本次不修改 KR 进度计算逻辑]

## 预期受影响文件

- `packages/brain/src/db/migrations/XXXX_create_initiative_run_events.sql`: DB migration
- `packages/brain/src/routes/initiative-events-routes.js`: SSE 端点实现
- `packages/brain/src/server.js`: 注册新路由
- `packages/brain/src/workflows/harness-initiative.graph.js`: 节点状态变更时写 initiative_run_events
- `apps/dashboard/src/pages/harness/HarnessRunPage.tsx`: 新建 /harness/:id 页面
- `apps/dashboard/src/config/`: DynamicRouter 路由注册

## journey_type: user_facing
## journey_type_reason: 主入口是用户在 Dashboard 浏览器访问 /harness/:id 页面，核心价值在前端实时可视化
