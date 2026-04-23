# Sprint Contract Draft (Round 1)

> **被测对象**: Brain 新增只读时间查询端点 `/api/brain/time/{iso,unix,timezone}`
> **PRD 对齐**: sprints/sprint-prd.md — 为 Harness v6 闭环演练提供"足够小、无歧义、可端到端跑通"的样本业务功能
> **workstream_count**: 1（总改动 <100 行，单模块单测试文件）

---

## Feature 1: ISO 8601 时间端点

**行为描述**:
调用方通过 `GET /api/brain/time/iso` 拿到服务器当前时刻的 ISO 8601 UTC 字符串。响应体为 JSON，字段 `iso` 必须能被 `Date.parse` 解析为有限数值，且与服务器真实当前时刻相差不超过 10 秒。

**硬阈值**:
- HTTP 状态码 = 200
- `body.iso` 为 string 类型
- `Date.parse(body.iso)` 结果满足 `Number.isFinite(...) === true`
- `Math.abs(Date.parse(body.iso) - Date.now())` < 10000（毫秒）
- `body.iso` 以 `Z` 结尾（UTC 表达）

**BEHAVIOR 覆盖**（落在 `tests/ws1/time-routes.test.ts`）:
- `it('GET /iso returns HTTP 200')`
- `it('GET /iso body.iso is a non-empty string')`
- `it('GET /iso body.iso is parseable by Date.parse to a finite number')`
- `it('GET /iso body.iso is within 10 seconds of current server time')`
- `it('GET /iso body.iso ends with Z (UTC marker)')`

**ARTIFACT 覆盖**（落在 `contract-dod-ws1.md`）:
- `packages/brain/src/routes/time.js` 存在，`export default` 为 express Router 实例
- 该文件含有 `router.get('/iso', ...)` 注册

---

## Feature 2: Unix 时间戳端点

**行为描述**:
调用方通过 `GET /api/brain/time/unix` 拿到服务器当前时刻的整数秒级 Unix 时间戳。响应体字段 `unix` 必须为 JavaScript 整数（`Number.isInteger` 为真），且与 `Math.floor(Date.now()/1000)` 相差不超过 5 秒。

**硬阈值**:
- HTTP 状态码 = 200
- `typeof body.unix === 'number'`
- `Number.isInteger(body.unix) === true`
- `Math.abs(body.unix - Math.floor(Date.now()/1000)) <= 5`

**BEHAVIOR 覆盖**:
- `it('GET /unix returns HTTP 200')`
- `it('GET /unix body.unix is a number')`
- `it('GET /unix body.unix is an integer (Number.isInteger true)')`
- `it('GET /unix body.unix is within 5 seconds of current server Unix time')`

**ARTIFACT 覆盖**:
- `packages/brain/src/routes/time.js` 含有 `router.get('/unix', ...)` 注册

---

## Feature 3: 指定时区查询端点（合法输入）

**行为描述**:
调用方通过 `GET /api/brain/time/timezone?tz={IANA}` 拿到该时区下当前时刻的 ISO 8601 字符串，带正确的时区偏移量后缀（如 `+08:00`）。响应字段 `tz` 原样回显请求的时区字符串，`iso` 能被 `new Date()` 解析且与服务器当前时刻相差不超过 10 秒。

**硬阈值**（以 `Asia/Shanghai` 为例）:
- HTTP 状态码 = 200
- `body.tz === 'Asia/Shanghai'`
- `typeof body.iso === 'string'`
- `body.iso.endsWith('+08:00') === true`
- `Number.isFinite(Date.parse(body.iso)) === true`
- `Math.abs(Date.parse(body.iso) - Date.now())` < 10000
- 对 `America/New_York` 等其他合法 IANA 也需通过相同结构断言（抽样覆盖 DST 与非 DST 区）

**BEHAVIOR 覆盖**:
- `it('GET /timezone?tz=Asia/Shanghai returns HTTP 200')`
- `it('GET /timezone?tz=Asia/Shanghai body.tz equals Asia/Shanghai')`
- `it('GET /timezone?tz=Asia/Shanghai body.iso ends with +08:00')`
- `it('GET /timezone?tz=Asia/Shanghai body.iso is parseable and within 10 seconds of server time')`
- `it('GET /timezone?tz=America/New_York body.iso ends with -04:00 or -05:00 (DST-aware)')`

**ARTIFACT 覆盖**:
- `packages/brain/src/routes/time.js` 含有 `router.get('/timezone', ...)` 注册

---

## Feature 4: 指定时区端点的错误处理

**行为描述**:
调用方传入非法 IANA 时区字符串（如 `Mars/Olympus`）或不传 `tz` query 时，端点返回 HTTP 400，JSON body 含字段 `error`，Brain 进程不崩溃、不抛未处理异常，后续请求仍能正常响应。

**硬阈值**:
- 非法 `tz` → HTTP 400，`body.error` 为非空字符串
- 缺失 `tz` → HTTP 400，`body.error` 为非空字符串且含 "tz" 关键字（大小写不敏感）
- 非法 `tz` 请求返回后，立即再调用 `/api/brain/time/iso` 仍返回 200（验证未崩溃）

**BEHAVIOR 覆盖**:
- `it('GET /timezone?tz=Mars/Olympus returns HTTP 400')`
- `it('GET /timezone?tz=Mars/Olympus body.error is a non-empty string')`
- `it('GET /timezone with no tz query returns HTTP 400')`
- `it('GET /timezone with no tz body.error mentions tz (case-insensitive)')`
- `it('invalid tz request does not crash server — subsequent /iso still returns 200')`

**ARTIFACT 覆盖**:
- `packages/brain/src/routes/time.js` 的 `/timezone` handler 含 try/catch 或等价显式错误分支（代码文本匹配 `try` + `catch` 或 `400`）

---

## Feature 5: 路由挂载

**行为描述**:
`packages/brain/server.js` 导入 `./src/routes/time.js` 并在 `/api/brain/time` 前缀下挂载。这保证真实 Brain 进程启动后，上述端点通过 `localhost:5221/api/brain/time/*` 可达。

**硬阈值**:
- `server.js` 文件中出现 `from './src/routes/time.js'` 形式的 import 语句
- `server.js` 文件中出现 `app.use('/api/brain/time', ...)` 形式的挂载语句

**BEHAVIOR 覆盖**（通过集成测试间接验证）:
- 集成测试通过 supertest 挂载同一 router，验证路由注册正确；真实启动层由 ARTIFACT 保证

**ARTIFACT 覆盖**:
- `server.js` 含 `./src/routes/time.js` import
- `server.js` 含 `/api/brain/time` 挂载

---

## Workstreams

workstream_count: 1

### Workstream 1: 时间查询路由模块 + Server 挂载 + 集成测试

**范围**: 新增 `packages/brain/src/routes/time.js`（三端点实现）+ `packages/brain/server.js` 挂载（2 行改动）+ 集成测试 `packages/brain/src/__tests__/routes/time-routes.test.js`。端点实现零依赖 DB、零依赖外部服务，仅用 Node 原生 `Date` / `Intl.DateTimeFormat`。
**大小**: S（预估 <100 行总改动）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/time-routes.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖（it 数） | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/time-routes.test.ts` | 19 个 it（iso×5 / unix×4 / tz-happy×5 / tz-error×5） | `npx vitest run sprints/tests/ws1/` → 19 failures（模块 `packages/brain/src/routes/time.js` 不存在，beforeAll import 抛出，每个 it 被标记为 failed） |

**Proposer 本地 Red evidence**（round 1 实跑结果）:
- 命令: `./node_modules/.bin/vitest run sprints/tests/ws1/ --reporter=verbose`
- 结果: 19 failed / 0 passed（详见 commit log）
- 红原因: `Cannot find module '../../../packages/brain/src/routes/time.js'` — 实现尚未编写，符合 TDD Red 阶段预期
