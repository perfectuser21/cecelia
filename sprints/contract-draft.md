# Sprint Contract Draft (Round 1)

> Sprint: Harness v6 Reviewer alignment 真机闭环 — 最小时间端点
> PRD: `sprints/sprint-prd.md`
> Generator: `/harness-contract-proposer` (round 1)

## Feature 1: `GET /api/brain/time/iso` — ISO-8601 当前时间

**行为描述**:
客户端访问该端点，Brain 立即返回一个当前服务器时间的 ISO-8601 字符串，不读数据库、不做鉴权、无副作用。

**硬阈值**:
- 响应码 = 200
- `Content-Type` 含 `application/json`
- body 含字段 `iso`，类型为非空字符串
- `new Date(body.iso).toISOString() === body.iso`（可回解析的标准 ISO-8601）
- `body.iso` 对应的墙钟时间与请求发起时间偏差 ≤ 1 秒

**BEHAVIOR 覆盖**（在 `tests/ws1/iso-unix.test.js` 落成 `it()`）:
- `it('GET /iso returns 200 with JSON containing an iso string field')`
- `it('GET /iso iso field is a round-trippable ISO-8601 timestamp')`
- `it('GET /iso returns a fresh timestamp within 5 seconds of wall clock')`

**ARTIFACT 覆盖**（写入 `contract-dod-ws1.md`）:
- `packages/brain/src/routes/time.js` 存在
- 该文件 `export default` 一个 Express Router
- 该文件注册 `router.get('/iso', ...)` 路由
- `packages/brain/package.json` 的 `dependencies` 未新增条目

---

## Feature 2: `GET /api/brain/time/unix` — Unix 秒级时间戳

**行为描述**:
客户端访问该端点，Brain 立即返回一个当前服务器时间的 Unix 秒级整数时间戳，粒度为秒（非毫秒）。

**硬阈值**:
- 响应码 = 200
- body 含字段 `unix`，类型 `Number.isInteger(body.unix) === true`
- `body.unix > 0`
- `|body.unix − Math.floor(Date.now()/1000)| ≤ 5`
- `body.unix < 1e11`（证明不是毫秒）

**BEHAVIOR 覆盖**（在 `tests/ws1/iso-unix.test.js`）:
- `it('GET /unix returns 200 with an integer unix field')`
- `it('GET /unix unix is a second-granularity timestamp (not milliseconds)')`

**ARTIFACT 覆盖**（写入 `contract-dod-ws1.md`）:
- `time.js` 注册 `router.get('/unix', ...)`
- 文件新增行数 < 100（保证 S 级小改动）

---

## Feature 3: `GET /api/brain/time/timezone?tz=<IANA>` — IANA 时区当前时间

**行为描述**:
客户端给定合法 IANA 时区（如 `Asia/Shanghai`、`UTC`、`America/Los_Angeles`），Brain 返回该时区下的当前时间格式化字符串；对缺失参数、空字符串、非法 IANA 标识，必须返回 HTTP 400 + `{ error: <非空字符串> }`，绝不允许 5xx。

**硬阈值**:
- 合法 tz → 200，body 含 `tz`（原样回显）与 `formatted`（非空字符串）
- 不同合法 tz（如 `Asia/Shanghai` vs `America/Los_Angeles`）的 `formatted` 必须不同（证明时区真的生效，不是挂名）
- 缺失 `tz` query / 空串 / 非法 IANA 串 / URL 编码注入串 → 400 + `{ error: <非空字符串> }`
- 非法时区不得抛 500 — 必须被 try/catch 兜住

**BEHAVIOR 覆盖**（在 `tests/ws2/timezone.test.js`）:
- `it('GET /timezone?tz=Asia/Shanghai returns 200 with echoed tz and non-empty formatted')`
- `it('GET /timezone?tz=UTC returns 200 with echoed tz=UTC')`
- `it('GET /timezone?tz=America/Los_Angeles and ?tz=Asia/Shanghai yield distinct formatted values')`
- `it('GET /timezone?tz=Not/AReal_Zone returns 400 with non-empty error string')`
- `it('GET /timezone without tz param returns 400 with non-empty error string')`
- `it('GET /timezone?tz= (empty string) returns 400 with non-empty error string')`
- `it('GET /timezone?tz=<sql-injection-like-garbage> returns 400 not 500')`

**ARTIFACT 覆盖**（写入 `contract-dod-ws2.md`）:
- `time.js` 注册 `router.get('/timezone', ...)`
- 文件使用 `Intl.DateTimeFormat`
- 文件包含 `try { ... Intl.DateTimeFormat ... } catch` 兜底
- 文件含 `.status(400)` 与 `error:` 返回体

---

## Feature 4: 生产挂载 + CI 纳管

**行为描述**:
`packages/brain/server.js` 必须真实地把 time Router 挂到 `/api/brain/time`（而非别的前缀），且把端点行为测试放到 Brain vitest 默认 include 匹配得到的路径下，保证 CI 在每次 PR 都真实跑一遍这些断言（PRD FR-006）。

**硬阈值**:
- `server.js` 含 `import <ident> from './src/routes/time.js'`
- `server.js` 含 `app.use('/api/brain/time', <ident>)`
- 生产挂载前缀下，`/api/brain/time/iso`、`/unix`、`/timezone?tz=UTC` 均 200；未知子路径 `/does-not-exist` 返回 404（无 catch-all 泄漏）
- POST 到端点被拒（404 或 405），同一 URL 的 GET 成功（证明挂载真实生效）
- Brain 默认测试目录（`packages/brain/src/__tests__/...`）下存在一个测试文件，内容同时引用三条 `/api/brain/time/*` 路径 — 保证 `npm run brain:test` 实跑
- `server.js` diff 对 main 的新增行数 ≤ 5（最小侵入）

**BEHAVIOR 覆盖**（在 `tests/ws3/mount-integration.test.js`）:
- `it('GET /api/brain/time/iso returns 200 with iso field when mounted at production prefix')`
- `it('GET /api/brain/time/unix returns 200 with integer unix field when mounted at production prefix')`
- `it('GET /api/brain/time/timezone?tz=UTC returns 200 with echoed tz when mounted at production prefix')`
- `it('GET /api/brain/time/timezone (missing tz) returns 400 when mounted at production prefix')`
- `it('router distinguishes real endpoints from unknown paths (iso=200, unknown=404)')`
- `it('POST /api/brain/time/iso is rejected but GET /api/brain/time/iso succeeds')`
- `it('concurrent GETs to all three endpoints all succeed with expected status codes')`

**ARTIFACT 覆盖**（写入 `contract-dod-ws3.md`）:
- `server.js` 含 time 路由的 import 语句
- `server.js` 含 `app.use('/api/brain/time', …)` 挂载
- `packages/brain/src/__tests__/routes/time*.test.js`（或等价 `src/__tests__/time*.test.js` / `src/__tests__/integration/time*.test.js`）存在
- 该文件同时出现三条 `/api/brain/time/{iso,unix,timezone}` 引用
- `package.json` dependencies 对照 main 未新增
- `server.js` diff 对 main 新增行数 ≤ 5

---

## Workstreams

workstream_count: 3

### Workstream 1: `/iso` + `/unix` 端点路由模块

**范围**: 新建 `packages/brain/src/routes/time.js`，实现两个无参数的只读端点 `GET /iso` 和 `GET /unix`。两者都只读系统时钟，不读 DB、不引入依赖。
**大小**: S（< 100 行新增，纯计算）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/iso-unix.test.js`

### Workstream 2: `/timezone` 端点与错误分支

**范围**: 在 WS1 建立的 `time.js` 中增量新增 `GET /timezone`，用 Node 内置 `Intl.DateTimeFormat` 做格式化，用 try/catch 吃掉 `RangeError` 归为 400。
**大小**: S（< 60 行新增）
**依赖**: Workstream 1 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws2/timezone.test.js`

### Workstream 3: `server.js` 挂载 + CI 测试纳管

**范围**: 改 `server.js` 引入并挂载 Router 到生产路径 `/api/brain/time`；把端点测试文件放到 Brain 默认测试目录（`packages/brain/src/__tests__/routes/time-routes.test.js` 或等价位置），使 CI 默认会跑。
**大小**: S（server.js +2 行 import + 1 行 app.use；新建/扩展测试文件）
**依赖**: Workstream 1 + Workstream 2 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws3/mount-integration.test.js`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 (it 数量) | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/iso-unix.test.js` | `/iso` 3 条 + `/unix` 2 条 = **5** | `npx vitest run sprints/tests/ws1/` → 5 failures（空 Router 桩时）/ Suite import 失败（无文件时） |
| WS2 | `tests/ws2/timezone.test.js` | happy 3 + error 4 = **7** | `npx vitest run sprints/tests/ws2/` → 7 failures（空 Router 桩时）/ Suite import 失败 |
| WS3 | `tests/ws3/mount-integration.test.js` | 生产挂载 5 + 只读契约 2 = **7** | `npx vitest run sprints/tests/ws3/` → 7 failures（空 Router 桩时）/ Suite import 失败 |

**本地 Red evidence**（Proposer 实跑）:
- 无 `routes/time.js`：3 个 test file 全部 Failed Suite（import 失败）
- 临时桩文件（`export default express.Router()`，空 Router）：`Tests 19 failed (19)` — 与合同要求的 19 个 it 逐一对齐，验证每条 BEHAVIOR 都真会 Red
- 已删除桩，进入 GAN 审查阶段；Generator 真实实现后应见 19 个 Green

**CI 落地测试入口**（Generator 在 commit 1 或 commit 2 需要落地）: 把上述 3 个 `sprints/tests/ws{N}/*.test.js` 等价内容复制/合并到 `packages/brain/src/__tests__/routes/time-routes.test.js`（或 `packages/brain/src/__tests__/integration/` 下同名文件），以便 `npm run brain:test` 自动覆盖。sprints/ 下的测试是 GAN 对抗 Red 证据，不进入 CI 默认 include。

---

## 假设与约束

- Node 运行时内置 `Intl.DateTimeFormat` 足以识别所有 IANA 时区（Node 18+ 自带 full-icu）。PRD 已声明该假设，CI 环境若 ICU 不完整则 Generator 需在该 PR 单独处理（不在本 Sprint 范围）。
- 端点属于 Brain 公开只读诊断接口，与 `/api/brain/context`、`/api/brain/status` 同可见性，无鉴权。
- 端点纯 CPU + 时钟读取，无 DB IO、无网络调用，无状态，天然并发安全。
- 本 Sprint 不在 dashboard 前端暴露入口，不做缓存/限流。

---

## 范围边界（引自 PRD）

在范围：`packages/brain/src/routes/time.js` 新建、`packages/brain/server.js` 挂载、`brain-endpoint-contracts` 或等价集成测试扩展。
不在范围：新增 npm 依赖、migration、schema、tick 逻辑、dashboard、鉴权、缓存、历史/差值时间计算。
