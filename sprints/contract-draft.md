# Sprint Contract Draft (Round 2)

> Sprint: Harness v6 Reviewer alignment 真机闭环 — 最小时间端点
> PRD: `sprints/sprint-prd.md`
> Generator: `/harness-contract-proposer` (round 2)
> 上轮裁决: REVISION（R1 Reviewer 指出 5 处问题）

## R2 变更日志（对照 R1 Reviewer 反馈逐点处置）

| # | R1 Reviewer 指出 | R2 处置 |
|---|---|---|
| 1 | **Feature 1 的 1s / 5s 自相矛盾**：硬阈值写 "≤ 1 秒"，BEHAVIOR it 名却叫 "within 5 seconds of wall clock" | Feature 1 统一为 **1 秒**；改 it 名为 `within 1 second of wall clock`；断言窗口保持 `before-1000ms ~ after+1000ms`（1s buffer 吸收网络 / event loop 抖动）|
| 2 | **行数约束无法机械化验证**（`time.js < 100 行` / `server.js diff ≤ 5 行`，`wc -l` / `git diff \| grep -c` 在有换行规范化、二次修订、非首次 PR 等场景下不稳定） | 从 `contract-dod-ws1.md` / `contract-dod-ws3.md` **删除**对应 ARTIFACT 条目；合同 Workstream 区仅保留"大小 S/M/L"描述性标签，不再进入 DoD 机械化校验 |
| 3 | Feature 1 `new Date(body.iso).toISOString() === body.iso` 隐含要求 Generator 用 UTC `Z` 形式；+08:00 格式会 round-trip 失败 | Feature 1 硬阈值**明示** ISO-8601 UTC 形式（以 `Z` 结尾、含毫秒），即 `new Date().toISOString()` 语义，避免 Generator 选错实现 |
| 4 | Feature 2/3 硬阈值未要求 `Content-Type: application/json`（Feature 1 要了），一致性缺失 | Feature 2/3/4 所有 200 响应**补齐** `Content-Type` 含 `application/json` 硬阈值；测试用例同步加 content-type 断言 |
| 5 | **CI SSOT 归属**：`packages/brain/src/__tests__/routes/time-routes.test.js` 才是长期 CI SSOT；`sprints/tests/ws{N}/` 仅作一次性 GAN Red 证据，合并 PR 时应归档或 gitignore，不进 CI include | Test Contract 表新增"合并后处置"列；合同正文追加"SSOT 与一次性证据"段，明确 sprints/tests/ 在 Generator 合并 PR 时 `git mv` 到 `sprints/archive/<sprint>/tests/` 归档，不加入 `packages/brain/vitest.config.js` 的 include |

---

## Feature 1: `GET /api/brain/time/iso` — ISO-8601 当前时间（UTC Z）

**行为描述**:
客户端访问该端点，Brain 立即返回一个当前服务器时间的 ISO-8601 字符串（UTC `Z` 形式，含毫秒），不读数据库、不做鉴权、无副作用。

**硬阈值**:
- 响应码 = 200
- `Content-Type` 含 `application/json`
- body 含字段 `iso`，类型为非空字符串
- `iso` 形如 `YYYY-MM-DDTHH:mm:ss.sssZ`（**UTC `Z` 结尾、含毫秒**；即 `new Date().toISOString()` 的返回形态）
- `new Date(body.iso).toISOString() === body.iso`（round-trip 全等，确认不是 `+08:00` 偏移格式）
- `body.iso` 对应的墙钟时间与请求"发起 / 收到"时间窗口偏差 **≤ 1 秒**（断言写 `≥ before-1000ms && ≤ after+1000ms`，吸收网络 / event loop 抖动，但不允许 5s 这种宽松窗口）

**BEHAVIOR 覆盖**（在 `tests/ws1/iso-unix.test.js` 落成 `it()`）:
- `it('GET /iso returns 200 with JSON containing an iso string field')`
- `it('GET /iso iso field is a round-trippable ISO-8601 timestamp with UTC Z suffix')`
- `it('GET /iso returns a fresh timestamp within 1 second of wall clock')`

**ARTIFACT 覆盖**（写入 `contract-dod-ws1.md`）:
- `packages/brain/src/routes/time.js` 存在
- 该文件 `export default` 一个 Express Router
- 该文件注册 `router.get('/iso', ...)` 路由
- `packages/brain/package.json` 的 `dependencies` 未新增条目（对照 main 基线）

---

## Feature 2: `GET /api/brain/time/unix` — Unix 秒级时间戳

**行为描述**:
客户端访问该端点，Brain 立即返回一个当前服务器时间的 Unix 秒级整数时间戳，粒度为秒（非毫秒）。

**硬阈值**:
- 响应码 = 200
- `Content-Type` 含 `application/json`（**R2 补齐**，与 Feature 1 对齐）
- body 含字段 `unix`，满足 `Number.isInteger(body.unix) === true`
- `body.unix > 0`
- `|body.unix − Math.floor(Date.now()/1000)| ≤ 5`（断言写 ±5 秒，包容 CI 小机抖动；墙钟绝对偏差预期 ≪ 1 秒）
- `body.unix < 1e11`（证明不是毫秒：2286 年之前的 Unix 秒都 < 1e11，而毫秒早已 > 1e12）

**BEHAVIOR 覆盖**（在 `tests/ws1/iso-unix.test.js`）:
- `it('GET /unix returns 200 with JSON and an integer unix field')`
- `it('GET /unix unix is a second-granularity timestamp (not milliseconds)')`

**ARTIFACT 覆盖**（写入 `contract-dod-ws1.md`）:
- `time.js` 注册 `router.get('/unix', ...)`

---

## Feature 3: `GET /api/brain/time/timezone?tz=<IANA>` — IANA 时区当前时间

**行为描述**:
客户端给定合法 IANA 时区（如 `Asia/Shanghai`、`UTC`、`America/Los_Angeles`），Brain 返回该时区下的当前时间格式化字符串；对缺失参数、空字符串、非法 IANA 标识、URL 编码注入串，必须返回 HTTP 400 + `{ error: <非空字符串> }`，绝不允许 5xx。

**硬阈值**:
- 合法 tz → 200，`Content-Type` 含 `application/json`，body 含 `tz`（原样回显）与 `formatted`（非空字符串）
- 不同合法 tz（如 `Asia/Shanghai` vs `America/Los_Angeles`）的 `formatted` 必须**不同**（证明时区真的生效，不是挂名）
- 缺失 `tz` query / 空串 / 非法 IANA 串 / URL 编码注入串 → 400 + `Content-Type` 含 `application/json` + `{ error: <非空字符串> }`（**R2 补齐** error 路径的 content-type 硬阈值）
- 非法时区不得抛 500 — 必须被 try/catch 兜住 `Intl.DateTimeFormat` 的 `RangeError`

**BEHAVIOR 覆盖**（在 `tests/ws2/timezone.test.js`）:
- `it('GET /timezone?tz=Asia/Shanghai returns 200 with JSON, echoed tz and non-empty formatted')`
- `it('GET /timezone?tz=UTC returns 200 with JSON and echoed tz=UTC')`
- `it('GET /timezone?tz=America/Los_Angeles and ?tz=Asia/Shanghai yield distinct formatted values')`
- `it('GET /timezone?tz=Not/AReal_Zone returns 400 with JSON error and non-empty error string')`
- `it('GET /timezone without tz param returns 400 with JSON error and non-empty error string')`
- `it('GET /timezone?tz= (empty string) returns 400 with JSON error and non-empty error string')`
- `it('GET /timezone?tz=<sql-injection-like-garbage> returns 400 not 500 with JSON error')`

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
- 生产挂载前缀下，`/api/brain/time/iso`、`/unix`、`/timezone?tz=UTC` 均 **200 + `Content-Type` 含 `application/json`**（R2 补齐 content-type 一致性）
- 生产挂载前缀下，`/timezone`（缺 tz）返回 **400 + `Content-Type` 含 `application/json`**
- 未知子路径 `/does-not-exist` 返回 404（无 catch-all 泄漏）
- POST 到端点被拒（404 或 405 — Express 默认未注册方法就 404；若 Generator 显式写 `app.all` 则 405，两种都符合 "只接受 GET" 契约），同一 URL 的 GET 成功（证明挂载真实生效）
- **CI SSOT 落地**：Brain 默认测试目录（`packages/brain/src/__tests__/...`）下存在一个测试文件，内容同时引用三条 `/api/brain/time/*` 路径 — 保证 `npm run brain:test` 在 PR CI 实跑（这是长期 CI SSOT，非 sprints/tests/）

**BEHAVIOR 覆盖**（在 `tests/ws3/mount-integration.test.js`）:
- `it('GET /api/brain/time/iso returns 200 with JSON iso field when mounted at production prefix')`
- `it('GET /api/brain/time/unix returns 200 with JSON integer unix field when mounted at production prefix')`
- `it('GET /api/brain/time/timezone?tz=UTC returns 200 with JSON echoed tz when mounted at production prefix')`
- `it('GET /api/brain/time/timezone (missing tz) returns 400 with JSON error when mounted at production prefix')`
- `it('router distinguishes real endpoints from unknown paths (iso=200, unknown=404)')`
- `it('POST /api/brain/time/iso is rejected (404 or 405) but GET /api/brain/time/iso succeeds')`
- `it('concurrent GETs to all three endpoints all succeed with JSON and expected status codes')`

**ARTIFACT 覆盖**（写入 `contract-dod-ws3.md`）:
- `server.js` 含 time 路由的 import 语句（相对路径 `./src/routes/time.js`）
- `server.js` 含 `app.use('/api/brain/time', …)` 挂载
- `packages/brain/src/__tests__/routes/time*.test.js`（或等价 `src/__tests__/time*.test.js` / `src/__tests__/integration/time*.test.js`）存在
- 该文件同时出现三条 `/api/brain/time/{iso,unix,timezone}` 引用
- `package.json` dependencies 对照 main 未新增

---

## Workstreams

workstream_count: 3

### Workstream 1: `/iso` + `/unix` 端点路由模块

**范围**: 新建 `packages/brain/src/routes/time.js`，实现两个无参数的只读端点 `GET /iso` 和 `GET /unix`。两者只读系统时钟，不读 DB、不引入依赖。`/iso` 使用 `new Date().toISOString()` 生成 UTC `Z` 格式字符串；`/unix` 使用 `Math.floor(Date.now()/1000)`。
**大小**: S（预期 < 100 行，描述性标签，非 DoD 硬阈值）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/iso-unix.test.js`

### Workstream 2: `/timezone` 端点与错误分支

**范围**: 在 WS1 建立的 `time.js` 中增量新增 `GET /timezone`，用 Node 内置 `Intl.DateTimeFormat` 做格式化，用 try/catch 吃掉 `RangeError` 归为 400；缺参 / 空串 / 非法串全部走 400 + `{ error: string }` 分支，`Content-Type` 强制 `application/json`。
**大小**: S（预期 < 60 行，描述性标签，非 DoD 硬阈值）
**依赖**: Workstream 1 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws2/timezone.test.js`

### Workstream 3: `server.js` 挂载 + CI 测试纳管

**范围**: 改 `server.js` 引入并挂载 Router 到生产路径 `/api/brain/time`；把端点测试文件放到 Brain 默认测试目录（推荐 `packages/brain/src/__tests__/routes/time-routes.test.js`），使 CI 默认会跑。**该文件是长期 CI SSOT**；sprints/tests/wsN/ 只作 GAN Red 证据，合并时归档。
**大小**: S（server.js +2 行 import + 1 行 app.use；新建或扩展测试文件；描述性标签，非 DoD 硬阈值）
**依赖**: Workstream 1 + Workstream 2 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws3/mount-integration.test.js`（一次性 Red 证据），**合并后** → `packages/brain/src/__tests__/routes/time-routes.test.js`（CI SSOT）

---

## Test Contract

| Workstream | Test File（GAN Red 证据） | BEHAVIOR 覆盖 (it 数量) | 预期红证据 | **合并后处置方式（SSOT 归属）** |
|---|---|---|---|---|
| WS1 | `sprints/tests/ws1/iso-unix.test.js` | `/iso` 3 条 + `/unix` 2 条 = **5** | `npx vitest run sprints/tests/ws1/` → 5 failed（空 Router 桩时）/ Suite import 失败（无 `time.js` 时） | 内容**合并**进 `packages/brain/src/__tests__/routes/time-routes.test.js`；sprints/tests/ws1/ 在 Generator 合并 PR 中 `git mv` 到 `sprints/archive/<sprint>/tests/ws1/`（或加入 `.gitignore`），**不**加入 brain vitest include |
| WS2 | `sprints/tests/ws2/timezone.test.js` | happy 3 + error 4 = **7** | `npx vitest run sprints/tests/ws2/` → 7 failed（空 Router 桩时）/ Suite import 失败 | 同 WS1：合并进 `time-routes.test.js`，`sprints/tests/ws2/` 归档 |
| WS3 | `sprints/tests/ws3/mount-integration.test.js` | 生产挂载 5 + 只读契约 2 = **7** | `npx vitest run sprints/tests/ws3/` → 7 failed（空 Router 桩时）/ Suite import 失败 | 同 WS1：合并进 `time-routes.test.js`，`sprints/tests/ws3/` 归档 |

**合计 19 条 `it`**。SSOT 落到 `packages/brain/src/__tests__/routes/time-routes.test.js`（被 `packages/brain/vitest.config.js` include 匹配、`npm run brain:test` 自动执行）。

**本地 Red evidence**（Proposer R2 实跑）:
- 桩前：当前仓库无 `packages/brain/src/routes/time.js`，三个 suite 全部 import 失败 → vitest 报 `Failed to load ...time.js` 级别 Failure（每个 suite 1 条 FAIL，共 3 条 suite-level FAIL）
- 桩后（临时 `export default express.Router()` 空 Router）：`Tests 19 failed (19)` — 19 个 it 逐一 Red，与合同 19 条一一对齐
- 本 R2 commit 不保留桩，Red evidence 以第一种形式（suite import failure）提交——这也是 Reviewer 在 GAN 阶段会机械复现的状态

---

## SSOT 与一次性证据的治理（R2 新增段）

Harness v6 测试分两级：

1. **一次性 GAN Red 证据**：`sprints/tests/ws{N}/*.test.js`
   - 由 Proposer 在对抗起点产出，Reviewer 可本地 / CI 复跑确认 Red
   - Generator 合并 PR 时，这些文件**不**进入 `packages/brain/vitest.config.js` 的 include（即不被 `npm run brain:test` 扫到），避免 CI 里出现 19 + 19 的双份执行和路径含 sprints/ 的测试碎片
   - 处置选项（Generator 择一执行）：
     - **归档**：`git mv sprints/tests sprints/archive/<sprint-slug>/tests`
     - **gitignore**：保留本地但不入库（仅适合私有演练，本 Sprint 需归档以便审计 GAN 轨迹）
2. **长期 CI SSOT**：`packages/brain/src/__tests__/routes/time-routes.test.js`（单一文件）
   - 19 条 `it` 的等价内容合并在此
   - 被 Brain vitest 默认 include 匹配，PR CI 实跑
   - 合并 PR 后该文件变成保护本功能不被回归的唯一测试资产

**Generator 在合并 PR 里需同时落地**：
- `packages/brain/src/routes/time.js`（实现）
- `packages/brain/server.js`（挂载）
- `packages/brain/src/__tests__/routes/time-routes.test.js`（CI SSOT 测试，19 条 it 全量或等价覆盖）
- `sprints/archive/<sprint-slug>/tests/` （GAN 证据归档）

---

## 假设与约束

- Node 运行时内置 `Intl.DateTimeFormat` 足以识别所有 IANA 时区（Node 18+ 自带 full-icu）。PRD 已声明该假设，CI 环境若 ICU 不完整则 Generator 需在该 PR 单独处理（不在本 Sprint 范围）。
- 端点属于 Brain 公开只读诊断接口，与 `/api/brain/context`、`/api/brain/status` 同可见性，无鉴权。
- 端点纯 CPU + 时钟读取，无 DB IO、无网络调用，无状态，天然并发安全。
- 本 Sprint 不在 dashboard 前端暴露入口，不做缓存/限流。
- `/iso` 的 ISO-8601 **必须**是 UTC `Z` 形式（`new Date().toISOString()`），不得使用 `+08:00` 或本地偏移形态 — 否则 round-trip 断言会失败。这是 Feature 1 硬阈值的明示实现约束。

---

## 范围边界（引自 PRD）

在范围：`packages/brain/src/routes/time.js` 新建、`packages/brain/server.js` 挂载、`brain-endpoint-contracts` 或等价集成测试扩展（落成 `src/__tests__/routes/time-routes.test.js`）。
不在范围：新增 npm 依赖、migration、schema、tick 逻辑、dashboard、鉴权、缓存、历史/差值时间计算。
