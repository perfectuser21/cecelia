---
task_id: 05ae922c-4f2a-4c1c-9f86-d24937fc32d3
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4", "01-intent.md#I-5"]
---

# 实现规格：非法参数请求返回 400，不挂死、不泄露数据库报错

根因（已读代码确认）：
- `packages/brain/src/routes/task-projects.js:231` 与 `packages/brain/src/routes/task-goals.js:202` 的 `GET /:id` 是 async 处理函数且没有 try/catch。Brain 用的是 Express 4（`packages/brain/package.json` 里 `"express": "^4.18.2"`），async 函数抛出的 reject 不会传给错误中间件，所以 `pool.query` 遇到非法 uuid 报错后请求一直挂着不返回。
- `packages/brain/src/routes/journeys.js:43` 的 catch 分支把 `err.message` 原样塞进 500 响应。
- `packages/brain/src/routes/dev-records.js:18-19`：`parseInt('-1')` 得 -1（是真值，不会落到默认 50），于是被传给 `LIMIT`，catch 分支再把数据库原文放进 500 响应。

统一做法：照搬 `task-tasks.js:40-41,435` 的写法。查库之前先用文件内的 `UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` 校验，不合法直接返回 400 和固定文案。

### S-1
- 对应：I-1、I-5
- 改动文件：`packages/brain/src/routes/task-projects.js`
- 做法：
  1. 在文件顶部定义 `UUID_RE`（正则同 task-tasks.js）。
  2. `GET /:id` 开头加上 `if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid project id: must be a UUID' });`，校验在任何 `pool.query` 之前。
  3. 处理函数整体包进 try/catch，catch 里返回 `res.status(500).json({ error: 'Failed to get project' })`，用 `console.error` 记日志，响应体不带 `err.message`。这样 DB 出别的异常时也不会挂死。
  4. 合法但不存在的 uuid 仍按现有逻辑返回 404 `{ error: 'project not found' }`。
  5. 这个 router 同时挂在 `/api/brain/projects`、`/api/brain/tasks/projects` 和 `/api/brain/okr/projects`（okr-hierarchy.js 复用），三个入口都会生效。`router.use('/', projectLocateRoutes)` 挂在 `/:id` 之前，`/locate` 不受影响。
- 验证：
  - 在 `packages/brain/src/routes/__tests__/task-projects.test.js` 新增回归用例（用 supertest 和已有的 mockPool）：
    - `GET /not-a-uuid` 的断言：status 400；`body.error === 'Invalid project id: must be a UUID'`；`mockPool.query` 没被调用；`JSON.stringify(body)` 不含 `invalid input syntax`。
    - `GET /00000000-0000-4000-8000-000000000000`（mockPool 返回空 rows）的断言：status 404。
    - mockPool 抛 `new Error('boom db detail')` 时：status 500，响应体不含 `boom db detail`。
  - 既有用例同步改 id（不删用例）：`task-projects.test.js:107-132` 里的 `GET /projects/non-existent` 改为 `GET /projects/00000000-0000-4000-8000-000000000002`（仍期望 404 + `project not found`）；`GET /projects/p1` 改为 `GET /projects/00000000-0000-4000-8000-000000000001`，mock 返回行的 id 与 `countParams` 断言同步改成该 uuid，其余断言保持不变。PATCH 用例不在本次改动范围内，不动。
  - 命令：`cd packages/brain && npx vitest run src/routes/__tests__/task-projects.test.js`

### S-2
- 对应：I-2、I-5
- 改动文件：`packages/brain/src/routes/task-goals.js`
- 做法：与 S-1 相同。`GET /:id` 开头先校验 `UUID_RE`，不合法返回 400 `{ error: 'Invalid goal id: must be a UUID' }`，然后才查 objectives 和 key_results。整体包 try/catch，500 只返回 `{ error: 'Failed to get goal' }`，不带数据库原文。合法但不存在的 uuid 仍返回 404 `{ error: 'goal not found' }`。如果文件里已有同名正则就复用，不要重复定义。
- 验证：
  - 在已 mock `db.js` 的 `packages/brain/src/__tests__/routes/task-goals.test.js`（第 10 行 `vi.mock('../../db.js', () => ({ default: mockPool }))`）新增用例：
    - `GET /goals/not-a-uuid` 返回 400，error 文案相符，`mockPool.query` 没被调用。
    - 合法 uuid 且两次查询都是空 rows 时返回 404。
    - 查询抛错时返回 500，响应体不含错误原文。
  - 同文件既有用例同步改 id（不删用例）：`:114-156` 的 `GET /goals/non-existent` 改为 `00000000-0000-4000-8000-000000000003`（仍期望 404、仍断言查询 2 次、先 objectives 后 key_results）；`/goals/g1`、`/goals/kr1` 分别改为 `00000000-0000-4000-8000-000000000011`、`00000000-0000-4000-8000-000000000012`，mock 返回行 id 与 `res.body.id` 断言同步改。PATCH 用例不动。
  - 命令：`cd packages/brain && npx vitest run src/routes/__tests__/task-goals.test.js src/__tests__/routes/task-goals.test.js`

### S-3
- 对应：I-3、I-5
- 改动文件：`packages/brain/src/routes/journeys.js`
- 做法：
  1. 在文件顶部定义 `UUID_RE`。
  2. `GET /journeys/:id` 先校验，不合法返回 400 `{ error: 'Invalid journey id: must be a UUID' }`。
  3. 这个路由的 catch 分支改成 `res.status(500).json({ error: 'Failed to get journey' })`，`err.message` 只写进 console.error。
  4. 合法但不存在的 uuid 仍返回 404 `{ error: 'not found' }`。
- 验证：
  - 在 `packages/brain/src/routes/__tests__/journeys.test.js` 新增用例：
    - `GET /journeys/not-a-uuid` 返回 400，响应体不含 `invalid input syntax`，`pool.query` 没被调用。
    - 合法 uuid 且返回空 rows 时为 404。
    - 查询抛错时返回 500，响应体不含错误原文。
  - 命令：`cd packages/brain && npx vitest run src/routes/__tests__/journeys.test.js`

### S-4
- 对应：I-4
- 改动文件：`packages/brain/src/routes/dev-records.js`
- 做法：
  1. 在 `GET /` 里加一个小的解析函数。`req.query.limit` 和 `req.query.offset` 没传时沿用现有默认值（limit 50、offset 0；limit 上限 200，`limit=0` 仍按现有逻辑回落到 50）。只要传了值但不匹配 `/^\d+$/`（负数、小数、非数字、空串都算），就在查库前返回 400：`{ success: false, error: 'limit must be a non-negative integer' }`，offset 同理返回 `'offset must be a non-negative integer'`。
  2. `GET /`、`GET /:id` 的 catch 分支改成固定文案（如 `'Failed to list dev records'` / `'Failed to get dev record'`），不再回传 `err.message`。
- 验证：
  - 在 `packages/brain/src/routes/__tests__/dev-records.test.js` 新增用例（该文件现有用例只读源码、没有 mock，新增部分照 `journeys-get-features.test.js:4` 的写法加 `vi.mock('../../db.js', () => ({ default: { query: mockQuery } }))`，用 express + supertest 挂路由，不连真库）：
    - `GET /?limit=-1` 返回 400，`body.error` 含 `limit must be a non-negative integer`，响应体不含 `LIMIT must not be negative`，`pool.query` 没被调用。
    - `limit=abc` 和 `offset=-5` 都返回 400。
    - `limit=10` 返回 200，并且第一次查询的 params 首项是 10。
    - 不传参数时返回 200，params 是 `[50, 0]`。
  - 命令：`cd packages/brain && npx vitest run src/routes/__tests__/dev-records.test.js src/__tests__/canary-isolation.test.js`

### S-5
- 对应：I-1、I-2、I-3、I-4、I-5
- 改动文件：无新增文件。DevGate 和全量回归只用于验证。
- 验证：
  - `node scripts/facts-check.mjs`
  - `bash scripts/check-version-sync.sh`
  - `node packages/quality/scripts/devgate/check-dod-mapping.cjs`
  - `cd packages/brain && npx vitest run src/routes/__tests__ src/__tests__/routes`：全部通过，没有破坏既有用例。

## QA 场景

公共前提（照抄执行）：
1. 准备测试库：`bash packages/brain/scripts/setup-test-db.sh`（幂等创建 `cecelia_test` 并跑全部 migrations）。
2. 启动 Brain（指定测试库、硬关 tick loop，不派发任务）：`cd packages/brain && DB_NAME=cecelia_test CECELIA_TICK_HARD_OFF=1 PORT=5299 node server.js`，记 `B=http://localhost:5299/api/brain`。
3. 就绪检查：`curl -s -m 2 -o /dev/null -w '%{http_code}\n' "$B/dev-records?limit=1"` 输出 `200` 后才开始跑 Q-n。

"数据库报错原文"统一按以下串判定（不用 `uuid`/`UUID` 判定，因为正确文案本身含 `UUID`）：`invalid input syntax`、`for type uuid`、`22P02`、`LIMIT must not be negative`。

### Q-1
对应: I-1
前提: Brain 已启动（见公共前提）
操作: 运行 `curl -s -m 2 -o /tmp/q1.json -w '%{http_code} %{time_total}\n' "$B/projects/not-a-uuid"`，再 `cat /tmp/q1.json`；对 `$B/tasks/projects/not-a-uuid` 和 `$B/okr/projects/not-a-uuid` 各重复一次
期望: 三次都输出 `400`，耗时小于 2 秒，curl 没有超时退出（退出码不是 28）；响应体是 `{"error":"Invalid project id: must be a UUID"}`；`grep -cE 'invalid input syntax|for type uuid|22P02' /tmp/q1.json` 结果为 0

### Q-2
对应: I-2
前提: Brain 已启动
操作: `curl -s -m 2 -w '\n%{http_code} %{time_total}\n' "$B/goals/not-a-uuid"`；对 `$B/tasks/goals/not-a-uuid` 再做一次
期望: 两次都在 2 秒内返回 `400`，响应体是 `{"error":"Invalid goal id: must be a UUID"}`，不含 `invalid input syntax`、`for type uuid`、`22P02`

### Q-3
对应: I-3
前提: Brain 已启动
操作: `curl -s -m 2 -w '\n%{http_code}\n' "$B/journeys/not-a-uuid"`
期望: 返回 `400`，响应体是 `{"error":"Invalid journey id: must be a UUID"}`，不含 `invalid input syntax`、`for type uuid`、`22P02`

### Q-4
对应: I-4
前提: Brain 已启动
操作: `curl -s -m 2 -w '\n%{http_code}\n' "$B/dev-records?limit=-1"`
期望: 返回 `400`，响应体 `error` 字段含 `limit must be a non-negative integer`，不含 `LIMIT must not be negative`

### Q-5
对应: I-4
前提: Brain 已启动
操作: 依次请求 `"$B/dev-records?limit=abc"`、`"$B/dev-records?offset=-5"`、`"$B/dev-records?limit=1.5"`
期望: 三个请求都返回 `400`，error 分别说明 limit / offset / limit 必须是非负整数，响应体都不含数据库报错原文

### Q-6
对应: I-4
前提: Brain 已启动，测试库 dev_records 里至少有 3 条非 canary 记录（没有的话先 `POST $B/dev-records` 写入 3 条，pr_title 分别为 qa-1/qa-2/qa-3）
操作: `curl -s "$B/dev-records?limit=2"` 和 `curl -s "$B/dev-records"`
期望: 两个请求都返回 200。前者 `data` 长度为 2 且 `success:true`；后者 `data` 非空、`total` 不小于 3。正常分页没有被新校验误伤

### Q-7
对应: I-5
前提: Brain 已启动
操作: 用一个合法但库里没有的 uuid `00000000-0000-4000-8000-000000000000`，依次 GET `$B/projects/<uuid>`、`$B/goals/<uuid>`、`$B/journeys/<uuid>`；再用大写形式 `00000000-0000-4000-8000-00000000ABCD` 请求一次 `$B/projects/<uuid>`
期望: 四次都在 2 秒内返回 `404`，error 分别为 `project not found` / `goal not found` / `not found`。大写 uuid 不能被误判为 400

### Q-8
对应: I-1、I-5
前提: Brain 已启动；先 `curl -s -X POST "$B/projects" -H 'Content-Type: application/json' -d '{"name":"qa-spec-project"}'` 新建一个项目，记下返回的 id
操作: `curl -s -w '\n%{http_code}\n' "$B/projects/<id>"`；对这个 id 再请求两次（重复操作）
期望: 三次都返回 `200`，响应体含 `"name":"qa-spec-project"`、`children_count`、`completed_count`。合法 id 的正常读取不受影响，重复请求结果一致

### Q-9
对应: I-1、I-2、I-3
前提: Brain 已启动
操作: 并发发 20 个非法 id 请求：`for i in $(seq 20); do curl -s -m 2 -o /dev/null -w '%{http_code}\n' "$B/projects/bad-$i" & done; wait`，goals 再做一次；然后立刻 `curl -s -m 2 -w '%{http_code}\n' -o /dev/null "$B/journeys/00000000-0000-4000-8000-000000000000"`
期望: 40 个请求全部输出 `400`，没有 `000`（超时或无状态码）；之后的 journeys 请求仍在 2 秒内返回 `404`，说明 Brain 没有因为请求挂起而卡住连接或被拖垮
