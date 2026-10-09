---
task_id: 4ac5fa39-521e-48b8-8b1a-ae1b79bcba2d
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3"]
---
# 实现规格：GET /api/brain/tasks/:id 非法 id 返回 400

现状：`GET /api/brain/tasks/:id` 的处理函数在 `packages/brain/src/routes/task-tasks.js:432`（由 `packages/brain/server.js:499` 挂到 `/api/brain/tasks`）。它把 `req.params.id` 直接传给 `SELECT * FROM tasks WHERE id = $1`。id 不是 UUID 时，PG 抛 `22P02 invalid input syntax for type uuid`，catch 分支返回 `500 { error, details: err.message }`，把数据库原始报错透给了调用方。

### S-1
对应: I-1, I-2

改动文件:
- `packages/brain/src/routes/task-tasks.js`

做法:
1. 在文件顶部常量区新增 `const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;`（写法与 `routes/okr-hierarchy.js:452` 一致）。
2. 在 `router.get('/:id', ...)` 处理函数的最前面、`pool.query` 之前加校验：`UUID_RE.test(req.params.id)` 为假时直接返回 `res.status(400).json({ error: 'Invalid task id: must be a UUID' })`，不查数据库。这里不回显 id，避免把空格或注入串原样返回。
3. 兜底：catch 分支中，如果 `err.code === '22P02'`，同样返回 400 和上面的错误文案，不带 `details`。其余错误保持现有 500 行为，本次不扩大改动范围。
4. 不改动 `/:id/chain`、PATCH、DELETE 等其他路由。

验证:
- 新增回归测试 `packages/brain/src/__tests__/task-get-invalid-id.test.js`，写法参照 `task-api-prd-fallback.test.js`：先 `vi.doMock('../db.js')` 注入 mock pool，再用 supertest 挂到 `/api/brain/tasks`。需要以下断言：
  - `GET /api/brain/tasks/not-a-uuid` → `status === 400`；`JSON.stringify(body)` 不含 `invalid input syntax`；`mockPool.query` 调用次数为 0。
  - `GET /api/brain/tasks/%20` → `status === 400`；body 不含 `invalid input syntax`，也不含 `uuid` 类型报错字样（`for type uuid`）；`mockPool.query` 调用次数为 0。
  - 兜底分支：合法 UUID 时让 mock `query` 抛出 `Object.assign(new Error('invalid input syntax for type uuid: "x"'), { code: '22P02' })` → 返回 400，body 不含 `invalid input syntax`。
- 命令：`cd packages/brain && npx vitest run src/__tests__/task-get-invalid-id.test.js` 全部通过。在修复前的代码上，前两条断言必须失败（这是 failing-first 的证据）。
- DevGate：`node scripts/facts-check.mjs`、`bash scripts/check-version-sync.sh`、`node packages/quality/scripts/devgate/check-dod-mapping.cjs` 都通过。

### S-2
对应: I-3

改动文件:
- `packages/brain/src/__tests__/task-get-invalid-id.test.js`（与 S-1 同一文件，只新增用例；`task-tasks.js` 中原有的 404 逻辑不改）
- `packages/brain/src/__tests__/routes/task-tasks.test.js`：第 115 行 `/tasks/non-existent` 改为 `/tasks/00000000-0000-4000-8000-000000000000`；第 121、123 行的 `t1` 改为 `11111111-1111-4111-8111-111111111111`。断言保持 404 / 200 + title 不变
- `packages/brain/src/__tests__/integration/brain-endpoint-contracts.test.js`：第 155 行 `task-contract-001`、第 170 行 `nonexistent-id` 都换成合法 UUID（第 155 行的 mock 行 id 同步改）。断言保持 200 / 404 不变
  （全仓库用非 UUID 的 id 做 GET `/tasks/:id` 的 mock 测试只有这 4 处；`agent-lifecycle`、`task-status-transitions`、`golden-path` 三个集成测试的 id 来自真实 PG 插入，本来就是 UUID，不受影响）

做法: 合法 UUID 继续正常查库；查不到时保持原样返回 `404 { error: 'Task not found', id }`；查到时返回 200 和该行数据。

验证（在同一测试文件内）:
- mock `query` 返回 `{ rows: [] }`，`GET /api/brain/tasks/00000000-0000-4000-8000-000000000000` → `status === 404`，`body.error === 'Task not found'`，`mockPool.query` 调用了 1 次，参数为该 UUID。
- mock `query` 返回一行 `{ id: <uuid>, title: 't' }` → `status === 200`，`body.id === <uuid>`。
- 大写 UUID（如 `AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA`）不会被判为非法，即不返回 400。
- 不回归：`cd packages/brain && npx vitest run src/__tests__/task-get-invalid-id.test.js src/__tests__/routes/task-tasks.test.js src/__tests__/integration/brain-endpoint-contracts.test.js` 全部通过。

## QA 场景

### Q-1
对应: I-1
前提: Brain 服务已启动（预览环境或本地 `localhost:5221`），连接的 PostgreSQL 可用
操作: 运行 `curl -s -w '\nHTTP=%{http_code}\n' http://localhost:5221/api/brain/tasks/not-a-uuid`
期望: 输出最后一行为 `HTTP=400`；响应体是 JSON，带 `error` 字段，内容说明 id 必须是 UUID；整段响应不含 `invalid input syntax`，不含 `for type uuid`，也没有 `details` 字段

### Q-2
对应: I-2
前提: 同 Q-1
操作: 运行 `curl -s -w '\nHTTP=%{http_code}\n' http://localhost:5221/api/brain/tasks/%20`
期望: `HTTP=400`；响应体不含 `invalid input syntax`，不含任何 PG 报错字样（`syntax`、`uuid:`），不含 `details`

### Q-3
对应: I-1, I-2
前提: 同 Q-1
操作: 依次请求以下几种用户可能误传的非法 id，每次都用 `curl -s -w '\nHTTP=%{http_code}\n'`：
1. `/api/brain/tasks/123`
2. `/api/brain/tasks/4ac5fa39`（短 id，日常口头引用常这样传）
3. `/api/brain/tasks/4ac5fa39-521e-48b8-8b1a-ae1b79bcba2dXX`（UUID 后多带字符）
4. `"http://localhost:5221/api/brain/tasks/%27%20OR%201=1--"`（注入串，整串加双引号，单引号写成 `%27`）
期望: 4 次都返回 `HTTP=400`；响应体都不含 `invalid input syntax`，也都不回显注入串

### Q-4
对应: I-3
前提: 同 Q-1；先确认 `00000000-0000-4000-8000-000000000000` 不在 tasks 表中（`curl -s 'http://localhost:5221/api/brain/tasks?limit=1'` 能返回数据，说明服务正常）
操作: 运行 `curl -s -w '\nHTTP=%{http_code}\n' http://localhost:5221/api/brain/tasks/00000000-0000-4000-8000-000000000000`
期望: `HTTP=404`；响应体为 `{"error":"Task not found","id":"00000000-0000-4000-8000-000000000000"}`

### Q-5
对应: I-3
前提: 同 Q-1；用 `curl -s 'http://localhost:5221/api/brain/tasks?limit=1'` 取到一个真实存在的任务 id，记为 `$ID`
操作:
1. 运行 `curl -s -w '\nHTTP=%{http_code}\n' http://localhost:5221/api/brain/tasks/$ID`
2. 把 `$ID` 转成大写后再请求一次
期望: 两次都返回 `HTTP=200`，响应体的 `id` 等于该任务 id（小写），这说明修复没有误伤合法 id

### Q-6
对应: I-1, I-3
前提: 同 Q-1
操作: 对同一个非法 id `not-a-uuid` 连续请求 3 次，然后请求 `/api/brain/tasks/$ID/chain`（`$ID` 用 Q-5 中的真实 id）
期望: 3 次结果一致，都是 400；之后 `/chain` 子路由照常返回 200 和链路数据，说明它没有被新加的校验拦掉
