# Sprint Contract Draft (Round 1)

载体：`GET /api/brain/health` 健康检查端点。本合同把 PRD 的 5 个验收场景 + 7 个功能需求拆成 4 个独立可测试 workstream，每个 workstream 对应 1 个 PR。

---

## Feature 1: 健康路由模块独立可调用

**行为描述**:
存在一个独立的 Express 路由模块，可被装配到任意挂载点上，对该挂载点的根路径 `GET /` 返回 HTTP 200 + JSON 响应体，响应体含且仅评估三字段 `status`、`uptime_seconds`、`version`：`status` 为字符串 `"ok"`、`uptime_seconds` 为 number 类型且非负、`version` 为非空字符串。该路由不依赖数据库、不依赖 Tick Loop、调用本身无副作用。

**硬阈值**:
- HTTP 状态码 === 200
- `typeof body.status === 'string'` 且 `body.status === 'ok'`
- `typeof body.uptime_seconds === 'number'` 且 `Number.isFinite(body.uptime_seconds)` 且 `body.uptime_seconds >= 0`
- `typeof body.version === 'string'` 且 `body.version.length > 0`
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

## Feature 3: 字段语义不变量（uptime 单调 + version 来自 package.json）

**行为描述**:
两次相隔至少 1.1 秒的 `GET /api/brain/health` 调用中，第二次的 `uptime_seconds` 严格大于第一次。`version` 字段与 `packages/brain/package.json` 文件中 `version` 字段值字符串完全相等（不写死、不复制粘贴——必须通过文件 / require 获取）。在并发下（同时发起 5 次请求），所有响应的 `version` 一致、`uptime_seconds` 全部为 number、`status` 全部为 `"ok"`。

**硬阈值**:
- 两次调用间隔 ≥ 1100 ms 后，`r2.uptime_seconds > r1.uptime_seconds`（严格大于，不允许相等）
- `body.version === JSON.parse(readFileSync('packages/brain/package.json')).version`
- 5 次并发调用：所有 version 全部相等、status 全部为 'ok'、uptime_seconds 全部为 number 类型

**BEHAVIOR 覆盖**（落在 tests/ws3/invariants.test.ts）:
- `it('uptime_seconds strictly increases across calls separated by 1.1s')`
- `it('version field equals the version string in packages/brain/package.json')`
- `it('does not embed the version string as a hardcoded literal in routes/health.js')`
- `it('5 concurrent requests return consistent version and all status=ok')`

**ARTIFACT 覆盖**（落在 contract-dod-ws3.md）:
- `packages/brain/src/routes/health.js` 含 `package.json` 字符串引用（require 或 readFileSync 都可）
- `packages/brain/src/routes/health.js` 不含字面量版本号（无 `'1.222.0'`、无 `"1.222.0"`、无 `version: '1.`）

---

## Feature 4: 端点契约文档可检索 + 项目内自动化测试常驻

**行为描述**:
项目文档中至少有一处可被纯文本检索到端点契约：路径 `/api/brain/health` + 三字段名（`status` / `uptime_seconds` / `version`）。同时 `packages/brain/src/__tests__/` 下存在覆盖该端点的 vitest 测试文件，至少断言三字段全部存在且类型正确——以让 PRD 的 SC-002（"至少 1 个自动化测试覆盖 FR-002~FR-005，且能在 CI 上稳定通过"）在主仓库 CI 中落地，而不仅仅是合同测试通过。

**硬阈值**:
- 至少存在一个 markdown 文件（`docs/current/README.md` 或 `packages/brain/README.md` 或 `packages/brain/docs/*.md`）同时包含字符串 `/api/brain/health`、`status`、`uptime_seconds`、`version` 全部 4 个 token
- `packages/brain/src/__tests__/` 下至少存在一个文件名匹配 `*health*.test.js`（或 `.test.ts`）
- 该测试文件在 vitest 下挂到测试 app 调用 `/api/brain/health`，含至少 3 个 `it(` 断言
- 在 `packages/brain` 目录运行 `npm test -- --reporter=basic <该文件相对路径>` 退出码为 0

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

### Workstream 1: 健康路由模块（routes/health.js 独立可调用）

**范围**: 新增 `packages/brain/src/routes/health.js`，导出 Express Router，对挂载点 `GET /` 返回 `{status:'ok', uptime_seconds, version}` 三字段。不修改 `server.js`、不修改任何已有测试、不引入数据库或调度器依赖。
**大小**: S（预计 30-60 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/health-router.test.ts`

### Workstream 2: 挂载到 /api/brain/health 前缀

**范围**: 修改 `packages/brain/server.js`，import Workstream 1 的 health router 并通过 `app.use('/api/brain/health', healthRouter)` 挂载。仅修改 server.js 的 import 区与挂载区，不动任何已有路由、不动 startup 逻辑。
**大小**: S（预计 2-4 行）
**依赖**: Workstream 1 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws2/api-brain-mount.test.ts`

### Workstream 3: 字段语义不变量（uptime 单调 + version 取自 package.json）

**范围**: 完善 `packages/brain/src/routes/health.js` 的实现细节——`uptime_seconds` 通过 `process.uptime()` 获取（保证单调），`version` 通过读 `../../package.json` 获取（不写死字面量）。本 workstream 可以独立 PR：在 ws1 已挂载默认实现的基础上把"读 package.json"和"严格 process.uptime"作为补丁式合规性增强。
**大小**: S（预计 5-15 行修改）
**依赖**: Workstream 1 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws3/invariants.test.ts`

### Workstream 4: 项目内 vitest 测试 + 文档路由表更新

**范围**: 在 `packages/brain/src/__tests__/` 下新增 `health-route.test.js`（项目自身 CI 套件，使用 supertest + 自组 mini app 调用 `/api/brain/health` 验证三字段）。在 `docs/current/README.md` 或 `packages/brain/docs/` 下追加端点说明，含路径与三字段名。
**大小**: S（预计 30-60 行测试 + 5-15 行文档）
**依赖**: Workstream 1 完成后（不依赖 ws2/ws3 的 PR 合并——通过自组 mini app 即可独立测试）

**BEHAVIOR 覆盖测试文件**: `tests/ws4/docs-and-suite.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/health-router.test.ts` | router mount on bare app / status=ok / uptime number / version string / no-mutation across calls | `npx vitest run sprints/tests/ws1/` → 5 failures（health.js 不存在） |
| WS2 | `tests/ws2/api-brain-mount.test.ts` | /api/brain/health 200+JSON / 三字段齐全 / 查询参数被忽略 / 子路径不污染合同 | `npx vitest run sprints/tests/ws2/` → 4 failures（health.js 不存在导致 import 失败） |
| WS3 | `tests/ws3/invariants.test.ts` | uptime 严格递增 / version === package.json.version / 不写死字面量 / 并发一致性 | `npx vitest run sprints/tests/ws3/` → 4 failures（health.js 不存在 + 字面量检查无对象） |
| WS4 | `tests/ws4/docs-and-suite.test.ts` | docs 同时含 4 个 token / __tests__ 含 health 测试文件 / 该文件 ≥3 个 it / npm test 退出码 0 | `npx vitest run sprints/tests/ws4/` → 4 failures（docs/__tests__ 均未更新） |
