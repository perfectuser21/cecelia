# Sprint Contract Draft (Round 3)

> Sprint: Harness v6 Reviewer alignment 真机闭环 — 最小时间端点
> PRD: `sprints/sprint-prd.md`
> Generator: `/harness-contract-proposer` (round 3)
> 上轮裁决: REVISION（R2 Reviewer 指出 4 处问题，其中风险 1/2 为 HIGH）

## R3 变更日志（对照 R2 Reviewer 反馈逐点处置）

| # | R2 Reviewer 指出 | 严重度 | R3 处置 |
|---|---|---|---|
| 1 | **SSOT 治理的落地未机械化**：R2 在正文讲了 `sprints/tests/` 合并时归档，但 `contract-dod-ws3.md` 只校验 `vitest.config.js` 不含 `sprints/`（反向断言），没有正向 ARTIFACT 证明 Generator 在合并 PR 里真把 Red 证据归档 / 不再进入测试集；合并后可能 19+19 双份执行或残留 | HIGH | `contract-dod-ws3.md` 新增两条正向 ARTIFACT：① `sprints/tests/ws{1,2,3}/` 目录在 Generator 合并 PR 中**已不存在于该路径**（被 `git mv` 到 `sprints/archive/<sprint-slug>/tests/ws{1,2,3}/`）；② 归档目录 `sprints/archive/<sprint-slug>/tests/` 存在且含原 19 条 it 的 `.test.js` 文件 |
| 2 | **server.js 集成测试可测试性**：WS3 的 `mount-integration.test.js` 用 `express()` 新建 app 挂 router，仅独立验证 Router 行为，**未真实 import `server.js` 验证生产挂载生效**；若 Generator 把 `app.use('/api/brain/time', …)` 写在永不执行的分支里，ARTIFACT 文本匹配仍会通过，但运行时 server.js 并未真正挂载 | HIGH | ① WS3 测试新增一条 `it` 直接 `import app from '../../../packages/brain/server.js'`，用 supertest 访问 `/api/brain/time/iso`、`/unix`、`/timezone?tz=UTC` 应 200 真挂载；② `contract-dod-ws3.md` 新增 ARTIFACT：server.js **必须**保有 `if (!process.env.VITEST)` 等价的 boot guard（确保测试 import 不启 HTTP listen / DB 连接副作用）|
| 3 | **Feature 1 时钟窗口阈值措辞与断言窗口不自洽**：硬阈值写"与请求'发起/收到'时间窗口偏差 ≤ 1 秒"，断言实现是 `[before-1000ms, after+1000ms]`；"前后 1000ms buffer" 描述更贴合 | LOW | Feature 1 硬阈值第 4 条措辞改为 **"`body.iso` 对应的墙钟时间必须落在 `[请求发起时刻 − 1s, 响应接收时刻 + 1s]` 区间内"**，与测试断言 `toBeGreaterThanOrEqual(before-1000) && toBeLessThanOrEqual(after+1000)` 一一对应 |
| 4 | **Feature 2 毫秒检测注释数学错误**：`body.unix < 1e11` 的注释"2286 年之前"不成立（2286 年对应 ~1e10；1e11 对应 5138 年）；会误导维护者误收紧到 `< 1e10` 破坏假想约束 | LOW | 采用 Reviewer 建议的方案 B — **阈值收紧到 `body.unix < 1e10`**，注释保持"2286 年之前的 Unix 秒都 < 1e10"。理由：① 注释数学自洽 ② 阈值更严，能更早捕捉"误返回毫秒"的 mutation ③ 对未来 ~260 年足够（年份 2286 远超 Brain 任何合理生命周期）|

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
- **`body.iso` 对应的墙钟时间必须落在 `[请求发起时刻 − 1s, 响应接收时刻 + 1s]` 区间内**（R3：措辞与断言窗口一一对应；1s buffer 吸收网络 / event loop 抖动，拒绝 5s 级漂移）

**BEHAVIOR 覆盖**（在 `tests/ws1/iso-unix.test.js` 落成 `it()`）:
- `it('GET /iso returns 200 with JSON containing an iso string field')`
- `it('GET /iso iso field is a round-trippable ISO-8601 timestamp with UTC Z suffix')`
- `it('GET /iso iso wall-clock lies within [requestStart-1s, responseEnd+1s]')`

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
- `Content-Type` 含 `application/json`
- body 含字段 `unix`，满足 `Number.isInteger(body.unix) === true`
- `body.unix > 0`
- `|body.unix − Math.floor(Date.now()/1000)| ≤ 5`（断言写 ±5 秒，包容 CI 小机抖动；墙钟绝对偏差预期 ≪ 1 秒）
- **`body.unix < 1e10`**（R3 收紧：2286 年之前的 Unix 秒都 < 1e10，毫秒早已 > 1e12；阈值与注释数学自洽，能更早捕捉"误返回毫秒"的 mutation）

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
- 缺失 `tz` query / 空串 / 非法 IANA 串 / URL 编码注入串 → 400 + `Content-Type` 含 `application/json` + `{ error: <非空字符串> }`
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

## Feature 4: 生产挂载 + CI 纳管 + Red 证据归档

**行为描述**:
`packages/brain/server.js` 必须真实地把 time Router 挂到 `/api/brain/time`（而非别的前缀），且把端点行为测试放到 Brain vitest 默认 include 匹配得到的路径下，保证 CI 在每次 PR 都真实跑一遍这些断言（PRD FR-006）。**集成测试必须直接 import server.js 的 default export**（不是另建 express 实例挂 router），保证文本 `app.use(...)` 与运行时挂载语义一致（风险 2）。**合并 PR 时 Generator 须把 `sprints/tests/ws{N}/` 目录归档到 `sprints/archive/<sprint-slug>/tests/ws{N}/`**，避免 Red 证据与 CI SSOT 双份执行（风险 1）。

**硬阈值**:
- `server.js` 含 `import <ident> from './src/routes/time.js'`
- `server.js` 含 `app.use('/api/brain/time', <ident>)`
- `server.js` 保有 `if (!process.env.VITEST)` 或等价 boot guard（防止测试 import 时真连 DB / 启 HTTP listen）— R3 新增（风险 2 前置条件）
- 生产挂载前缀下，`/api/brain/time/iso`、`/unix`、`/timezone?tz=UTC` 均 **200 + `Content-Type` 含 `application/json`**
- 生产挂载前缀下，`/timezone`（缺 tz）返回 **400 + `Content-Type` 含 `application/json`**
- 未知子路径 `/does-not-exist` 返回 404（无 catch-all 泄漏）
- POST 到端点被拒（404 或 405）
- **集成测试至少一条 `it` 必须以 `import app from '../../../packages/brain/server.js'` 的方式直接消费 server.js 默认导出**（R3 新增：防止 ARTIFACT 文本匹配通过但实际挂载不生效）
- **CI SSOT 落地**：Brain 默认测试目录（`packages/brain/src/__tests__/...`）下存在一个测试文件，内容同时引用三条 `/api/brain/time/*` 路径
- **Red 证据归档落地**：Generator 合并 PR 后 `sprints/tests/ws{1,2,3}/` 不再存在于该路径，而是 `git mv` 到 `sprints/archive/<sprint-slug>/tests/ws{1,2,3}/`（R3 新增：风险 1 正向 ARTIFACT）

**BEHAVIOR 覆盖**（在 `tests/ws3/mount-integration.test.js`）:
- `it('GET /api/brain/time/iso returns 200 with JSON iso field when mounted at production prefix')`
- `it('GET /api/brain/time/unix returns 200 with JSON integer unix field when mounted at production prefix')`
- `it('GET /api/brain/time/timezone?tz=UTC returns 200 with JSON echoed tz when mounted at production prefix')`
- `it('GET /api/brain/time/timezone (missing tz) returns 400 with JSON error when mounted at production prefix')`
- `it('router distinguishes real endpoints from unknown paths (iso=200, unknown=404)')`
- `it('POST /api/brain/time/iso is rejected (404 or 405) but GET /api/brain/time/iso succeeds')`
- `it('concurrent GETs to all three endpoints all succeed with JSON and expected status codes')`
- **`it('server.js default-exported app actually mounts time router at /api/brain/time (end-to-end wiring)')`**（R3 新增：风险 2 的端到端断言）

**ARTIFACT 覆盖**（写入 `contract-dod-ws3.md`）:
- `server.js` 含 time 路由的 import 语句
- `server.js` 含 `app.use('/api/brain/time', …)` 挂载
- `server.js` 含 `if (!process.env.VITEST)` 或等价 boot guard（R3 新增）
- `packages/brain/src/__tests__/routes/time*.test.js`（或等价位置）存在
- 该文件同时出现三条 `/api/brain/time/{iso,unix,timezone}` 引用
- `package.json` dependencies 对照 main 未新增
- `vitest.config.js` include 模式**不含** `sprints/` 子串（反向断言：GAN Red 证据不进 brain vitest）
- **`sprints/tests/ws1/`、`sprints/tests/ws2/`、`sprints/tests/ws3/` 目录在 Generator 合并 PR 中已不存在**（R3 新增：风险 1 正向归档）
- **`sprints/archive/<sprint-slug>/tests/ws{1,2,3}/` 目录存在且各含至少一个 `.test.js` 文件**（R3 新增：风险 1 归档落位）

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

### Workstream 3: `server.js` 挂载 + CI 测试纳管 + Red 证据归档

**范围**:
① 改 `server.js`：新增 `import timeRouter from './src/routes/time.js'` 与 `app.use('/api/brain/time', timeRouter)`；保持现有 `if (!process.env.VITEST)` boot guard 不变（已存在，Generator 不得移除）。
② 在 `packages/brain/src/__tests__/routes/time-routes.test.js`（Brain 默认 include 路径）落地 CI SSOT 测试，内容等价覆盖 WS1/WS2/WS3 的 19 条 it。
③ 至少一条 it 必须通过 `import app from '../../../server.js'` 直接消费默认导出的 app，做端到端 supertest 挂载验证（风险 2）。
④ 把 `sprints/tests/ws{1,2,3}/` 归档到 `sprints/archive/<sprint-slug>/tests/ws{1,2,3}/`（`git mv`），保证 Red 证据保留可审计、不进入 `npm run brain:test`（风险 1）。
**大小**: S（server.js +2 行 import + 1 行 app.use；新建 CI SSOT 测试文件；归档 3 个目录；描述性标签）
**依赖**: Workstream 1 + Workstream 2 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws3/mount-integration.test.js`（GAN Red 证据），**合并后** → `packages/brain/src/__tests__/routes/time-routes.test.js`（CI SSOT）

---

## Test Contract

| Workstream | Test File（GAN Red 证据） | BEHAVIOR 覆盖 (it 数量) | 预期红证据 | **合并后处置方式（SSOT 归属）** |
|---|---|---|---|---|
| WS1 | `sprints/tests/ws1/iso-unix.test.js` | `/iso` 3 条 + `/unix` 2 条 = **5** | `npx vitest run sprints/tests/ws1/` → Suite import 失败（无 `packages/brain/src/routes/time.js`），vitest 在该 suite 记 1 条 FAIL | 内容**合并**进 `packages/brain/src/__tests__/routes/time-routes.test.js`；`sprints/tests/ws1/` 在 Generator 合并 PR 中 `git mv` 到 `sprints/archive/<sprint-slug>/tests/ws1/` |
| WS2 | `sprints/tests/ws2/timezone.test.js` | happy 3 + error 4 = **7** | `npx vitest run sprints/tests/ws2/` → Suite import 失败（同 WS1），1 条 FAIL | 同 WS1：合并进 `time-routes.test.js`，`sprints/tests/ws2/` 归档 |
| WS3 | `sprints/tests/ws3/mount-integration.test.js` | 生产挂载 5 + 只读契约 2 + **server.js 端到端挂载 1** = **8** | `npx vitest run sprints/tests/ws3/` → Suite import 失败（同 WS1），1 条 FAIL；server.js 端到端 it 在 time.js 存在但挂载缺失时将以 404 而非 200 失败 | 同 WS1：合并进 `time-routes.test.js`，`sprints/tests/ws3/` 归档 |

**合计 20 条 `it`**（R3：WS3 +1 条 server.js 端到端挂载 it；R2 时为 19 条）。SSOT 落到 `packages/brain/src/__tests__/routes/time-routes.test.js`（被 `packages/brain/vitest.config.js` include 匹配、`npm run brain:test` 自动执行）。

**本地 Red evidence**（Proposer R3 实跑）:
- 当前仓库无 `packages/brain/src/routes/time.js`
- `npx vitest run sprints/tests/ws1/ sprints/tests/ws2/ sprints/tests/ws3/` → 所有 3 个 suite 的 import 解析阶段失败（`Failed to load .../time.js`），vitest 将 3 个 suite 全部报为 FAIL
- 额外地，WS3 的 "server.js 端到端挂载" it 即使 time.js 存在、`server.js` import 但未 `app.use` 挂载，也会以 `GET /api/brain/time/iso → 404` 而非 200 失败，独立抓 Generator 漏写挂载代码的 mutation

---

## SSOT 与一次性证据的治理（R3 强化）

Harness v6 测试分两级：

1. **一次性 GAN Red 证据**：`sprints/tests/ws{N}/*.test.js`
   - 由 Proposer 在对抗起点产出，Reviewer 可本地 / CI 复跑确认 Red
   - Generator **必须**在合并 PR 中 `git mv sprints/tests/ws{1,2,3}` 到 `sprints/archive/<sprint-slug>/tests/ws{1,2,3}/`
   - 归档后目录保留可审计（Harness 回放能找到 Red 证据），但**不**进入 `packages/brain/vitest.config.js` 的 include，避免双份执行
   - R3 正向 ARTIFACT 校验：合并后 `sprints/tests/ws{1,2,3}/` 不存在 且 `sprints/archive/<sprint-slug>/tests/ws{1,2,3}/` 存在（WS3 DoD 机械化）

2. **长期 CI SSOT**：`packages/brain/src/__tests__/routes/time-routes.test.js`（单一文件）
   - 20 条 `it` 的等价内容合并在此（含 server.js 端到端 it）
   - 被 Brain vitest 默认 include 匹配，PR CI 实跑
   - 至少一条 it 必须 `import app from '../../../server.js'` 做真实挂载验证（风险 2）

**Generator 在合并 PR 里需同时落地**：
- `packages/brain/src/routes/time.js`（实现）
- `packages/brain/server.js`（挂载，保留 boot guard）
- `packages/brain/src/__tests__/routes/time-routes.test.js`（CI SSOT 测试，≥ 20 条 it 等价覆盖，≥ 1 条消费 server.js 默认导出）
- `sprints/archive/<sprint-slug>/tests/ws{1,2,3}/`（GAN 证据归档，`git mv` 完成）

---

## 假设与约束

- Node 运行时内置 `Intl.DateTimeFormat` 足以识别所有 IANA 时区（Node 18+ 自带 full-icu）。PRD 已声明该假设。
- 端点属于 Brain 公开只读诊断接口，与 `/api/brain/context`、`/api/brain/status` 同可见性，无鉴权。
- 端点纯 CPU + 时钟读取，无 DB IO、无网络调用，无状态，天然并发安全。
- 本 Sprint 不在 dashboard 前端暴露入口，不做缓存/限流。
- `/iso` 的 ISO-8601 **必须**是 UTC `Z` 形式（`new Date().toISOString()`），不得使用 `+08:00` 或本地偏移形态。
- `server.js` 已存在 `if (!process.env.VITEST)` boot guard（见 server.js:402 附近），Generator 不得移除该 guard，且测试环境必须在 vitest 进程中自动设置 `VITEST=true`（vitest 本身已自动设置）。

---

## 范围边界（引自 PRD）

在范围：`packages/brain/src/routes/time.js` 新建、`packages/brain/server.js` 挂载、`brain-endpoint-contracts` 或等价集成测试扩展（落成 `src/__tests__/routes/time-routes.test.js`）、GAN Red 证据归档。
不在范围：新增 npm 依赖、migration、schema、tick 逻辑、dashboard、鉴权、缓存、历史/差值时间计算。
