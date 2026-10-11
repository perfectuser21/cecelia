---
task_id: 05cfbcde-1108-4018-93d6-a48464324b11
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4", "01-intent.md#I-5"]
---
# 实现规格：GET /api/brain/runs/:run_id 执行记录总记录读接口

## 现状核对（代码证据）

- `runs` 表（`packages/brain/migrations/531_runs_table.sql`）列：`id, run_id(text UNIQUE), workflow_id, trigger_kind, trigger_ref, schedule_entry_id, task_run_id, executor_kind, executor_id, started_at, ended_at, duration_ms, outcome, error, model, tokens_in(bigint), tokens_out(bigint), cost_usd(numeric), detail, header_source, created_at, updated_at`。spans 入库时由触发器 `spans_ensure_run`（BEFORE）建总记录、`spans_rollup_run`（AFTER，迁移 546 改过：`evidence.run_terminal=true` 的 span 定终态并把 header_source 转为 `owner`）汇总。
- `GET /api/brain/spans`（`packages/brain/src/routes/spans.js:43`）**不挂鉴权中间件**（开放只读）；`POST /api/brain/spans` 挂 `internalAuthOrLoopback`。
- `/api/brain/runs` 下现有两个路由（`packages/brain/server.js:474-475`）：
  - `createRunDefinitionsRouter()`（`src/routes/run-definitions.js:8`）在路由器顶部写了 `router.use(internalAuthOrLoopback)`——**凡是经过它的 `/api/brain/runs/*` 请求都会先被要求鉴权**，即使路径不匹配它自己的 `/:run_id/definition`。
  - `createRunReconciliationRouter()`：`GET /:run_id/reconciliation`，单路由挂 `internalAuthOrLoopback`。
- 全局错误处理（`server.js:586`）把所有 `next(err)` 一律回 500；Express 解析 `:run_id` 时遇到非法百分号编码（如 `%E0%A4%A`）会抛 `URIError` 走这里 → 现状会是 500。

## 规格

### S-1
- 对应：I-1、I-3
- 新建 `packages/brain/src/routes/runs-read.js`，导出 `createRunsReadRouter({ pool = defaultPool } = {})`（风格同 `run-reconciliation.js`，便于集成测试注入 pool），默认导出同函数。
- 路由：
  - `GET /:run_id`：只匹配单段路径（`/:run_id/definition`、`/:run_id/reconciliation` 两段路径不会被它命中）。Express 已对 `req.params.run_id` 做 `decodeURIComponent`，所以 `coding-workflow%3A<uuid>` 与未编码的 `coding-workflow:<uuid>` 都解析为同一个 run_id；`%2F` 编码的斜杠也落在同一段内。
  - `GET /`（即 `GET /api/brain/runs` 或 `/api/brain/runs/`）：返回 400 `{ "error": "run_id is required" }`。
- 入参校验（与 `GET /spans` 一致先 `trim()`）：
  - trim 后为空串 → 400 `{ "error": "run_id is required" }`；
  - 长度 > 200 字符（按 trim 后的 JS 字符串 `.length` 计）→ 400 `{ "error": "run_id must be at most 200 characters" }`；恰好 200 字符照常查库。
  - 含控制字符（`\u0000`–`\u001f`、`\u007f`，如 `a%00b`）→ 400 `{ "error": "run_id must not contain control characters" }`（coding commander 裁决补入，见文末「commander 裁决」）。
  - 非法百分号编码（`URIError`）→ 400 `{ "error": "run_id is not valid URL encoding" }`：在本路由器末尾挂一个**只处理 `URIError`** 的错误中间件，其它错误 `next(err)` 交还全局，不改全局错误处理。
- 查询：`SELECT * FROM runs WHERE run_id = $1`（参数化，不拼 SQL），每次请求直接读库，不加任何缓存。
  - 无行 → 404 `{ "error": "run not found: <run_id>" }`（run_id 回显前截到 200 字符以内，已由上面校验保证）。
  - 有行 → 200，响应体**顶层平铺**该行所有列，至少含 `run_id, workflow_id, trigger_kind, started_at, ended_at, outcome, header_source, tokens_in, tokens_out, cost_usd`。数值类型沿用 pg 驱动原样输出（与 `GET /spans` 一致）：`tokens_in/tokens_out`（bigint）与 `cost_usd`（numeric）为字符串或 `null`，不做转换。
  - 数据库异常 → 500 `{ "error": <message> }`（与 `GET /spans` 同语义）；调用方可直接重试（只读、幂等）。
- 鉴权：路由器顶部 `router.use(internalAuthOrLoopback)`，与 spans 路由器（`src/routes/spans.js`）写入侧用**同一套中间件**（意图「同一套中间件或同级开放策略」取前者，以满足铁律 INV-50954d28「无鉴权端点不准 ship」）。行为：设了 `CECELIA_INTERNAL_TOKEN` 时必须带 `x-internal-token` 或 `Authorization: Bearer`，缺/错 → 401 `UNAUTHORIZED`；未设 token 时只放行非 production 的 loopback，其余 503 `INTERNAL_AUTH_NOT_CONFIGURED`。鉴权先于入参校验执行。
- 失败语义与输入对抗面：空/空白/超长 → 400 不查库；不存在 → 404；编码非法 → 400；SQL 注入式输入（如 `x' OR '1'='1`）因参数化只会按字面值查，结果 404；重复、并发 GET 只读无副作用，结果一致。
- 真实调用方 shape：本接口新增，暂无存量调用方；预期调用方为人/AI 用 curl 或 `fetch` 核对运行，形如 `GET <brain>/api/brain/runs/<encodeURIComponent(run_id)>[?include=spans]`，无 body，header 带 `x-internal-token`（与 `brain.mjs` 第 29 行上报 spans 的 header 形状相同）。run_id 的真实来源形状：coding workflow runner `coding-workflow:<task_id>`（`packages/brain/scripts/coding-workflow/runner/lib/brain.mjs` 上报 spans 时使用）。
- 验证：
  - `cd packages/brain && npx vitest run src/routes/__tests__/integration/runs-read.test.js`（新集成测试，见 S-4）断言：200 字段齐全；编码/未编码冒号 run_id 都 200；不存在 404 且 `body.error` 为非空字符串；空白、201 字符、非法编码 400；200 字符不存在的 id 为 404。
  - 断言 `CECELIA_INTERNAL_TOKEN` 已设置时 `GET /api/brain/runs/<id>` 不带 token 401、错 token 401、带正确 token 200。

### S-2
- 对应：I-2
- 文件：`packages/brain/src/routes/runs-read.js`（同 S-1）。
- `include` 查询参数：按逗号拆分、逐项 trim，**包含 `spans`** 时附 spans；其它值忽略（不报错、不附 spans）。`include` 以数组形式重复出现（`?include=a&include=spans`）时合并判断。
- 带 spans 时：在同一个 `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` 只读事务里先查 runs 行、再查 `SELECT * FROM spans WHERE run_id = $1 ORDER BY started_at ASC, created_at ASC, id ASC`，保证总记录与明细出自同一快照；查完 `COMMIT`，异常 `ROLLBACK` 并 `release()` 连接（照 `readRunReconciliation` 写法）。
- 响应：`{ ...runs行, "spans": [ ... ] }`，每条 span 为表行全量，至少含 `occurrence_key, activity_id, outcome, cost_usd, started_at, ended_at`；该 run 无 span 时为 `[]`。
- 不带 include（或 include 不含 spans）时响应体**没有 `spans` 键**（不是空数组）。
- run 不存在时即使带 `include=spans` 也是 404（同 S-1）。
- 验证：集成测试断言乱序写入的两条 span 按 started_at 升序返回、字段齐全；不带 include 时 `'spans' in body === false`；`include=foo` 同样无 spans 键；`include=foo,spans` 有 spans。

### S-3
- 对应：I-4、I-5
- 文件：`packages/brain/server.js`
  - 顶部 import `createRunsReadRouter`（与第 99-100 行两个 run 路由 import 放一起）。
  - 挂载 `app.use('/api/brain/runs', createRunsReadRouter());` **放在第 474 行 `createRunDefinitionsRouter()` 之前**。新路由只匹配单段 `/:run_id` 与 `/`，两段路径自然落到后面原有两个路由，原有鉴权与行为不变；新路由器自带同一鉴权中间件，带合法 token 的两段请求经过它时放行，不带 token 时由它先回 401，与原先由 run-definitions 回的 401 状态码与 `error.code` 相同。
- I-4：不加缓存、每次 `pool.query` 直读；spans 由 `POST /api/brain/spans` 写入后触发器同事务内已建/更新 runs 行，GET 立即可见。
- 不改 `run-definitions.js`、`run-reconciliation.js`、spans 写入逻辑、任何迁移与表结构。
- 验证：
  - `node -e "import('./packages/brain/src/routes/runs-read.js').then(m=>{if(typeof m.createRunsReadRouter!=='function')process.exit(1)})"` 退出码 0。
  - `grep -n "createRunsReadRouter()" packages/brain/server.js` 的行号小于 `grep -n "createRunDefinitionsRouter()" packages/brain/server.js` 的行号。
  - 原有集成测试照旧通过：`cd packages/brain && npx vitest run src/routes/__tests__/integration/run-definitions.test.js src/routes/__tests__/integration/run-reconciliation.test.js src/__tests__/integration/span-provenance.pg.integration.test.js`。
  - 新集成测试（S-4）里把三个路由器按 server.js 同顺序挂到同一个 express app 上，断言：设置 `CECELIA_INTERNAL_TOKEN` 时 `GET /api/brain/runs/<id>/definition` 与 `/reconciliation` 不带 token 仍 401、带 token 行为不变；`GET /api/brain/runs/<id>` 带 token 200。

### S-4
- 对应：I-1、I-2、I-3、I-4、I-5
- 新建 `packages/brain/src/routes/__tests__/integration/runs-read.test.js`：真 Postgres 集成测试，fixture 照 `src/__tests__/integration/span-provenance.pg.integration.test.js`（`privateFixtureDatabase` + 迁移 531/546 的触发器真跑，不 mock 触发器），先用 `POST /api/brain/spans` 写 span 再 GET，断言触发器建出的总记录与汇总值（含 546 终态 span 把 outcome 定为 pass、header_source 转 owner）。
- 把该文件登记进 `packages/brain/vitest.config.js` 的 `POSTGRES_INTEGRATION_TESTS` 数组（紧跟第 30 行 `run-reconciliation.test.js` 之后），使其进入现有 integration CI 车道。
- 新建 `packages/brain/scripts/smoke/runs-read-smoke.sh`（feat 改 `brain/src` 须带 smoke）：对真起的 Brain（`BRAIN_URL` 环境变量，缺省时报错退出，不写死地址）执行 Q-1 → Q-5 的核心断言（POST span → GET 编码 run_id 200 → include=spans → 不存在 404 → 201 字符 400）；`CECELIA_INTERNAL_TOKEN` 已设置时 POST 与 GET 都带 `x-internal-token`，未设置时不带（只对 loopback 有效）；任何断言失败或 Brain 不可达都 `exit 1`，不静默跳过。写入与读取用同一个 `BRAIN_URL`。若仓库 smoke 有登记清单要求，按现有 smoke 的登记方式同步登记。
- 验证：
  - `cd packages/brain && npx vitest run src/routes/__tests__/integration/runs-read.test.js; echo "exit=$?"` 打印 `exit=0`（先在当前分支实跑确认退出码语义）。
  - `bash -n packages/brain/scripts/smoke/runs-read-smoke.sh` 退出码 0。
  - DevGate（改 Brain 前置）：`node scripts/facts-check.mjs`、`bash scripts/check-version-sync.sh`、`node packages/quality/scripts/devgate/check-dod-mapping.cjs` 全部退出码 0。

## QA 场景

> 约定：
> - **先判定执行环境**（预览 Brain 由 `scripts/preview-env-start.sh:324-341` 启动，`CECELIA_INTERNAL_TOKEN`/`NODE_ENV` 继承父进程，事先未知）：从 QA 机器执行 `curl -s -o /dev/null -w '%{http_code}' -X POST "<预览环境>/api/brain/spans" -H 'content-type: application/json' -d '[]'`。
>   - 返回 401 → 预览已配 token：`<目标>`=`<预览环境>`；在预览宿主机上取 token：`TOKEN=$(tr '\0' '\n' < /proc/$(cat /tmp/preview-<PR号>.pid)/environ | sed -n 's/^CECELIA_INTERNAL_TOKEN=//p')`（非 Linux 宿主用 `ps eww $(cat /tmp/preview-<PR号>.pid)` 取同名变量）。
>   - 返回 503 或 token 取不到 → 改用本机：在本分支 worktree 执行
>     1. `bash packages/brain/scripts/setup-test-db.sh`（幂等建 `cecelia_test` 并跑全套迁移）；
>     2. 启动（库名必须走 `DB_NAME`：`db-config.js:19` 只认 `DB_NAME`，不设会回落 `cecelia` 并在 `NODE_ENV=development` 下被 `db-config.js:33` 拒绝启动；`DB_*` 与 `DATABASE_URL` 指向同一库，与 `preview-env-start.sh:325-330` 同形）：`cd packages/brain && env DB_NAME=cecelia_test DB_HOST=localhost DB_USER=cecelia DB_PASSWORD="${DB_PASSWORD:-cecelia}" DATABASE_URL="postgresql://cecelia:${DB_PASSWORD:-cecelia}@localhost/cecelia_test" CECELIA_INTERNAL_TOKEN=qa-local-token NODE_ENV=development PORT=5299 SKIP_MIGRATIONS=false CECELIA_TICK_ENABLED=false BRAIN_PREVIEW=1 node server.js > /tmp/qa-brain-5299.log 2>&1 &`；
>     3. 就绪门：60 秒内轮询 `curl -s http://127.0.0.1:5299/`，body 含 `"status":"running"`（`server.js:564-566`）才算起来。
>     `<目标>`=`http://127.0.0.1:5299`，`TOKEN=qa-local-token`，报告里注明「预览未配 token，改本机分支 Brain」。
>   - 本机就绪门不过 → 报告贴 `tail -n 20 /tmp/qa-brain-5299.log`，按**环境阻塞**上报，不得记为接口失败，也不得跳过就判通过。
> - 下文所有请求默认带 `-H "x-internal-token: $TOKEN"`（真实调用方 `brain.mjs` 的 header 形状）；注明「不带 token」的除外。token 只放请求 header，不写进报告。
> - 所有 run_id 由场景自己生成，不依赖库里已有数据。span 的 `activity_id` 用迁移 542 固定插入的 coding workflow「规格」活动 `c0de0000-0000-4000-8000-000000000102`（任何跑过迁移的空库都有）。

### Q-1
对应: I-1, I-4
前提: 生成 `RID="coding-workflow:$(uuidgen | tr A-Z a-z)"`，该 run_id 在库中不存在。
操作:
1. `curl -s -o /dev/null -w '%{http_code}' "<目标>/api/brain/runs/$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$RID")"` —— 记录写入前状态码。
2. `curl -s -X POST "<目标>/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' -H "x-internal-token: $TOKEN" -d '{"run_id":"'"$RID"'","activity_id":"c0de0000-0000-4000-8000-000000000102","occurrence_key":"qa/spec/1","started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z","executor_kind":"agent","outcome":"pass","tokens_in":100,"tokens_out":20,"cost_usd":0.125}'`
3. 紧接着（不等待）用第 1 步同样的 URL 编码地址 `curl -s` GET。
期望:
- 第 1 步返回 404。
- 第 2 步返回 200 且 `inserted` 为 1。
- 第 3 步 HTTP 200，body 顶层含键 `run_id, workflow_id, trigger_kind, started_at, ended_at, outcome, header_source, tokens_in, tokens_out, cost_usd`；`run_id` 等于 `$RID`（含冒号原样）；`trigger_kind` = `external`；`header_source` = `spans`；`outcome` = `pass`；`started_at` 对应 `2026-10-10T10:00:00.000Z`、`ended_at` 对应 `2026-10-10T10:00:05.000Z`；`Number(cost_usd)` = 0.125；`Number(tokens_in)` = 100、`Number(tokens_out)` = 20；body 中没有 `spans` 键。

### Q-2
对应: I-1
前提: 沿用 Q-1 自建的 `$RID`（Q-1 在同一场景序列里先跑；单独跑本场景时先执行 Q-1 第 2 步写入）。
操作:
1. 不做 URL 编码直接 GET：`curl -s -H "x-internal-token: $TOKEN" "<目标>/api/brain/runs/$RID"`（路径里是裸冒号）。
2. 不带 token GET 一次编码地址；再带错 token（`x-internal-token: wrong`）GET 一次。
期望: 第 1 步 HTTP 200，`run_id` 等于 `$RID`，字段值与 Q-1 第 3 步一致；第 2 步两次都 HTTP 401，`error.code`=`UNAUTHORIZED`，body 不含 `run_id`/`cost_usd` 等记录字段。

### Q-3
对应: I-2
前提: 生成新 `RID2="coding-workflow:$(uuidgen | tr A-Z a-z)"`。
操作:
1. 用 Q-1 第 2 步同样的 header 一次 POST 两条 span（数组），**故意把晚的放前面**：第一条 `occurrence_key="qa/b"`、`started_at="2026-10-10T11:00:10.000Z"`、`ended_at="2026-10-10T11:00:20.000Z"`、`outcome="pass"`、`cost_usd=0.2`；第二条 `occurrence_key="qa/a"`、`started_at="2026-10-10T11:00:00.000Z"`、`ended_at="2026-10-10T11:00:05.000Z"`、`outcome="pass"`、`cost_usd=0.1`；`activity_id` 同前。
2. `curl -s "<目标>/api/brain/runs/<编码后的RID2>?include=spans"`
3. `curl -s "<目标>/api/brain/runs/<编码后的RID2>"`
4. `curl -s "<目标>/api/brain/runs/<编码后的RID2>?include=foo"`
期望:
- 第 2 步 200，`spans` 是长度 2 的数组，`spans[0].occurrence_key`=`qa/a`、`spans[1].occurrence_key`=`qa/b`（按 started_at 升序）；每条都有 `occurrence_key, activity_id, outcome, cost_usd, started_at, ended_at` 键；`activity_id` 为 `c0de0000-0000-4000-8000-000000000102`；同一 body 顶层 `Number(cost_usd)` = 0.3。
- 第 3、4 步 200，body 里**没有** `spans` 键。

### Q-4
对应: I-4
前提: 生成新 `RID3="coding-workflow:$(uuidgen | tr A-Z a-z)"`，先按 Q-1 第 2 步写一条 `occurrence_key="qa/1"`、`outcome="pass"`、`cost_usd=0.1` 的 span。
操作:
1. GET `<目标>/api/brain/runs/<编码后的RID3>`，记下 `outcome` 与 `cost_usd`。
2. 再 POST 一条 `occurrence_key="qa/2"`、`started_at="2026-10-10T12:00:00.000Z"`、`ended_at="2026-10-10T12:00:03.000Z"`、`outcome="fail"`、`cost_usd=0.05` 的 span，立即 GET。
3. 再 POST 一条 `occurrence_key="qa/3"`、`started_at="2026-10-10T12:10:00.000Z"`、`ended_at="2026-10-10T12:10:01.000Z"`、`outcome="pass"`、`cost_usd=0.01`、`"evidence":{"run_terminal":true}` 的终态 span，立即 GET。
4. 把第 2 步的同一条 span 原样重发一次（重复上报），立即 GET。
期望:
- 第 1 步 `outcome`=`pass`、`Number(cost_usd)`=0.1、`header_source`=`spans`。
- 第 2 步 `outcome`=`fail`、`Number(cost_usd)`=0.15（写入后立刻读到，非缓存旧值）。
- 第 3 步 `outcome`=`pass`、`header_source`=`owner`、`Number(cost_usd)`=0.16。
- 第 4 步 POST 返回 `inserted`=0，GET 的 `Number(cost_usd)` 仍为 0.16、`outcome` 仍为 `pass`（重复上报不重复计费）。

### Q-5
对应: I-3
前提: 生成一个从未写入过的 `NORID="coding-workflow:$(uuidgen | tr A-Z a-z)"`。
操作:
1. GET `<目标>/api/brain/runs/<编码后的NORID>`
2. GET `<目标>/api/brain/runs/<编码后的NORID>?include=spans`
3. GET `<目标>/api/brain/runs/x%27%20OR%20%271%27%3D%271`（SQL 注入式输入）
期望: 三次都是 HTTP 404（不是 500），响应为 JSON，`error` 字段为非空可读字符串（含 `not found`），没有 `spans` 键。

### Q-6
对应: I-3
前提: 无（全部为非法输入，不需要数据）。
操作:
1. `curl -s -w '\n%{http_code}' "<目标>/api/brain/runs/%20%20"`（空白 run_id）
2. `curl -s -w '\n%{http_code}' "<目标>/api/brain/runs/"` 与 `"<目标>/api/brain/runs"`（空 run_id）
3. 201 个字符：`curl -s -w '\n%{http_code}' "<目标>/api/brain/runs/$(printf 'a%.0s' $(seq 1 201))"`
4. 恰好 200 个字符：同上把 201 换成 200
5. 非法编码：`curl -s -w '\n%{http_code}' "<目标>/api/brain/runs/%E0%A4%A"`
期望:
- 第 1、2、3、5 步 HTTP 400，JSON 的 `error` 为非空可读字符串（分别说明 run_id 必填 / 超过 200 字符 / 编码非法），没有一个是 500。
- 第 4 步 HTTP 404（200 字符是合法长度，只是不存在）。

### Q-7
对应: I-5
前提: 两端都在本机起、环境变量逐项相同，只差代码版本：本分支 Brain 按约定的本机命令起在 5299；另开 main 的 worktree 用同一条启动命令（同一组 `DB_NAME/DB_HOST/DB_USER/DB_PASSWORD/DATABASE_URL`、`CECELIA_INTERNAL_TOKEN=qa-local-token`、`NODE_ENV=development`，日志写 `/tmp/qa-brain-5298.log`）起在 `PORT=5298`，同样过就绪门（`curl -s http://127.0.0.1:5298/` 含 `"status":"running"`）；任一端不过按约定贴日志、上报环境阻塞。不拿预览环境或生产当基线。生成新 `RID4="coding-workflow:$(uuidgen | tr A-Z a-z)"`，按 Q-1 第 2 步向 5299 写入一条 span（两端同库，都能看到）。
操作: 分别对 `http://127.0.0.1:5299`（本分支）与 `http://127.0.0.1:5298`（main）执行：
1. 不带 token：`GET /api/brain/runs/<编码后的RID4>/definition`、`GET /api/brain/runs/<编码后的RID4>/reconciliation`、`POST /api/brain/runs/<编码后的RID4>/definition`（body `{}`）。
2. 带 `x-internal-token: qa-local-token`：重复第 1 步三个请求。
期望:
- 本分支与 main 的 HTTP 状态码逐一相同，错误 body 的 `error.code` 相同：不带 token 三个都是 401（`UNAUTHORIZED`）；带 token 时 `GET .../definition` 为 404 且 `error.code`=`RUN_DEFINITION_UNKNOWN`（该 run 未绑定定义），`GET .../reconciliation` 为 200 且 body 含 `evidence_status` 字段，`POST .../definition`（空 body）两端返回相同的状态码与 `error.code`。
- 本分支 `GET /api/brain/runs/<编码后的RID4>` 带 token 为 200 且 `run_id`=`$RID4`（main 上同一请求拿不到含 `run_id` 的记录体，说明是新增接口）——新接口可用，原两段接口也未被新接口吞掉。

## 铁律对照

- INV-50954d28：S-1、S-3、Q-2 覆盖（新接口挂 `internalAuthOrLoopback`，与 spans 路由器同一套中间件；Q-2 验证不带 token/错 token 均 401、带 token 200）。
- INV-52f1801e：S-4 覆盖（本改动不新增任何依赖；开发/验证若需装依赖，只在仓库根执行 `npm ci --legacy-peer-deps --ignore-scripts`，不在 `packages/brain` 内跑 npm ci）。
- INV-909ce765：QA 约定、Q-7 覆盖（Q-1～Q-6 优先打本 PR 预览环境，先探测 token 配置；预览未配 token 或 Deploy Preview Environment check 失败时，不在本功能 PR 里追修，QA 按约定命令改用本机分支 Brain 并在报告注明；Q-7 两端都在本机、环境变量逐项相同）。
- INV-3efefc23：S-4 覆盖（feat 改 `brain/src`，开 PR 前一次带齐 `runs-read-smoke.sh` 及其登记）。
- INV-c906dd6c：S-4 覆盖（规格里的 vitest 验证命令在写进 PR 前先实跑并打印 `exit=$?` 确认退出码语义）。
- INV-f437b0fd：S-4 覆盖（smoke 的写入侧 POST /spans 与读取侧 GET /runs 用同一个 `BRAIN_URL` 变量，不各自默认）。
- INV-6d11717d：S-4 覆盖（smoke 遇断言失败或 Brain 不可达一律 `exit 1`，不静默跳过）。
- INV-e6513dff：S-1、S-2 覆盖（runs/spans 列名已按迁移 531 原文核对，响应用 `SELECT *` 原列名，不凭经验改名）。
- INV-d976752e：S-1、Q-6 覆盖（run_id 长度上限 200 在入口显式校验，超长直接 400，不查库）。
- INV-1100cb8f：S-4 覆盖（`vitest.config.js` 的 `POSTGRES_INTEGRATION_TESTS` 属共享 CI 判定文件，本规格显式授权只追加一行本测试路径，不改其它项）。
- INV-1676385f：不适用：本改动只读 runs/spans，不新建表、不新增写入方。
- INV-761f242b：不适用：没有「先查再改」的写路径，接口纯只读。
- INV-564802ee：S-1 覆盖（接口不读不回显任何凭据；QA 用的 `$TOKEN` 只放请求 header，不写进日志、smoke 输出与 PR 正文）。
- INV-68976b17：不适用：runs/spans 是系统执行记录，不含租户维度，不碰租户数据。
- INV-3c30394c：Q-1、Q-4 覆盖（I-4 在预览环境真库上用真实触发器验证，不以单测代替）。
- INV-a0bac43b：Q-1 覆盖（本任务是无 UI 的 local_api 形态，验证真相形态预先声明为：预览环境真 HTTP 请求 + 响应体字段断言）。
- INV-96054a8b：不适用：只新增 Brain 只读 HTTP 路由，不在 us-vps 上起任何执行负载；QA 打的是 PR 预览环境，不碰生产 Brain。

## 未覆盖真实链路

- 无第三方依赖；QA 能在预览环境真起 Brain、真写 spans、真读 runs，全链路可验。
- 预览环境若未配置 `CECELIA_INTERNAL_TOKEN`，POST /spans 与新 GET 都只放行 loopback，外部请求 503：按 QA 约定改本机分支 Brain 执行。
- 本次不验证生产库里已有的 `coding-workflow:<task_id>` 历史运行（QA 不得碰生产），只验证同形 run_id 的新造数据。
- 已知遮蔽：`server.js:429` 的 `contentPipelineRoutes` 先挂在 `/api/brain`，run_id 恰为 `stats`/`stages`/`output`/`publish-status` 时 `/api/brain/runs/<该值>` 被其 `/:id/<子路径>` 先接走；真实 run_id 形如 `coding-workflow:<uuid>`，不受影响，本次不处理。
- 存量问题，本次不修：① `GET /api/brain/spans` 仍开放无鉴权（不在本次 I-n 范围）；② `createRunDefinitionsRouter` 用 `router.use(internalAuthOrLoopback)` 拦截整个 `/api/brain/runs/*` 前缀，后续在其后挂载的路由都会被意外鉴权（本次新路由挂在其前规避）；③ 全局错误处理把 Express 自带 400（如非法 URL 编码）一律改成 500，影响所有带路径参数的接口，本次只在新路由器内局部兜住。

## 判定点

无：本接口只读库内已有记录，不推断任何外部真实状态。

## commander 裁决（第 2 轮裁判 06-judge-r2.md 之后）
- J-1（`/api/brain/runs/stats` 等被 `server.js:429` contentPipelineRoutes 先接走）：**维持本规格「未覆盖真实链路」的登记，不在本任务处理**。需求方确认：run_id 一律由系统生成且带前缀（`coding-workflow:<uuid>`、定时任务 `<job>:<时间>` 等），不会是裸的 `stats`/`stages`/`output`/`publish-status`；I-3 的「不返回 500」指本接口自己的入参与查库路径。contentPipelineRoutes 对非 uuid 的 500 是存量问题，另立任务。
- J-2（`a%00b` 返回 500 并回显 PostgreSQL 原始错误）：成立，规格补入「含控制字符 → 400」（见 S-1 入参校验），代码与集成测试同步修。

