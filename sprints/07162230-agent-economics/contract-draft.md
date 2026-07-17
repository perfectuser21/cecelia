# Contract Draft — 代理经济学仪表盘：cost_usd 断链修复 + 每PR成本报表 + Langfuse凭据接通

sprint: 07162230-agent-economics
task_id: 40386870-31b0-4d24-b18a-fdfb129715d9
proposer_round: 1
target_environment: local_api

---

## [BEHAVIOR] B1 — relay 回调携带 usage 时，cost_usd 落库非 NULL

**触发**：`POST /api/brain/harness/callback/cecelia-relay-<shortid>-<suffix>`，body 含 `usage.total_cost_usd`（合法数值 > 0）

**前置条件**：
- `initiative_run_events` 表中存在与该 relay session 对应的 running 行（通过 `initiative_id` 关联）
- 该行当前 `cost_usd` 为 NULL

**断言（修复前 FAIL，修复后 PASS）**：
- HTTP 响应 200，body 含 `"relayAck": true`
- `initiative_run_events` 表对应行（最近写入）的 `cost_usd = 0.035`（NOT NULL）
- `tokens_in = 5000`，`tokens_out = 2000`（NOT NULL）

---

## [BEHAVIOR] B2 — relay 回调不含 usage 时，原有 200 ack 行为不变

**触发**：`POST /api/brain/harness/callback/cecelia-relay-<shortid>-<suffix>`，body 不含 `usage` 字段（或 `usage` 为 null/undefined）

**断言**：
- HTTP 响应 200，body 含 `"relayAck": true`
- `initiative_run_events` 对应行的 `cost_usd / tokens_in / tokens_out` 保持 NULL（不写 0，不写负数）
- 回调链不中断，不抛 500

---

## [BEHAVIOR] B3 — relay 回调含 usage 但 cost_usd 为 0 时写 0（不写负数，不估算）

**触发**：body 含 `usage: { input_tokens: 100, output_tokens: 50, total_cost_usd: 0 }`

**断言**：
- HTTP 响应 200，`"relayAck": true`
- `cost_usd = 0`（已写入，非 NULL；区分 0 与 NULL）
- `tokens_in = 100`，`tokens_out = 50`

---

## [BEHAVIOR] B4 — relay 回调含负数 cost_usd 时写 NULL（禁止写入负值）

**触发**：body 含 `usage: { input_tokens: 100, output_tokens: 50, total_cost_usd: -1 }`

**断言**：
- HTTP 响应 200，`"relayAck": true`
- `cost_usd` 保持 NULL（负数禁止落库）
- `tokens_in / tokens_out` 仍正常写入（tokens 不受 cost 校验影响）

---

## [BEHAVIOR] B5 — updateInitiativeRunEvent 支持 tokensIn / tokensOut 参数

**触发**：直接调用 `updateInitiativeRunEvent({ id, costUsd: 0.035, tokensIn: 5000, tokensOut: 2000 })`

**断言**：
- 返回的行含 `tokens_in = 5000`，`tokens_out = 2000`，`cost_usd = 0.035`
- SQL 语句包含 `tokens_in` 和 `tokens_out` 列名

---

## [BEHAVIOR] B6 — migration 351 幂等：tokens_in / tokens_out 列加列后重复执行无错

**触发**：对同一个 DB 执行 `351_initiative_run_events_tokens.sql` 两次

**断言**：
- 两次执行均不报错（`IF NOT EXISTS` 保证幂等）
- `initiative_run_events` 表含 `tokens_in BIGINT` 和 `tokens_out BIGINT` 列

---

## [BEHAVIOR] B7 — GET /api/brain/economics/prs?days=N 返回按 task 聚合的成本报表

**触发**：`GET /api/brain/economics/prs?days=7`（DB 中有含 cost_usd 的 initiative_run_events 行）

**断言**：
- HTTP 响应 200，Content-Type: application/json
- body 含 `prs` 数组（每项含 `task_id, total_cost_usd, attempt_count, events_count, duration_ms`）
- body 含 `summary`：`{ total_cost_usd, avg_cost_per_pr, total_attempts }`
- `summary.total_cost_usd` 等于各 task `total_cost_usd` 之和（精度 ±0.0001）
- 响应时间 < 2000ms（local PostgreSQL，days=30 范围）

---

## [BEHAVIOR] B8 — GET /api/brain/economics/prs 超出 days 范围的记录不出现

**触发**：`GET /api/brain/economics/prs?days=7`，DB 中同时存在 3 天内和 30 天前的 events

**断言**：
- 响应 `prs` 数组中不包含 30 天前的 task 数据
- 只含 7 天内有 events 的 task

---

## [BEHAVIOR] B9 — GET /api/brain/economics/prs 查无记录时返回空数组 + summary 均为 0

**触发**：`GET /api/brain/economics/prs?days=7`，DB 中无任何 initiative_run_events（或 days 范围内无记录）

**断言**：
- HTTP 响应 200
- `prs` 为 `[]`
- `summary.total_cost_usd = 0`，`summary.total_attempts = 0`，`summary.avg_cost_per_pr = 0`

---

## [BEHAVIOR] B10 — Langfuse 凭据存在时 GET /api/brain/langfuse/recent 返回 success:true

**前置条件**：`~/.credentials/langfuse.env` 存在，含 `LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`、`LANGFUSE_BASE_URL`

**触发**：`GET /api/brain/langfuse/recent`

**断言**：
- HTTP 响应 200
- body 含 `"success": true`
- `data` 为非空数组

---

## [BEHAVIOR] B11 — Langfuse 凭据缺失时降级返回 credentials_missing（现有行为不回退）

**前置条件**：`~/.credentials/langfuse.env` 不存在或缺少必要字段

**触发**：`GET /api/brain/langfuse/recent`

**断言**：
- HTTP 响应 200（降级，不 500）
- body 含 `"success": false`，`"error": "credentials_missing"`

---

## [BEHAVIOR] B12 — relay 回调写库失败时 non-fatal，仍返回 200 ack（不阻断回调链）

**触发**：DB 写入 `updateInitiativeRunEvent` 抛出异常（模拟 PG 错误）

**断言**：
- HTTP 响应 200，body 含 `"relayAck": true`
- `console.warn` 被调用（非 fatal，有日志）
- 不返回 500

---

## [BEHAVIOR] B13 — economics 路由已在 server.js 注册，端点可访问

**触发**：Brain 服务正常启动后，`GET /api/brain/economics/prs`

**断言**：
- HTTP 响应 200 或 400（非 404、非 500）
- 端点已注册（不返回 "Cannot GET"）

---

## 累积 FR 不回退约束

- [FR-REG-1] relay 容器回调 `cecelia-relay-*` 路径返回 200 ack，不触发 LangGraph resume（现行行为）
- [FR-REG-2] `PATCH /api/brain/orchestrator/relay-runs/:initiative_id` 支持 `cost` 字段写入（现行行为）
- [FR-REG-3] `GET /api/brain/langfuse/recent` 凭据缺失时返回 `{success:false, error:'credentials_missing'}`（现行降级行为）

---

## 边界与 Invariant

- 负数 cost_usd 禁止写库（[禁估算造假] invariant）
- secrets 不硬编码、不进 git（凭据安全 invariant）
- migration 必须 IF NOT EXISTS 幂等（[migration 幂等] invariant）
- 新端点须与现有 Brain 鉴权模式对齐（[端点鉴权] invariant）
- 写库失败必须 console.warn 留日志，non-fatal（[可观测] NFR）
- economics 端点查询须 <2s（local PG，days=30）

---

## E2E 验收

target_environment: local_api
runner: 本地 Brain API localhost:5221 + 本地 PostgreSQL

```bash
# E2E-1: relay 回调 usage 落库（手动注入 initiative_run_events 行后测试）
# 先插一条 running 行，记录 id
IREVENT_ID=$(psql cecelia -t -c "INSERT INTO initiative_run_events (initiative_id, node, status, attempt, ts) VALUES ('00000000-0000-0000-0000-000000000001', 'proposer', 'running', 1, EXTRACT(EPOCH FROM NOW())::BIGINT) RETURNING id;" | tr -d ' \n')
echo "inserted event id: $IREVENT_ID"

# 发送 relay 回调（包含 usage）
curl -s -X POST localhost:5221/api/brain/harness/callback/cecelia-relay-00000000-test1 \
  -H "Content-Type: application/json" \
  -d '{"result":"done","exit_code":0,"usage":{"input_tokens":5000,"output_tokens":2000,"total_cost_usd":0.035}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK' if d.get('relayAck') else 'FAIL: ' + str(d))"

# 查库确认 cost_usd 非 NULL（通过最近插入的行）
psql cecelia -c "SELECT id, cost_usd, tokens_in, tokens_out FROM initiative_run_events ORDER BY id DESC LIMIT 3;"
# 期望：cost_usd = 0.0350，tokens_in = 5000，tokens_out = 2000（非 NULL）

# E2E-2: 报表端点
curl -s "localhost:5221/api/brain/economics/prs?days=7" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK' if 'prs' in d and 'summary' in d else 'FAIL: ' + str(d))"

# E2E-3: Langfuse 凭据（若 1Password CS 有凭据则期望 success:true，否则 credentials_missing 是合法降级）
curl -s localhost:5221/api/brain/langfuse/recent \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK' if d.get('success') else f'SKIP(降级): {d.get(\"error\")}')"

# E2E-4: migration 幂等性（重复执行不报错）
psql cecelia < packages/brain/migrations/351_initiative_run_events_tokens.sql
psql cecelia < packages/brain/migrations/351_initiative_run_events_tokens.sql
psql cecelia -c "\d initiative_run_events" | grep -E "tokens_in|tokens_out"
# 期望：两列均存在，类型为 bigint

# E2E-5: 清理测试数据
psql cecelia -c "DELETE FROM initiative_run_events WHERE initiative_id = '00000000-0000-0000-0000-000000000001';"
```

---

## 受影响文件（预期）

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/brain/migrations/351_initiative_run_events_tokens.sql` | 新增 | 加 tokens_in/tokens_out 列，IF NOT EXISTS 幂等 |
| `packages/brain/src/events/initiativeRunEvents.js` | 修改 | updateInitiativeRunEvent 加 tokensIn/tokensOut 参数 |
| `packages/brain/src/routes/harness-callback.js` | 修改 | relay 分支解析 usage，调用 updateInitiativeRunEvent |
| `packages/brain/src/routes/economics.js` | 新增 | GET /api/brain/economics/prs?days=N 端点 |
| `packages/brain/server.js` | 修改 | 注册 economics 路由 |
| `packages/brain/src/__tests__/economics-relay-usage.test.js` | 新增 | T1 failing test |
| `packages/brain/src/__tests__/economics-prs.test.js` | 新增 | T2 failing test |
