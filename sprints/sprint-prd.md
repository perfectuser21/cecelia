# Sprint PRD — Harness Pipeline 实时 Streaming 前台可见性

## OKR 对齐

- **对应 KR**：Harness 可观测性（Brain API 当前不可达，占位）
- **当前进度**：N/A
- **本次推进预期**：用户在 Dashboard 前台实时看到 harness pipeline 每个节点的执行状态

## 背景

当前 Dashboard 展示 harness pipeline 数据需手动刷新。本 sprint 新增 `initiative_run_events` 表存储节点状态事件、Brain SSE 端点实时推送、Dashboard `/harness/:id` 页面消费 SSE 流，实现 Planner → Proposer → Reviewer → Generator → Evaluator 节点状态的前台实时可见。

## Golden Path（核心场景）

用户从 [Dashboard `/harness/:id` 页面] → 经过 [Browser 建立 EventSource 连接至 Brain SSE 端点，Brain 把 `initiative_run_events` 写入事件推送到前台] → 到达 [Pipeline 各节点状态徽章实时更新，无需刷新]

具体步骤：
1. 用户打开 Dashboard `/harness/:id`，页面建立 `EventSource` 连接至 `GET /api/brain/harness/events/:initiative_id`
2. Harness workflow 每个节点（Planner/Proposer/Reviewer/Generator/Evaluator）状态变更时，INSERT `initiative_run_events` 表并触发 SSE 推送
3. Brain SSE 端点读取 `initiative_run_events` 新行，以 `event: node_update` 格式推送给 Browser
4. Dashboard 收到事件后实时更新对应节点徽章（`pending → running → completed/failed`）
5. Pipeline 全部节点完成时，SSE 发 `event: done`，Browser 关闭连接并展示最终状态

## Response Schema

### SSE Endpoint: GET /api/brain/harness/events/:initiative_id

**协议**: `Content-Type: text/event-stream`

**连接建立时（初始快照，type=snapshot）**:
```json
{"type": "snapshot", "nodes": [{"node": "Planner", "status": "completed", "task_id": "<uuid>", "ts": 1716000000}]}
```

**节点状态变更事件（event: node_update）**:
```
event: node_update
data: {"node":"Proposer","status":"running","task_id":"<uuid>","ts":1716000010}
```
- `node` (string, 必填): 枚举 `Planner|Proposer|Reviewer|Generator|Evaluator|Report`
- `status` (string, 必填): 枚举 `pending|running|completed|failed`
- `task_id` (string, 必填): tasks 表 UUID
- `ts` (number, 必填): Unix 时间戳（秒）
- **禁用字段名**: `state`/`phase`/`step`/`name`/`label`/`stage`/`nodeName`/`timestamp`

**完成事件（event: done）**:
```
event: done
data: {"status":"completed"}
```
- `status`: `completed` | `failed`

**心跳（每 15s）**: `: heartbeat`

**Error (HTTP 404，SSE upgrade 前)**:
```json
{"error": "initiative not found"}
```
- 必有 `error` key，禁用 `message`/`msg`/`reason`

**initiative_run_events 表 schema**:
```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
initiative_id UUID NOT NULL,
node VARCHAR(32) NOT NULL,
status VARCHAR(16) NOT NULL,
task_id UUID,
ts BIGINT NOT NULL
```

## 边界情况

- SSE 断连：`EventSource` 原生自动重连
- Pipeline 已完成：推 snapshot 后立即发 `event: done`，服务端关闭连接
- `initiative_id` 不存在：HTTP 404（在 SSE upgrade 前返回）
- 组件卸载：cleanup 调用 `eventSource.close()`

## 范围限定

**在范围内**：`initiative_run_events` 新表、Brain SSE 端点 `GET /events/:initiative_id`、Dashboard `/harness/:id` 节点实时徽章
**不在范围内**：历史事件回放、events 表 TTL 清理、多 pipeline 并发视图、权限控制

## 假设

- [ASSUMPTION: Brain API localhost:5221 当前不可达，OKR 进度占位]
- [ASSUMPTION: Dashboard `/harness/:id` 是新增路由或对应现有 harness initiative 详情页]
- [ASSUMPTION: `initiative_runs` 表已存在；`initiative_run_events` 是全新表]
- [ASSUMPTION: harness-initiative.graph.js 是节点状态变更的写入入口]

## 预期受影响文件

- `packages/brain/src/routes/harness.js`: 新增 `GET /events/:initiative_id` SSE 端点
- `packages/brain/src/workflows/harness-initiative.graph.js`: 各节点状态变更时 INSERT `initiative_run_events`
- `apps/dashboard/src/pages/harness/` 或新建 `/harness/:id` 页面: 接入 `EventSource`，实时更新节点徽章
- DB migration: 新建 `initiative_run_events` 表

## journey_type: user_facing
## journey_type_reason: thin_prd 明确包含 "Dashboard /harness/:id 页面"，Browser 实时可视是主要入口
