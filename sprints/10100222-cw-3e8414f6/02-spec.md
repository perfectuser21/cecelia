---
task_id: 3e8414f6-19a4-415a-9b27-8e6353e9c6e2
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---
# 实现规格：GET /api/brain/tasks 非法筛选参数返回 400

## 现状定位（代码证据）

- `packages/brain/server.js:423` 先挂 `app.use('/api/brain', brainRoutes)`，`brainRoutes`（`src/routes.js:47`）包含 `statusRouter`，其 `router.get('/tasks')` 在 `packages/brain/src/routes/status.js:284`——**生产上 GET /api/brain/tasks 实际命中的是这个处理器**。
  - `parseInt(req.query.limit) || 100`：`limit=abc` → NaN → 静默回落 100；`limit=-1` → 传 `LIMIT -1` 给 Postgres → 500 并在 `details` 透出数据库报错。
  - `status` 原样拼进 `WHERE status = $1`，`status=bogus` → 200 `[]`。
- `packages/brain/server.js:499` 挂的 `src/routes/task-tasks.js:386` `GET /` 被上面遮蔽，同样存在 `parseInt(limit)` 与 status 不校验问题。
- 合法状态唯一来源：`packages/brain/src/lib/task-status-transitions.js:52` 导出的 `TASK_STATUSES`（pending/queued/in_progress/等待态/终态）。

### S-1
对应：I-1、I-2

新增共享校验函数，集中解析 tasks 列表查询的 `status` 与 `limit`。

- 新建 `packages/brain/src/lib/task-list-query.js`，导出 `parseTaskListQuery(query, { defaultLimit })`：
  - `status`：未传或空串 → `undefined`（不筛选）；传了但不在 `TASK_STATUSES` 中 → 返回错误对象 `{ status: 400, body: { error: 'invalid_status', message: 'status 取值非法：<值>', allowed: [...TASK_STATUSES] } }`。
  - `limit`：未传 → `defaultLimit`；传了则必须匹配 `/^[1-9]\d*$/` 且数值 ≤ 1000（导出常量 `MAX_TASK_LIST_LIMIT = 1000`；拒绝 `abc`、`-1`、`0`、`1.5`、`1001`、`99999999999999999999`、空串、数组形式的重复参数），否则返回 `{ status: 400, body: { error: 'invalid_limit', message: 'limit 必须是 1~1000 的正整数', got: <原值> } }`。超上限一律 400，不做钳制。
  - 合法时返回 `{ ok: true, status, limit }`。
  - 错误体不得包含数据库报错字段（无 `details`）。
- 验证：
  - `cd packages/brain && npx vitest run src/lib/__tests__/task-list-query.test.js`，断言：
    - `parseTaskListQuery({ status: 'bogus' })` → `status===400`，`body.allowed` 等于 `TASK_STATUSES`，且包含 `'queued'`。
    - `{ limit: 'abc' }`、`{ limit: '-1' }`、`{ limit: '0' }`、`{ limit: '1.5' }`、`{ limit: '1001' }`、`{ limit: '99999999999999999999' }` → `status===400`，`body.error==='invalid_limit'`，`body.message` 含「正整数」。
    - `{ status: 'queued', limit: '5' }` → `{ ok: true, status: 'queued', limit: 5 }`；`{ limit: '1000' }` → `ok: true, limit: 1000`（上限本身合法）。
    - `{}` → `{ ok: true, status: undefined, limit: defaultLimit }`。

### S-2
对应：I-1、I-2、I-3、I-4

在实际生效的 `GET /api/brain/tasks` 处理器接入校验。

- 改 `packages/brain/src/routes/status.js`（`router.get('/tasks')`，约 284 行）：
  - 进入 `try` 前调用 `parseTaskListQuery(req.query, { defaultLimit: 100 })`；出错直接 `res.status(err.status).json(err.body)` 返回，不查库。
  - 用解析出的 `status` / `limit` 替换原 `parseInt(req.query.limit) || 100` 与 `req.query.status`；`task_type`、`sprint_dir` 逻辑不变。
  - 无参数时仍走 `getTopTasks(100)`，返回值形态（数组）不变。
  - 第 325 行 catch 改为 `console.error` 记日志后返回 `res.status(500).json({ error: 'Failed to get tasks' })`，响应体不再带 `details`（兜底：任何未预期的库错误都不透出给调用方）。
- 验证：新增 `packages/brain/src/__tests__/routes/status-tasks-query-validation.test.js`（supertest + mock `pool`/`getTopTasks`，挂 `statusRouter` 到 `/api/brain`）：
  - `GET /api/brain/tasks?status=bogus` → 400，`body.allowed` 含 `queued`，且 `pool.query` 未被调用。
  - `GET /api/brain/tasks?limit=abc`、`?limit=-1` 与 `?status=queued&limit=99999999999999999999` → 400，`body.error==='invalid_limit'`，`pool.query` 未被调用，响应体无 `details`。
  - `GET /api/brain/tasks?status=queued&limit=5` → 200，`pool.query` 的参数为 `['queued', 5]`。
  - `GET /api/brain/tasks` → 200 数组，`getTopTasks` 以 `100` 被调用。
  - mock `pool.query` 抛错时 `?status=queued` → 500，响应体无 `details` 字段。
  - 该测试文件作为回归测试永久保留在 brain CI。

### S-3
对应：I-1、I-2、I-3、I-4

被遮蔽的同路径处理器同步收口，避免将来挂载顺序变化时问题复现。

- 改 `packages/brain/src/routes/task-tasks.js`（`router.get('/')`，约 386 行）：用 `parseTaskListQuery(req.query, { defaultLimit: 200 })` 校验 `status`/`limit`，出错返回同样的 400 体；`offset` 保持原逻辑；合法请求的 SQL、返回字段（含 `queue_lane`）不变。
- 验证：在 `packages/brain/src/__tests__/routes/task-tasks.test.js` 追加用例：`?status=bogus`、`?limit=abc` → 400；`?status=queued&limit=5` → 200 且 SQL 参数含 `'queued'` 与 `5`。现有 `task-queue-lanes-route.test.js` 必须仍然通过。

### S-4
对应：I-1、I-2、I-3、I-4

Brain DevGate 与全量回归。

- 不改 `DEFINITION.md`、不手动改版本号（自动 patch bump 流程负责）。
- 验证（在 worktree 根目录依次执行，均须退出码 0）：
  - `node scripts/facts-check.mjs`
  - `bash scripts/check-version-sync.sh`
  - `node packages/quality/scripts/devgate/check-dod-mapping.cjs`
  - `cd packages/brain && npx vitest run src/lib/__tests__/task-list-query.test.js src/__tests__/routes/status-tasks-query-validation.test.js src/__tests__/routes/task-tasks.test.js src/__tests__/task-queue-lanes-route.test.js src/__tests__/tasks-status.test.js`

## QA 场景

### Q-1
对应: I-1
前提: 按本分支代码在本机起 Brain，**必须关 tick 防止派发改动任务状态**（`cd packages/brain && CECELIA_TICK_HARD_OFF=1 PORT=5299 DATABASE_URL=<cecelia_test 测试库> node server.js`，启动日志出现 `CECELIA_TICK_HARD_OFF=1 — env 硬关` 字样），测试库 tasks 表至少有 1 条 queued 任务。
操作: `curl -s -w '\nHTTP %{http_code}\n' 'http://localhost:5299/api/brain/tasks?status=bogus'`
期望: HTTP 400；JSON 含 `"error":"invalid_status"`，`allowed` 数组列出合法状态，至少含 `queued`、`in_progress`、`completed`；响应体中没有 `details`、没有 Postgres 报错文本。

### Q-2
对应: I-1
前提: 同 Q-1。
操作: 依次请求大小写/拼写近似的错误值：`?status=Queued`、`?status=queue`、`?status=%20`（仅空格）。
期望: 三次均 HTTP 400 且带 `allowed` 列表（不会因大小写或拼写错误静默返回 `[]`）。

### Q-3
对应: I-2
前提: 同 Q-1。
操作: 分别请求 `?limit=abc`、`?limit=-1`、`?limit=0`、`?limit=1.5`、`?status=queued&limit=99999999999999999999`。
期望: 五次均 HTTP 400；JSON 含 `"error":"invalid_limit"`，`message` 说明 limit 必须是 1~1000 的正整数；响应体无 `details`，`?limit=-1` 与超大 limit 不再出现 500 或任何数据库报错文本（如 "LIMIT must not be negative"、"bigint out of range"）。

### Q-4
对应: I-1、I-2
前提: 同 Q-1。
操作: `curl -s -w '\nHTTP %{http_code}\n' 'http://localhost:5299/api/brain/tasks?status=bogus&limit=abc'`（两个参数同时非法）。
期望: HTTP 400，返回其中一个参数的明确错误说明（error 为 `invalid_status` 或 `invalid_limit`），不返回 200 / 500。

### Q-5
对应: I-3
前提: 同 Q-1，测试库中 queued 任务多于 5 条（不足时先用 `POST /api/brain/tasks` 建 6 条不同 title 的测试任务）。
操作: `curl -s 'http://localhost:5299/api/brain/tasks?status=queued&limit=5' | jq 'length, [.[].status] | unique'`
期望: HTTP 200；数组长度 ≤ 5（数据足够时恰为 5）；所有元素 `status` 都是 `queued`。

### Q-6
对应: I-3
前提: 同 Q-1。
操作: 请求一个合法但当前无数据的状态，如 `?status=quarantined&limit=3`。
期望: HTTP 200 返回 `[]`（合法状态无数据仍是空数组，不误报 400）。

### Q-7
对应: I-4
前提: 同 Q-1；另在 main 分支 worktree 用同样命令（同一测试库、同样 `CECELIA_TICK_HARD_OFF=1`）在 5298 端口起一个改动前的 Brain 作基线。
操作: 先在两端各请求一次 `curl -s -w '\nHTTP %{http_code}\n' 'http://localhost:<端口>/api/brain/tasks' | head -c 500` 看状态码；再执行 `diff <(curl -s localhost:5298/api/brain/tasks | jq '[.[].id]') <(curl -s localhost:5299/api/brain/tasks | jq '[.[].id]')`。
期望: 两端均 HTTP 200；本分支返回 JSON 数组（`jq type` 为 `"array"`），条数 ≤ 100；diff 无输出（id 列表与顺序和改动前完全一致）。

### Q-8
对应: I-3、I-4
前提: 同 Q-1。
操作: 带其它原有筛选参数请求：`?task_type=dev&limit=2`，以及 `?limit=5`（只给合法 limit）。
期望: 均 HTTP 200 数组；`task_type=dev` 时所有元素 `task_type` 为 `dev` 且条数 ≤ 2；仅 `limit=5` 时条数 ≤ 5。
