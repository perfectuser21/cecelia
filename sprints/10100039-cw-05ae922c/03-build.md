---
task_id: 05ae922c-4f2a-4c1c-9f86-d24937fc32d3
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5"]
---

# 构建总结：非法参数请求返回 400，不挂死、不泄露数据库报错

TDD 顺序：先把 S-1~S-4 的新用例全部写好并运行，结果 `Test Files 4 failed (4) / Tests 9 failed | 101 passed (110)`（9 条新用例失败，task-goals 文件还因为 async reject 没被处理而报了文件级错误，这正是要修的挂死问题）。然后写实现，再运行，结果 `Test Files 4 passed (4) / Tests 110 passed (110)`。

### B-1
- 对应：S-1
- 改动文件：`packages/brain/src/routes/task-projects.js`
  - 文件顶部新增 `UUID_RE`，正则与 task-tasks.js 相同。
  - `GET /:id` 在查库之前先做校验，不合法返回 400 `{ error: 'Invalid project id: must be a UUID' }`。
  - 处理函数整体包进 try/catch，500 只返回 `{ error: 'Failed to get project' }`，`err.message` 只写进 console.error。
- 新增测试：`packages/brain/src/routes/__tests__/task-projects.test.js`
  - 非法 id：返回 400，error 文案一致，`mockPool.query` 没被调用，响应体不含 `invalid input syntax`。
  - 合法但不存在的 uuid：返回 404。
  - 查库抛出 `boom db detail`：返回 500，响应体不含这段原文。
  - 既有用例改用 uuid：`non-existent` 改为 `…000000000002`，`p1` 改为 `P1_UUID`（`…000000000001`），`countParams` 断言同步修改。
- 命令：`cd packages/brain && npx vitest run src/routes/__tests__/task-projects.test.js`
- 输出：`Test Files 1 passed (1) / Tests 28 passed (28)`
- 提交：`7c5b525a6`

### B-2
- 对应：S-2
- 改动文件：`packages/brain/src/routes/task-goals.js`
  - 原文件里没有 `UUID_RE`，这次新增。
  - `GET /:id` 先校验，不合法返回 400 `{ error: 'Invalid goal id: must be a UUID' }`。
  - 整体包进 try/catch，500 只返回 `{ error: 'Failed to get goal' }`。
- 新增测试：`packages/brain/src/__tests__/routes/task-goals.test.js`
  - 非法 id：返回 400，error 文案一致，没有查库。
  - 合法 uuid 且两张表都查不到：返回 404 `goal not found`。
  - 查库抛错：返回 500，响应体不含错误原文。
  - 既有用例改 id：`non-existent` 改为 `…000000000003`，`g1` 改为 `…000000000011`，`kr1` 改为 `…000000000012`。PATCH 用例没有动。
- 命令：`cd packages/brain && npx vitest run src/routes/__tests__/task-goals.test.js src/__tests__/routes/task-goals.test.js`
- 输出：`Test Files 2 passed (2) / Tests 27 passed (27)`
- 提交：`9a851108d`

### B-3
- 对应：S-3
- 改动文件：`packages/brain/src/routes/journeys.js`
  - 文件顶部新增 `UUID_RE`。
  - `GET /journeys/:id` 先校验，不合法返回 400 `{ error: 'Invalid journey id: must be a UUID' }`。
  - catch 分支改为返回 `{ error: 'Failed to get journey' }`。
- 新增测试：`packages/brain/src/routes/__tests__/journeys.test.js`，新增 describe `GET /api/brain/journeys/:id 非法参数`，共 3 条用例：
  - 返回 400，不查库，响应体不含 `invalid input syntax`。
  - 合法但不存在的 uuid 返回 404 `not found`。
  - 查库抛错返回 500，响应体不含错误原文。
- 命令：`cd packages/brain && npx vitest run src/routes/__tests__/journeys.test.js`
- 输出：`Test Files 1 passed (1) / Tests 50 passed (50)`
- 提交：`3ae9f5c28`

### B-4
- 对应：S-4
- 改动文件：`packages/brain/src/routes/dev-records.js`
  - 新增 `parseNonNegativeInt`：参数没传时返回 undefined，沿用原默认值（limit 50、上限 200，`limit=0` 回落到 50，offset 0）；传了但不匹配 `/^\d+$/` 时返回 null。
  - `GET /` 在查库之前遇到 null 就返回 400，文案为 `limit must be a non-negative integer` 或 `offset must be a non-negative integer`。
  - `GET /` 的 catch 改为固定文案 `Failed to list dev records`，`GET /:id` 的 catch 改为 `Failed to get dev record`。
- 新增测试：`packages/brain/src/routes/__tests__/dev-records.test.js`
  - 新增 `vi.mock('../../db.js')`，用 express + supertest 挂路由。
  - `limit=-1`：返回 400，响应体不含 `LIMIT must not be negative`，没有查库。
  - `limit=abc` 和 `offset=-5`：都返回 400。
  - `limit=10`：返回 200，第一次查询的 params 首项是 10。
  - 不传参数：返回 200，params 为 `[50, 0]`。
  - 查库抛错：返回 500，响应体不含错误原文。
  - 原有 3 条读源码的用例保留。
- 命令：`cd packages/brain && npx vitest run src/routes/__tests__/dev-records.test.js src/__tests__/canary-isolation.test.js`
- 输出：`Test Files 2 passed (2) / Tests 17 passed (17)`
- 提交：`98eaa486e`

### B-5
- 对应：S-5（只做验证，没有改代码，也没有提交）
- `node scripts/facts-check.mjs`：输出 `All facts consistent.`
- `bash scripts/check-version-sync.sh`：输出 `✅ All version files in sync`
- `node packages/quality/scripts/devgate/check-dod-mapping.cjs`：输出 `✅ 映射检查通过 (279 项)`
- `cd packages/brain && npx vitest run src/routes/__tests__ src/__tests__/routes`：
  - 第一次运行结果为 `Test Files 1 failed | 158 passed (159) / Tests 8 failed | 1318 passed (1326)`。8 条失败全部在 `preview.test.js`，报错是 `expected 401 to be 200` 等。
  - 原因：本机 shell 里设置了 `DEPLOY_TOKEN`，`routes/preview.js` 会读这个变量做鉴权，所以测试拿到 401。preview 相关文件这次没有改动，与本次改动无关。
  - 去掉这个变量后重跑 `env -u DEPLOY_TOKEN npx vitest run src/routes/__tests__ src/__tests__/routes`，结果 `Test Files 159 passed (159) / Tests 1326 passed (1326)`，输出里没有 unhandled 错误。
- 提交：无（S-5 不改文件）
