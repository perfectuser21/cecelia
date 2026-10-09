---
task_id: 3e8414f6-19a4-415a-9b27-8e6353e9c6e2
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4"]
---
# Build 总结：GET /api/brain/tasks 非法筛选参数返回 400

### B-1
- 对应：S-1
- 改动文件：新建 `packages/brain/src/lib/task-list-query.js`（导出 `parseTaskListQuery(query, { defaultLimit })` 与 `MAX_TASK_LIST_LIMIT = 1000`；status 以 `TASK_STATUSES` 为唯一来源；limit 必须匹配 `/^[1-9]\d*$/` 且 ≤ 1000，数组形式/空串/超上限一律 400，不钳制；错误体不含 `details`）
- 新增测试：`packages/brain/src/lib/__tests__/task-list-query.test.js`（15 个用例：bogus/Queued/queue/空格 status；abc/-1/0/1.5/1001/99999999999999999999/空串/数组 limit；合法组合；limit=1000 上限；无参数默认值）
- 测试命令：`cd packages/brain && npx vitest run src/lib/__tests__/task-list-query.test.js`
  - 先跑（实现前）：FAIL —— `Failed to load url ../task-list-query.js ... Does the file exist?`
  - 实现后：`Test Files 1 passed (1) / Tests 15 passed (15)`
- 提交 SHA：`ad657b74e`

### B-2
- 对应：S-2
- 改动文件：`packages/brain/src/routes/status.js`（`router.get('/tasks')`：进入 try 前调 `parseTaskListQuery(req.query, { defaultLimit: 100 })`，出错直接 400 不查库；用解析出的 status/limit 替换 `parseInt(req.query.limit) || 100` 与 `req.query.status`；task_type/sprint_dir 不变；无参数仍走 `getTopTasks(100)`；catch 改为 `console.error` 记日志后返回 `{ error: 'Failed to get tasks' }`，不再带 `details`）
- 新增测试：`packages/brain/src/__tests__/routes/status-tasks-query-validation.test.js`（supertest，mock `db.js` 与 `routes/shared.js` 的 `getTopTasks`，statusRouter 挂到 `/api/brain`；7 个用例：status=bogus→400 且未查库；limit=abc / limit=-1 / status=queued&limit=99999999999999999999 →400 invalid_limit、无 details、未查库；status=queued&limit=5→200 且参数 `['queued', 5]`；无参数→200 数组、`getTopTasks(100)`；库报错→500 且响应体恰为 `{ error: 'Failed to get tasks' }`）。作为回归测试永久保留。
- 测试命令：`cd packages/brain && npx vitest run src/__tests__/routes/status-tasks-query-validation.test.js`
  - 先跑（实现前）：`Tests 5 failed | 2 passed (7)`（例如 `expected 500 to be 400`、`expected 200 to be 400`，500 体带 details）
  - 实现后：`Tests 7 passed (7)`
- 提交 SHA：`1ed5673c0`

### B-3
- 对应：S-3
- 改动文件：`packages/brain/src/routes/task-tasks.js`（`router.get('/')`：用 `parseTaskListQuery(req.query, { defaultLimit: 200 })` 校验 status/limit，出错返回同样 400 体；offset 保持 `parseInt(offset)` 原逻辑；SQL 与返回字段（含 `queue_lane`）不变）
- 新增测试：在 `packages/brain/src/__tests__/routes/task-tasks.test.js` 的 `GET /tasks` 下追加 3 个用例：`?status=bogus`→400 invalid_status、`?limit=abc`→400 invalid_limit（均未查库）；`?status=queued&limit=5`→200 且 SQL 参数含 `'queued'` 与 `5`
- 测试命令：`cd packages/brain && npx vitest run src/__tests__/routes/task-tasks.test.js [src/__tests__/task-queue-lanes-route.test.js]`
  - 先跑（实现前）：`Tests 2 failed | 28 passed (30)`（`expected 500 to be 400`）
  - 实现后（含 task-queue-lanes-route）：`Test Files 2 passed (2) / Tests 31 passed (31)`
- 提交 SHA：`27c102b10`

### B-4
- 对应：S-4
- 改动文件：无（未改 DEFINITION.md、未改版本号）
- DevGate（worktree 根目录，均退出码 0）：
  - `node scripts/facts-check.mjs` → `All facts consistent.`，exit 0
  - `bash scripts/check-version-sync.sh` → `✅ All version files in sync`，exit 0
  - `node packages/quality/scripts/devgate/check-dod-mapping.cjs` → `✅ 映射检查通过 (279 项)`，exit 0
- 回归命令：`cd packages/brain && npx vitest run src/lib/__tests__/task-list-query.test.js src/__tests__/routes/status-tasks-query-validation.test.js src/__tests__/routes/task-tasks.test.js src/__tests__/task-queue-lanes-route.test.js src/__tests__/tasks-status.test.js`
  - 输出：`Test Files 4 passed (4) / Tests 53 passed (53)`，exit 0
  - 说明：`src/__tests__/tasks-status.test.js` 在 `packages/brain/vitest.config.js` 的 exclude 列表中（需真实 Postgres 的 PATCH 状态测试），单元配置下未被收集执行，所以只计 4 个文件；该文件测的是 PATCH，与本次改的 GET 处理器无关。
- 扩大回归：引用 `routes/status.js` 或 `routes/task-tasks.js` 的全部非集成测试（20 个文件，含 status.test.js、task-get-invalid-id、task-tasks-claim、governance-guards 等）→ `Test Files 20 passed (20) / Tests 208 passed (208)`
- 提交 SHA：无新提交（验证步骤）
