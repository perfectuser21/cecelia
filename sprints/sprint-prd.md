# Sprint PRD — Harness Pipeline 实时 Streaming 前台可见性

initiative_id: 9d693319-2577-487c-9420-79a7420624be

## OKR 对齐

- **对应 KR**：KR-可观测性（Harness pipeline 执行状态对用户实时可见）
- **当前进度**：0%（新 initiative）
- **本次推进预期**：initiative_run_events 表 + Brain SSE 端点 + Dashboard /harness/:id 全链路打通

## 背景

Harness pipeline 执行是黑盒，用户无法在前台实时看到每个节点（planner/proposer/generator/evaluator）的执行进度与结果。本 sprint 建立 DB 事件层 → SSE 推流层 → Dashboard 展示层完整链路。

## Golden Path（核心场景）

用户从 **Dashboard 打开 `/harness/:id`** → 页面 **建立 SSE 连接** → 实时看到 **每个节点 pending→running→done/failed 状态变化** → pipeline 完成后 SSE 关闭，页面显示最终状态。

具体步骤：
1. 用户打开 `/harness/:id`（id = initiative_run_id UUID）
2. 页面对 `GET /api/brain/harness/stream?initiative_id={id}` 发起 `EventSource` 连接
3. Brain SSE 端点从 `initiative_run_events` 表轮询新行（每 2s），推 `event: node_update`
4. 前端收到事件 → 更新对应节点状态徽标（pending/running/done/failed）
5. pipeline 任一节点写入 `status=done` 行 → Brain 推 `event: run_completed` 并关闭 SSE
6. 用户看到所有节点最终状态，日志区停止滚动

## Response Schema

### Endpoint: GET /api/brain/harness/stream

**Query Parameters**:
- `initiative_id` (string-UUID, 必填): 要订阅的 initiative UUID
- **禁用 query 名**: `id`/`taskId`/`task_id`/`pipeline_id`/`tid`/`run_id`

**SSE Event Stream（Content-Type: text/event-stream）**:

```
event: node_update
data: {"node":"proposer","status":"running","attempt":1,"ts":1747123456}

event: node_update
data: {"node":"proposer","status":"done","attempt":1,"ts":1747123460}

event: run_completed
data: {"initiative_run_id":"<uuid>","verdict":"PASS","ts":1747123480}
```

**字段约束**:
- `node` (string, 必填于 node_update): `planner`/`proposer`/`reviewer`/`generator`/`evaluator`/`report`
- `status` (string, 必填于 node_update): `pending`/`running`/`done`/`failed`，禁用 `success`/`error`/`finish`
- `ts` (number, 必填): Unix 秒，与 `initiative_run_events.ts` 列名一致
- `verdict` (string, 必填于 run_completed): `PASS`/`FAIL`/`null`
- **禁用字段名**: `timestamp`/`created_at`/`time`/`event_type`/`type`/`name`/`step`

**Error (HTTP 400/404)**:
```json
{"error": "<string>"}
```
- 必有 `error` key，禁用 `message`/`msg`/`reason`

**Keepalive**: 每 30s 推 `: keepalive` comment 行

### initiative_run_events 表 Schema

```sql
CREATE TABLE initiative_run_events (
  id              BIGSERIAL PRIMARY KEY,
  initiative_id   UUID         NOT NULL,
  node            VARCHAR(64)  NOT NULL,
  status          VARCHAR(32)  NOT NULL,  -- pending/running/done/failed/run_completed
  attempt         INTEGER      NOT NULL DEFAULT 1,
  verdict         VARCHAR(16),            -- PASS/FAIL/null，仅 run_completed 行有值
  ts              BIGINT       NOT NULL   -- Unix 秒（禁用 created_at/timestamp）
);
CREATE INDEX ON initiative_run_events (initiative_id, ts);
```

**列名约束**：时间列必须用 `ts`（BIGINT Unix 秒），禁用 `created_at`/`timestamp`/`event_time`

## 边界情况

- `initiative_id` 不存在 → HTTP 404 `{"error":"initiative not found"}`，不建立 SSE 连接
- pipeline 已完成 → 推全部历史行后立即推 `event: run_completed` 并关闭
- SSE 断连 → 浏览器 EventSource 自动重连，后端无需额外处理
- 同一 run 多 tab 订阅 → Brain 支持 1:N 广播
- 无新事件 → 保持连接 + 每 30s keepalive

## 范围限定

**在范围内**：
- `initiative_run_events` 表 DB migration（packages/brain/migrations/）
- Brain SSE 端点 `GET /api/brain/harness/stream`（packages/brain/src/routes/）
- harness executor 在各节点入口/出口写入 `initiative_run_events`
- Dashboard `/harness/:id` 页面（apps/dashboard/src/pages/）+ 路由注册

**不在范围内**：
- harness pipeline 执行逻辑改动（只新增事件写入调用）
- SSE 鉴权
- pipeline 历史列表页
- 移动端响应式

## 假设

- [ASSUMPTION: `initiative_id` 与 Brain tasks 表的 `initiative_id` 字段格式一致（UUID）]
- [ASSUMPTION: Dashboard 通过 Vite proxy 访问 Brain API，无跨域问题]
- [ASSUMPTION: SSE 客户端使用浏览器原生 EventSource API]

## 预期受影响文件

- `packages/brain/migrations/<ts>_initiative_run_events.sql`: 新建 migration
- `packages/brain/src/routes/harness.js`: 新增 `GET /stream` SSE 端点
- `packages/brain/src/server.js`: 注册新路由
- `packages/engine/` harness executor 相关文件: 新增事件写入调用
- `apps/dashboard/src/pages/harness/HarnessDetailPage.tsx`: 新建 `/harness/:id` 页面
- `apps/dashboard/src/App.tsx`（或路由入口）: 注册 `/harness/:id` 路由

## E2E 验收

```bash
# ✅ 测 Brain SSE 端点（Brain 端口 5221，非 playground）
INIT_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
psql $DATABASE_URL -c "INSERT INTO initiative_run_events (initiative_id, node, status, attempt, ts) VALUES ('$INIT_ID', 'proposer', 'running', 1, extract(epoch from now())::bigint);"
curl -sN "localhost:5221/api/brain/harness/stream?initiative_id=$INIT_ID" \
  | timeout 5 grep -m1 "event: node_update" \
  && echo "✅ SSE node_update 验证通过"
```

## journey_type: user_facing
## journey_type_reason: 核心产出是 Dashboard /harness/:id 页面（apps/dashboard/），用户直接在浏览器实时感知 pipeline 节点推进
