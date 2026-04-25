# Sprint Contract Draft (Round 2)

载体：`GET /api/brain/health` 健康检查端点。本合同把 PRD 的 5 个验收场景 + 7 个功能需求拆成 4 个独立可测试 workstream，每个 workstream 对应 1 个 PR。

> **本轮修订（Round 2）回应 Reviewer 反馈**：
> - **R-1（派发顺序）**：在「派发约束」区块明确 strict serial WS1 → 然后并发 WS2/WS3/WS4，并把 WS2/WS3/WS4 的 `**依赖**:` 字段统一指向「WS1 PR 已 merged」。
> - **R-2（WS1/WS3 同文件冲突）**：WS1 强制使用 `'pending'` 字面量作为 `version` 占位，**禁止** `package.json` / `process.uptime` 越界；WS3 强制替换为 `process.uptime()` + 读 `package.json`，**禁止** 残留 `'pending'`。两者形成"占位—替换"的明确分工，WS3 PR diff 自然 ≥3 行。
> - **R-3（vitest 命名空间隔离）**：新增 `sprints/vitest.config.ts`，限定 `root=sprints` + `include=['tests/**/*.test.ts']` + 显式 exclude `__tests__/**` 与 `packages/**`，避免合同测试与项目内测试互相扫描。所有 Test Contract 命令显式带 `--config sprints/vitest.config.ts`。

---

## 派发约束（Phase B Dispatch Order）

- **strict serial**：Workstream 1 PR **必须先 merged 进 main**，然后才能派发 Workstream 2/3/4。
- **parallel after WS1**：Workstream 2、Workstream 3、Workstream 4 之间无文件交集（WS2 改 `server.js`、WS3 改 `routes/health.js`、WS4 新增项目内测试 + 改文档），可在 WS1 合并后并发派发。
- **harness dispatcher 责任**：检测到 Workstream 1 PR 状态非 `merged` 时，**必须**阻塞 Workstream 2/3/4 task 的 dispatch；这是合同隐含的可调度约束（task-plan.json 中以 `depends_on: ["ws1"]` 形式落地）。
- **回归检测**：若 WS2/WS3/WS4 在 WS1 PR 未 merged 时被错误派发，其 PR CI 会因 `import .../routes/health.js` 失败立即红，可作为派发顺序违反的告警信号。

---

## Feature 1: 健康路由模块独立可调用（占位实现）

**行为描述**:
存在一个独立的 Express 路由模块，可被装配到任意挂载点上，对该挂载点的根路径 `GET /` 返回 HTTP 200 + JSON 响应体，响应体含且仅评估三字段 `status`、`uptime_seconds`、`version`：`status` 为字符串 `"ok"`、`uptime_seconds` 为 number 类型且非负、`version` 为非空字符串（**WS1 阶段允许字面量 `'pending'`**，由 WS3 替换为真实版本）。该路由不依赖数据库、不依赖 Tick Loop、调用本身无副作用。

**硬阈值**:
- HTTP 状态码 === 200
- `typeof body.status === 'string'` 且 `body.status === 'ok'`
- `typeof body.uptime_seconds === 'number'` 且 `Number.isFinite(body.uptime_seconds)` 且 `body.uptime_seconds >= 0`
- `typeof body.version === 'string'` 且 `body.version.length > 0`（**不要求 ===package.json.version，留给 WS3**）
- 路由实现文件不含 `require('pg')` / `import.*from.*'../db'` 等数据库依赖

**BEHAVIOR 覆盖**（落在 tests/ws1/health-router.test.ts）:
- `it('GET / returns 200 when mounted on a bare app')`
- `it('responds with status="ok" string field')`
- `it('responds with uptime_seconds as a finite non-negative number')`
- `it('responds with version as a non-empty string')`
- `it('does not error when called twice in succession (no internal state mutation)')`

**ARTIFACT 覆盖**（落在 contract-dod-ws1.md）:
- `packages/brain/src/routes/health.js` 文件存在
- 该文件以 `import { Router } from 'express'` 风格导入 Express
- 该文件包含 `export default` 导出（与同目录其他路由模块一致）
- 该文件不引入数据库或调度器（无 `from '../db.js'`、无 `from '../tick`、无 `from '../scheduler`）
- **新增（占位边界）**：该文件含字面量 `'pending'` 字符串（占位 version 标记，由 WS3 替换）
- **新增（占位边界）**：该文件**不含** `package.json` 字符串引用（WS1 不越界读 package.json）
- **新增（占位边界）**：该文件**不含** `process.uptime` 调用（WS1 不越界引入运行时计时；WS1 的 uptime_seconds 可用任何非负 number 实现，例如 `0`、常数、Date.now()-start 都行）

> 设计说明：上述三条「占位边界」ARTIFACT 仅在 **WS1 PR 阶段**的 Evaluator 步骤生效；WS3 PR 合并后，`'pending'` 会被替换为读 `package.json`、`process.uptime` 会被引入——这是 WS3 演进的预期效果，不视为对 WS1 ARTIFACT 的回归违反。

---

## Feature 2: 端点挂载到 `/api/brain/health` 前缀

**行为描述**:
当一个 Express 应用以 `app.use('/api/brain/health', healthRouter)` 形式挂载 Workstream 1 的路由后，对该应用发起 `GET /api/brain/health` 请求返回 200 + `Content-Type: application/json`，响应体为合法 JSON 对象，含三字段（status / uptime_seconds / version）。即使 URL 携带查询参数（如 `?foo=bar`）也仍然返回 200 + 同样三字段，不报错、不返回 4xx/5xx。

**硬阈值**:
- `GET /api/brain/health` HTTP 状态码 === 200
- 响应头 `content-type` 匹配正则 `/application\/json/i`
- `JSON.parse(rawBody)` 不抛异常，且为普通对象（非 array、非 null）
- 响应对象同时拥有 `status`、`uptime_seconds`、`version` 三 key
- `GET /api/brain/health?ignored=value` 仍返回 200 且响应对象 `status === 'ok'`

**BEHAVIOR 覆盖**（落在 tests/ws2/api-brain-mount.test.ts）:
- `it('GET /api/brain/health returns 200 with application/json content-type')`
- `it('response body is a plain JSON object containing status, uptime_seconds, version')`
- `it('ignores query string parameters and still returns 200 with status=ok')`
- `it('GET /api/brain/health/extra-suffix does not collide with the contract')`（防止把 router 挂错到通配前缀）

**ARTIFACT 覆盖**（落在 contract-dod-ws2.md）:
- `packages/brain/server.js` 含 `import` 语句从 `./src/routes/health.js`（或同等相对路径）导入 health router
- `packages/brain/server.js` 含 `app.use('/api/brain/health'` 挂载语句（精确匹配该前缀字符串）

---

## Feature 3: 字段语义不变量（uptime 单调 + version 取自 package.json — 实质性替换占位）

**行为描述**:
两次相隔至少 1.1 秒的 `GET /api/brain/health` 调用中，第二次的 `uptime_seconds` 严格大于第一次。`version` 字段与 `packages/brain/package.json` 文件中 `version` 字段值字符串完全相等（不写死、不复制粘贴——必须通过文件 / require 获取）。在并发下（同时发起 5 次请求），所有响应的 `version` 一致、`uptime_seconds` 全部为 number、`status` 全部为 `"ok"`。

WS3 是对 WS1 占位实现的**实质性替换**：必须删除 `'pending'` 字面量、引入 `process.uptime()`、引入 `package.json` 读取——三者合计在 `routes/health.js` 上**至少新增 3 行有效代码**（已通过 ARTIFACT 间接保证：同时含 `process.uptime` + `package.json` token 且不含 `'pending'` 字面量这一组合无法靠 ≤2 行 diff 满足）。

**硬阈值**:
- 两次调用间隔 ≥ 1100 ms 后，`r2.uptime_seconds > r1.uptime_seconds`（严格大于，不允许相等）
- `body.version === JSON.parse(readFileSync('packages/brain/package.json')).version`
- 5 次并发调用：所有 version 全部相等、status 全部为 'ok'、uptime_seconds 全部为 number 类型
- WS3 合并后，`routes/health.js` **不再含** `'pending'` 字面量

**BEHAVIOR 覆盖**（落在 tests/ws3/invariants.test.ts）:
- `it('uptime_seconds strictly increases across calls separated by 1.1s')`
- `it('version field equals the version string in packages/brain/package.json')`
- `it('does not embed the version string as a hardcoded literal in routes/health.js')`
- `it('5 concurrent requests return consistent version and all status=ok')`
- `it('removed the WS1 placeholder literal pending from routes/health.js')`（新增 — 防止 WS3 实现者只加新代码不删占位）

**ARTIFACT 覆盖**（落在 contract-dod-ws3.md）:
- `packages/brain/src/routes/health.js` 含 `package.json` 字符串引用（require 或 readFileSync 都可）
- `packages/brain/src/routes/health.js` 含 `process.uptime` 调用
- `packages/brain/src/routes/health.js` 不含字面量 `'1.222.0'`（防硬编码当前版本）
- `packages/brain/src/routes/health.js` 不含任意字面量 semver（无形如 `'X.Y.Z'` 的字符串）
- **新增（实质性补丁）**：`packages/brain/src/routes/health.js` **不含** `'pending'` / `"pending"` 字面量字符串（强制 WS3 替换 WS1 占位）
- **新增（实质性补丁）**：`packages/brain/src/routes/health.js` 含 `readFileSync` 或 `require\([^\)]*package\.json` 模式之一（强制实质性引入 package.json 读取代码，而非靠注释含 token 蒙混）

---

## Feature 4: 端点契约文档可检索 + 项目内自动化测试常驻

**行为描述**:
项目文档中至少有一处可被纯文本检索到端点契约：路径 `/api/brain/health` + 三字段名（`status` / `uptime_seconds` / `version`）。同时 `packages/brain/src/__tests__/` 下存在覆盖该端点的 vitest 测试文件，至少断言三字段全部存在且类型正确——以让 PRD 的 SC-002（"至少 1 个自动化测试覆盖 FR-002~FR-005，且能在 CI 上稳定通过"）在主仓库 CI 中落地，而不仅仅是合同测试通过。

**硬阈值**:
- 至少存在一个 markdown 文件（`docs/current/README.md` 或 `packages/brain/README.md` 或 `packages/brain/docs/*.md`，**排除 `sprints/` 与 `DEFINITION.md`**）同时包含字符串 `/api/brain/health`、`status`、`uptime_seconds`、`version` 全部 4 个 token
- `packages/brain/src/__tests__/` 下至少存在一个文件名匹配 `*health*.test.{js,ts}` 且字面引用 `/api/brain/health` 的文件
- 该测试文件在 vitest 下挂到测试 app 调用 `/api/brain/health`，含至少 3 个 `it(` 断言
- 在 `packages/brain` 目录运行 `npm test -- --reporter=basic <该文件相对路径>` 退出码为 0
- 项目内测试与合同测试**互不串扰**：合同测试由 `sprints/vitest.config.ts` 限定 root；项目内测试由 `packages/brain/vitest.config.js` 限定 `include` 范围（已存在 — 不扫 sprints/）

**BEHAVIOR 覆盖**（落在 tests/ws4/docs-and-suite.test.ts）:
- `it('a documentation file lists /api/brain/health together with all three field names')`
- `it('packages/brain has a vitest file under __tests__ named *health*.test.{js,ts}')`
- `it('that test file declares at least 3 it() blocks targeting /api/brain/health')`
- `it('running the in-project health test file via npm test exits with code 0')`

**ARTIFACT 覆盖**（落在 contract-dod-ws4.md）:
- 上述 markdown 文件实际存在并 `grep -c '/api/brain/health'` ≥ 1
- 上述 vitest 文件实际存在
- 该 vitest 文件含 `import.*supertest` 或等价请求库引用

---

## Workstreams

workstream_count: 4

### Workstream 1: 健康路由模块（routes/health.js 占位实现）

**范围**: 新增 `packages/brain/src/routes/health.js`，导出 Express Router，对挂载点 `GET /` 返回 `{status:'ok', uptime_seconds, version:'pending'}` 三字段。**严格占位**：`version` 必须是字面量 `'pending'`；不读 `package.json`；不调用 `process.uptime`（`uptime_seconds` 可用 `0` 或简单 `Date.now()-startTimestamp` 实现）。不修改 `server.js`、不修改任何已有测试、不引入数据库或调度器依赖。
**大小**: S（预计 30-60 行）
**依赖**: 无
**派发**: Phase B 第一个；WS2/WS3/WS4 必须等 WS1 PR merged 后才派发

**BEHAVIOR 覆盖测试文件**: `tests/ws1/health-router.test.ts`

### Workstream 2: 挂载到 /api/brain/health 前缀

**范围**: 修改 `packages/brain/server.js`，import Workstream 1 的 health router 并通过 `app.use('/api/brain/health', healthRouter)` 挂载。仅修改 server.js 的 import 区与挂载区，不动任何已有路由、不动 startup 逻辑、不动 `routes/health.js`。
**大小**: S（预计 2-4 行）
**依赖**: Workstream 1 PR 已 merged 进 main（强串行；否则 `import` 失败）
**派发**: Phase B 第二批，与 WS3/WS4 并发

**BEHAVIOR 覆盖测试文件**: `tests/ws2/api-brain-mount.test.ts`

### Workstream 3: 字段语义不变量（uptime 单调 + version 取自 package.json — 替换 WS1 占位）

**范围**: 修改 `packages/brain/src/routes/health.js`：（a）删除 `'pending'` 字面量；（b）引入 `process.uptime()` 计算 `uptime_seconds`；（c）通过 `readFileSync('../../package.json')` 或 `require('../../package.json')` 读取 `version`。**预期 diff 行数下界**：在 `packages/brain/src/routes/health.js` 上至少新增 3 行有效代码（已通过 ARTIFACT 三重组合保证：含 `package.json` token + 含 `process.uptime` + 不含 `'pending'`）。不修改 `server.js`、不修改其他文件。
**大小**: S（预计 5-15 行修改）
**依赖**: Workstream 1 PR 已 merged 进 main（要修改的目标文件由 WS1 创建）
**派发**: Phase B 第二批，与 WS2/WS4 并发

**BEHAVIOR 覆盖测试文件**: `tests/ws3/invariants.test.ts`

### Workstream 4: 项目内 vitest 测试 + 文档路由表更新

**范围**: 在 `packages/brain/src/__tests__/` 下新增 `health-route.test.js`（项目自身 CI 套件，使用 supertest + 自组 mini app 调用 `/api/brain/health` 验证三字段）。在 `docs/current/README.md` 或 `packages/brain/docs/` 下追加端点说明，含路径与三字段名。新增的项目内测试**必须**走 `packages/brain/vitest.config.js` 既有 include 范围（即放在 `src/__tests__/` 下）；**不修改** `routes/health.js`、`server.js`、`sprints/`。
**大小**: S（预计 30-60 行测试 + 5-15 行文档）
**依赖**: Workstream 1 PR 已 merged 进 main（项目内测试通过自组 mini app 测试，仅 import `routes/health.js`，不依赖 ws2/ws3 PR）
**派发**: Phase B 第二批，与 WS2/WS3 并发

**BEHAVIOR 覆盖测试文件**: `tests/ws4/docs-and-suite.test.ts`

---

## Test Contract

合同测试统一通过 `sprints/vitest.config.ts` 跑（root=sprints，仅扫 `tests/**/*.test.ts`，显式 exclude `__tests__/**` 与 `packages/**` 防误扫）。

| Workstream | Test File | BEHAVIOR 覆盖 | 跑测命令（Repo Root） | 预期红证据 |
|---|---|---|---|---|
| WS1 | `sprints/tests/ws1/health-router.test.ts` | router mount on bare app / status=ok / uptime number / version string / no-mutation across calls | `npx vitest run --config sprints/vitest.config.ts tests/ws1/` | suite-level FAIL（import `routes/health.js` 失败 → 5 个 it() 全部无法执行 / 等价于 5 failures） — 本地实跑已确认 |
| WS2 | `sprints/tests/ws2/api-brain-mount.test.ts` | /api/brain/health 200+JSON / 三字段齐全 / 查询参数被忽略 / 子路径不污染合同 | `npx vitest run --config sprints/vitest.config.ts tests/ws2/` | suite-level FAIL（import `routes/health.js` 失败 → 4 个 it() 全部无法执行 / 等价于 4 failures） — 本地实跑已确认 |
| WS3 | `sprints/tests/ws3/invariants.test.ts` | uptime 严格递增 / version === package.json.version / 不写死字面量 / 并发一致性 / **删除 WS1 占位 'pending'** | `npx vitest run --config sprints/vitest.config.ts tests/ws3/` | suite-level FAIL（import `routes/health.js` 失败 → 5 个 it() 全部无法执行 / 等价于 5 failures） — 本地实跑已确认 |
| WS4 | `sprints/tests/ws4/docs-and-suite.test.ts` | docs 同时含 4 个 token / __tests__ 含 health 测试文件 / 该文件 ≥3 个 it / npm test 退出码 0 | `npx vitest run --config sprints/vitest.config.ts tests/ws4/` | 4 failures（docs/__tests__ 均未更新；本地实跑确认 4 failed / 4 total） |

> 命名空间隔离保证（应对 R-3）：
> - `sprints/vitest.config.ts` 的 `root=sprints` + `include=['tests/**/*.test.ts']` + `exclude=['**/__tests__/**', '**/packages/**', ...]` 确保合同测试 vitest **不会**扫到 `packages/brain/src/__tests__/health-route.test.js`。
> - `packages/brain/vitest.config.js` 既有 `include=['src/**/*.{test,spec}.?(c|m)[jt]s?(x)', '../../tests/packages/brain/**/...']` 不匹配 `sprints/tests/`，确保项目内 vitest **不会**扫到合同测试。
> - 互不串扰已由两边配置独立保证；DoD 验证命令显式 `--config` 是双重保险。
