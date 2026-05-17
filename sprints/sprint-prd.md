# Sprint PRD — Harness Pipeline 实时 Streaming 前台可见性

## OKR 对齐

- **对应 KR**：KR-3（Harness 可靠性 — pipeline 可观测性）
- **当前进度**：N/A（Brain API 不可达）
- **本次推进预期**：Dashboard 用户无需刷新即可实时看到 harness pipeline 每个节点的执行状态

## 背景

Harness pipeline 执行时，用户无法知道 pipeline 当前跑到哪个节点。本 sprint 新增专用 `initiative_run_events` 表、Brain SSE 端点、Dashboard `/harness/:id` 页面，打通端到端实时流。

## Golden Path（核心场景）

用户打开运行中 pipeline 的详情页 → 页面建立 SSE 连接 → 每个节点执行完成时实时追加一行（节点名 + 状态 + 时间戳）→ pipeline 结束后 SSE 关闭，页面显示完成状态。

具体步骤：
1. 用户打开 `/harness/:id`，页面对 `GET /api/brain/harness/stream?initiative_id={id}` 发起 `EventSource` 连接
2. Brain SSE 端点从 `initiative_run_events` 表每 2s 轮询新行，以 `event: node_update` 推送
3. 前端收到事件 → 追加到 `data-testid="realtime-log"` 日志区，每行有 `data-testid="log-entry"`
4. `initiative_run_events` 有 `status='run_completed'` 行时，SSE 推 `event: run_completed` 并关闭连接
5. 用户看到 Pipeline 已完成/失败，日志区停止更新

## Response Schema

### Endpoint: GET /api/brain/harness/stream

**Query Parameters**:
- `initiative_id` (string-UUID, 必填): 要订阅的 initiative UUID
- **禁用 query 名**: `id`/`taskId`/`task_id`/`planner_task_id`/`pipeline_id`/`tid`

**SSE Event Stream（Content-Type: text/event-stream）**:

节点更新事件 `event: node_update`（data 恰好 4 字段，ts 为 BIGINT number）：
```json
{"node": "proposer", "status": "running", "attempt": 1, "ts": 1747476000}
```
- `node` (string, 必填): 节点英文名（`planner`/`proposer`/`reviewer`/`generator`/`evaluator`/`report`）
- `status` (string, 必填): 节点状态（`running`/`done`/`failed`）
- `attempt` (number, 必填): 第几次尝试（≥1）
- `ts` (number, 必填): BIGINT Unix 秒时间戳（≥ 1000000000）
- **顶层 keys 必须完全等于** `["attempt","node","status","ts"]`（字母序），不允许多余字段
- **禁用字段**: `name`/`label`/`nodeName`/`step`/`stage`/`time`/`timestamp`/`created_at`/`event_type`

完成事件 `event: run_completed`（pipeline 终止信号）：
```json
{"initiative_run_id": "xxxxxx-...", "verdict": "PASS", "ts": 1747476060}
```
- `initiative_run_id` (string, 必填): 对应的 initiative run UUID
- `verdict` (string|null, 必填): `"PASS"` | `"FAIL"` | `null`
- `ts` (number, 必填): BIGINT Unix 秒时间戳
- **run_completed data 无 `status` 字段**
- **前端监听 `run_completed`，禁用事件名 `done`**

错误响应（HTTP 400/404）：
```json
{"error": "<string>"}
```
- 必有 `error` key，禁用 `message`/`msg`/`reason`

**Keepalive**: 每 30s 推一行 `: keepalive` comment

### initiative_run_events 表 Schema

```sql
CREATE TABLE initiative_run_events (
  id            BIGSERIAL PRIMARY KEY,
  initiative_id UUID NOT NULL,
  node          VARCHAR(64) NOT NULL,
  status        VARCHAR(32) NOT NULL,
  attempt       INTEGER NOT NULL DEFAULT 1,
  verdict       VARCHAR(16),
  ts            BIGINT NOT NULL
);
CREATE INDEX ON initiative_run_events (initiative_id, ts);
```

- **ts 类型为 BIGINT（Unix 秒），非 TIMESTAMPTZ**
- **无 label 列，无 created_at 列**
- `status`: `'running'`/`'done'`/`'failed'`/`'run_completed'`（`run_completed` 行触发 SSE 关闭）
- `verdict`: `'PASS'` | `'FAIL'` | `null`（仅 run_completed 行有值）

## 边界情况

- `initiative_id` 不存在 → HTTP 404 `{"error":"<string>"}`（禁用 `message`/`msg`/`reason`）
- `initiative_id` 参数缺失 → HTTP 400 `{"error":"<string>"}`
- pipeline 已完成 → 推送所有历史行后立即发 `event: run_completed`
- SSE 断连 → 浏览器 EventSource 自动重连（后端 `res.on('close')` 清理 setInterval）
- 无新事件 → 保持连接 + 30s keepalive comment

## 范围限定

**在范围内**：
- 新建 `initiative_run_events` 表 DB migration（ts BIGINT，无 label 列，含复合索引）
- `packages/brain/src/routes/harness.js` 新增 `GET /stream` SSE 端点
- `packages/brain/src/events/initiativeRunEvents.js` `writeInitiativeRunEvent` helper
- harness executor 相关文件新增 `writeInitiativeRunEvent` 调用
- `apps/dashboard/src/pages/harness/HarnessDetailPage.tsx` 新建 `/harness/:id` 页面（含 EventSource + 实时日志区）

**不在范围内**：
- 修改 `task_events` 表结构或 WebSocket 推送
- pipeline 列表页轮询改造
- 历史 pipeline 回放 / 复杂交互 UI

## 假设

- [ASSUMPTION: `initiative_id` 与 Brain tasks 表的 `initiative_id` 字段一致（UUID 格式）]
- [ASSUMPTION: Dashboard 通过 Vite proxy 访问 Brain API，无跨域问题]
- [ASSUMPTION: executor.js 调用已有节点完成回调时序与 initiative_id 一一对应]

## 预期受影响文件

- `packages/brain/migrations/<timestamp>-initiative-run-events.sql`: 新建 migration（BIGINT ts，无 label）
- `packages/brain/src/routes/harness.js`: 新增 `GET /stream` SSE 端点
- `packages/brain/src/events/initiativeRunEvents.js`: `writeInitiativeRunEvent` helper
- `apps/dashboard/src/pages/harness/HarnessDetailPage.tsx`: 新建实时日志页面
- `apps/dashboard/src/config/` 或路由配置: 注册 `/harness/:id`

## E2E 验收

```bash
#!/bin/bash
# E2E 验收 — 测 Brain SSE 端点（Brain 端口 5221）
# ✅ 位置词检查：Brain SSE → localhost:5221，无 playground 端点
DB="${DATABASE_URL:-postgresql://localhost/cecelia}"
IAID=$(python3 -c "import uuid; print(str(uuid.uuid4()))" 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null)

# 1. 无 label 列
psql "$DB" -c "\d initiative_run_events" > /dev/null 2>&1 || { echo "FAIL: 表不存在"; exit 1; }
LABEL_COL=$(psql "$DB" -t -c "SELECT column_name FROM information_schema.columns WHERE table_name='initiative_run_events' AND column_name='label'" | tr -d ' ')
[ -z "$LABEL_COL" ] || { echo "FAIL: label 列不应存在"; exit 1; }

# 2. 插入 node_update 行（ts BIGINT）
psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, status, attempt, ts) \
  VALUES ('$IAID', 'proposer', 'running', 1, extract(epoch from now())::bigint)"

# 3. SSE 推 node_update，schema 恰好 {node,status,attempt,ts}，ts 为 number
SSE=$(curl -s --max-time 6 "localhost:5221/api/brain/harness/stream?initiative_id=$IAID" 2>&1 || true)
echo "$SSE" | grep -q "event: node_update" || { echo "FAIL: 无 node_update"; exit 1; }
DATA=$(echo "$SSE" | grep "^data:" | grep -v "keepalive" | head -1 | sed 's/^data: //')
echo "$DATA" | jq -e 'keys | sort == ["attempt","node","status","ts"]' || { echo "FAIL: node_update schema 漂移"; exit 1; }
echo "$DATA" | jq -e '.ts | type == "number"' || { echo "FAIL: ts 非 number"; exit 1; }
echo "$DATA" | jq -e 'has("label") | not' || { echo "FAIL: 禁用字段 label 存在"; exit 1; }

# 4. run_completed 事件（非 done）
psql "$DB" -c "INSERT INTO initiative_run_events \
  (initiative_id, node, status, attempt, verdict, ts) \
  VALUES ('$IAID', 'report', 'run_completed', 1, 'PASS', extract(epoch from now())::bigint)"
SSE2=$(curl -s --max-time 8 "localhost:5221/api/brain/harness/stream?initiative_id=$IAID" 2>&1 || true)
echo "$SSE2" | grep -q "event: run_completed" || { echo "FAIL: 无 run_completed"; exit 1; }
DONE=$(echo "$SSE2" | grep -A1 "event: run_completed" | grep "^data:" | head -1 | sed 's/^data: //')
echo "$DONE" | jq -e '.initiative_run_id | type == "string"' || { echo "FAIL: 缺 initiative_run_id"; exit 1; }
echo "$DONE" | jq -e '.ts | type == "number"' || { echo "FAIL: run_completed.ts 非 number"; exit 1; }
echo "$DONE" | jq -e 'has("status") | not' || { echo "FAIL: run_completed 不应含 status"; exit 1; }

# 5. error path
ECODE=$(curl -s -o /tmp/e2e_err.json -w "%{http_code}" "localhost:5221/api/brain/harness/stream?initiative_id=00000000-0000-0000-0000-000000000000")
[ "$ECODE" = "404" ] || { echo "FAIL: 未知 initiative_id 应 404"; exit 1; }
jq -e '.error | type == "string"' /tmp/e2e_err.json || { echo "FAIL: 404 缺 error 字段"; exit 1; }
jq -e 'has("message") | not' /tmp/e2e_err.json || { echo "FAIL: 404 含禁用字段 message"; exit 1; }

echo "✅ E2E Golden Path 全过"
```

## journey_type: user_facing
## journey_type_reason: 入口是 Dashboard /harness/:id 页面（apps/dashboard/），用户直接感知实时节点推进
