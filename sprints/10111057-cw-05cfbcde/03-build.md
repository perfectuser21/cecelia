---
task_id: 05cfbcde-1108-4018-93d6-a48464324b11
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4"]
---
# Build 总结：GET /api/brain/runs/:run_id

### B-1
- 对应：S-1
- 改动文件：新建 `packages/brain/src/routes/runs-read.js`，导出 `createRunsReadRouter({ pool })` 并默认导出。路由器顶部挂 `internalAuthOrLoopback`；`GET /` 返回 400 `run_id is required`；`GET /:run_id` 先 trim，空串 400，超过 200 字符 400，然后执行参数化的 `SELECT * FROM runs WHERE run_id = $1`；查不到返回 404 `run not found: <id>`，查到返回 200 并把整行平铺在顶层，库异常返回 500。路由器末尾挂一个只处理 `URIError` 的错误中间件，回 400 `run_id is not valid URL encoding`，其它错误交还全局处理。
- 新增测试：`packages/brain/src/routes/__tests__/integration/runs-read.test.js`，覆盖：
  - 编码和裸冒号两种 run_id 都返回 200，字段齐全，且没有 spans 键；
  - 不存在、`include=spans`、SQL 注入式输入、恰好 200 字符都返回 404；
  - 空白、空路径、201 字符、非法编码都返回 400，body 精确匹配；
  - token 缺失或错误返回 401 且不泄露记录；带正确 token（x-internal-token 或 Bearer）返回 200。
- TDD 先红：`DB_HOST=/tmp DB_NAME=cecelia_scratch npx vitest run src/routes/__tests__/integration/runs-read.test.js`，结果 `Failed to load url ../../runs-read.js`，1 个文件失败。
- 转绿：同一命令跑出 `Tests 6 passed (6)`。
- 提交：abf06ac3a

### B-2
- 对应：S-2
- 改动文件：`packages/brain/src/routes/runs-read.js`。`include` 参数支持数组和逗号分隔，逐项 trim 后含 `spans` 时，在 `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` 事务里先查 runs 行，再按 `ORDER BY started_at ASC, created_at ASC, id ASC` 查 spans，然后 COMMIT；出错时 ROLLBACK，最后 release。不带 include 或 include 里没有 spans 时，响应里没有 spans 键。
- 新增测试：同上测试文件的「include=spans …」用例：
  - 乱序写入的两条 span 按 qa/a、qa/b 返回，字段齐全，顶层 cost_usd 为 0.3；
  - 不带 include 和 `include=foo` 时没有 spans 键；
  - `include=foo, spans` 和 `include=a&include=spans` 都附带 spans。
  - 「写入即可读」用例覆盖：最差结果 fail，546 终态 span 把结果定为 pass 并把 header_source 转为 owner，重复上报不重复计费（cost 保持 0.16）。
- 测试命令：同 B-4 的集成测试命令，6/6 通过。
- 提交：abf06ac3a

### B-3
- 对应：S-3
- 改动文件：`packages/brain/server.js`。新增 import `createRunsReadRouter`；`app.use('/api/brain/runs', createRunsReadRouter())` 挂在第 475 行，在 `createRunDefinitionsRouter()`（第 476 行）之前。没有改 run-definitions、run-reconciliation、spans 写入逻辑或迁移。
- 新增测试：集成测试按 server.js 的顺序挂三个路由器，断言 `/definition`、`/reconciliation` 和 `POST /definition` 不带 token 或带错 token 都返回 401 UNAUTHORIZED。另有一个用例用 releaseEvidenceDatabase 夹具验证带 token 时两段路径会穿过新路由：definition 返回 404 RUN_DEFINITION_UNKNOWN，reconciliation 返回 200 且 evidence_status=unknown。
- 验证命令：
  - `node -e "import('./src/routes/runs-read.js')…"`：退出码 0。
  - `grep -n` 显示新路由在第 475 行，run-definitions 在第 476 行。
  - 原有集成测试和新测试一起跑：`env -u CECELIA_INTERNAL_TOKEN DB_HOST=/tmp DB_NAME=cecelia_scratch npx vitest run --config vitest.integration.config.js src/routes/__tests__/integration/runs-read.test.js src/routes/__tests__/integration/run-definitions.test.js src/routes/__tests__/integration/run-reconciliation.test.js src/__tests__/integration/span-provenance.pg.integration.test.js`，结果 `exit=0`、`Test Files 4 passed (4)`、`Tests 22 passed (22)`。
  - 注意：本机 shell 自带 `CECELIA_INTERNAL_TOKEN`，不 unset 时原有三个测试会因 401 失败（16 个）。这是本机环境的问题，与本改动无关。新测试自己设置并恢复 token，两种情况下都通过。
- 真 Brain 实测：在 5299 端口起本分支 Brain（cecelia_scratch，`CECELIA_INTERNAL_TOKEN=qa-local-token`，启动时自动迁移）：
  - `%E0%A4%A` 返回 400 编码非法；`%20%20`、`/runs`、`/runs/` 返回 400 必填；不存在的 run 返回 404；
  - 带 token 时 `/definition` 返回 404 RUN_DEFINITION_UNKNOWN，`/reconciliation` 返回 200；
  - 不带 token 时 `/definition` 和 `/runs/<id>` 都返回 401 UNAUTHORIZED。
- 提交：b5a8a480e

### B-4
- 对应：S-4
- 改动文件：
  - 新建集成测试（同 B-1）：fixture 用 `privateFixtureDatabase` + `minimumDefinitionSchema`，加上 433 的 `ops_schedule_entries` 表，再真跑 514、531、546 迁移，触发器不 mock。只把 activity-judge 的异步钩子 mock 成空函数，避免对夹具里不存在的表发查询。
  - `packages/brain/vitest.config.js` 的 `POSTGRES_INTEGRATION_TESTS` 在 run-reconciliation 之后追加了一行。
  - 新建 `packages/brain/scripts/smoke/runs-read-smoke.sh`：
    - 缺少 `BRAIN_URL` 时报错退出；
    - 按仓库写入型 smoke 的惯例接 `smoke-production-guard`；
    - POST 与 GET 共用 `BRAIN_URL`，有 token 时带 `x-internal-token`；
    - curl 都带 `-q`；
    - 断言失败或 Brain 不可达时 `exit 1`。
  - smoke 登记进 `packages/quality/smoke-allowlist.txt` 和 `packages/quality/smoke-write-targets.txt`。
- 测试命令和输出：
  - `bash -n packages/brain/scripts/smoke/runs-read-smoke.sh`：语法通过。
  - 去掉守卫段的副本打真 Brain 5299（`BRAIN_URL=http://127.0.0.1:5299 CECELIA_INTERNAL_TOKEN=qa-local-token`），4 条 PASS，`exit=0`。
  - 反向验证：错 token 时输出 `FAIL: POST /spans 期望 200 实得 401`，exit=1；Brain 不可达（5999 端口）时输出 `FAIL: Brain 不可达`，exit=1。
  - 原脚本在没有 `SMOKE_ALLOW_WRITE=1` 时由守卫拦下：`[smoke] 写入未启用`，exit 0。这是仓库写入守卫的约定。
  - DevGate：`node scripts/facts-check.mjs` 输出 All facts consistent（退出码 0）；`bash scripts/check-version-sync.sh` 输出 All version files in sync；`node packages/quality/scripts/devgate/check-dod-mapping.cjs` 输出映射检查通过（302 项）。
  - 相对 main 共 7 个文件，新增 241 行。
- 提交：abf06ac3a（测试与 vitest 登记）、b5a8a480e（smoke 与登记）
