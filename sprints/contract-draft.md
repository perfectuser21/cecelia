# Sprint Contract Draft (Round 1)

> PRD: `sprints/sprint-prd.md`（/api/brain/health 最小健康端点，harness v2 闭环验证）
> Task ID: bb245cb4-f6c4-44d1-9f93-cecefb0054b3
> Proposer Branch: `cp-harness-propose-r1-bb245cb4`

---

## Feature 1: `GET /api/brain/health` 契约形状

**行为描述**:
对 `/api/brain/health` 路径以 `GET` 方法发起请求，成功响应体是一个 JSON 对象，**恰好**包含 `status`、`uptime_seconds`、`version` 三个键，没有多余键也没有缺失键。HTTP 状态码为 `200`。

**硬阈值**:
- HTTP 状态码严格等于 `200`
- 响应 `Content-Type` 包含 `application/json`
- 响应 body 顶层键集合严格等于 `{status, uptime_seconds, version}`（多一个或少一个都视为违反）
- `status` 严格等于字符串 `"ok"`
- `uptime_seconds` 为 `typeof === 'number'` 且 ≥ 0
- `version` 为 `typeof === 'string'` 且长度 > 0

**BEHAVIOR 覆盖**（在 `tests/ws1/health-route.test.ts` 落成 it()）:
- `it('returns HTTP 200 with only status/uptime_seconds/version keys')`
- `it('returns status equal to literal string "ok"')`
- `it('returns uptime_seconds as a non-negative number')`
- `it('returns version as a non-empty string')`
- `it('responds with application/json content-type')`

**ARTIFACT 覆盖**（写进 `contract-dod-ws1.md`）:
- 新增路由源文件 `packages/brain/src/routes/health.js`
- 该文件 `export default` 一个 Express Router
- 该文件定义 `router.get('/', ...)` handler

---

## Feature 2: DB / Tick / 外部依赖零耦合

**行为描述**:
该端点的实现不得在请求处理链路上访问 PostgreSQL（`pool.query` 调用）、tick 状态（`getTickStatus`）、Docker runtime probe 或任何外部 HTTP 服务。即使 DB 不可用（`pool.query` reject），端点仍能在 500ms 内返回 200 + 三字段。

**硬阈值**:
- 请求处理期间，被注入的 `pg` pool mock 的 `query` 方法调用次数严格等于 0
- 请求处理期间，被注入的 `getTickStatus` mock 调用次数严格等于 0
- 即使 `pool.query` mock 永久拒绝，接口仍返回 200 且 body 三字段完整
- 单次请求的 wall-clock 延迟 < 500ms（不得因等待任何异步资源而阻塞）

**BEHAVIOR 覆盖**（在 `tests/ws1/health-route.test.ts` 落成 it()）:
- `it('does not invoke pg pool query during request handling')`
- `it('does not invoke getTickStatus during request handling')`
- `it('still returns 200 with full shape when pg pool rejects')`
- `it('completes within 500ms even under rejecting pg pool')`

**ARTIFACT 覆盖**（写进 `contract-dod-ws1.md`）:
- `packages/brain/src/routes/health.js` 源代码中不包含 `from '../db.js'`、`from '../tick.js'`、`pool.query`、`getTickStatus` 等字符串

---

## Feature 3: Server 挂载与端到端可达性

**行为描述**:
路由模块在 `packages/brain/server.js` 中以 `/api/brain/health` 前缀挂载，并且挂载位置位于 `app.use('/api/brain', brainRoutes)` 之前（否则 `goals.js` 里旧的 `/health` 会先截胡）。端到端打开真实 Express app，对 `/api/brain/health` 发起 `GET` 能拿到 200 + 三字段，对同一路径发起 `POST`/`PUT`/`DELETE` 必须返回 `404` 或 `405`，不得 `200` 也不得 `5xx`。

**硬阈值**:
- `server.js` 中存在 `import ... from './src/routes/health.js'` 行
- `server.js` 中存在 `app.use('/api/brain/health', ...)` 挂载行
- 该 `app.use('/api/brain/health', ...)` 行号严格小于 `app.use('/api/brain', brainRoutes)` 行号
- GET `/api/brain/health` → HTTP 200 + 三字段完整
- POST/PUT/DELETE `/api/brain/health` → HTTP ∈ {404, 405}（既不 200 也不 5xx）
- `version` 字段值严格等于 `packages/brain/package.json` 的 `version` 字段

**BEHAVIOR 覆盖**（在 `tests/ws2/health-integration.test.ts` 落成 it()）:
- `it('GET /api/brain/health returns 200 with status/uptime_seconds/version fields')`
- `it('version field equals packages/brain/package.json version field')`
- `it('POST /api/brain/health returns 404 or 405, never 200 or 5xx')`
- `it('PUT /api/brain/health returns 404 or 405, never 200 or 5xx')`
- `it('DELETE /api/brain/health returns 404 or 405, never 200 or 5xx')`

**ARTIFACT 覆盖**（写进 `contract-dod-ws2.md`）:
- `packages/brain/server.js` 含 `import` health 路由模块的语句
- `packages/brain/server.js` 含 `app.use('/api/brain/health', ...)` 挂载
- 挂载行出现在 `app.use('/api/brain', brainRoutes)` 之前

---

## Feature 4: `uptime_seconds` 随时间单调不降

**行为描述**:
连续两次对 `/api/brain/health` 的 `GET` 请求之间，只要真实挂钟时间向前推进（≥100ms），第二次响应体的 `uptime_seconds` 值必须**严格大于**第一次。

**硬阈值**:
- 两次请求间等待 ≥ 150ms 后，`uptime2 > uptime1`
- 差值 `uptime2 - uptime1` 必须 > 0（允许任何正浮点数）

**BEHAVIOR 覆盖**（在 `tests/ws2/health-integration.test.ts` 落成 it()）:
- `it('uptime_seconds strictly increases between two sequential requests with 150ms gap')`

**ARTIFACT 覆盖**: 无（纯行为特性）

---

## Workstreams

workstream_count: 2

### Workstream 1: Health Route Module（路由模块）

**范围**: 新增纯函数式只读路由模块 `packages/brain/src/routes/health.js`，实现 `GET /` handler，返回 `{status, uptime_seconds, version}` 三字段。不得 import `db.js` / `tick.js` / 任何外部服务客户端。`version` 读取自 `packages/brain/package.json`。

**大小**: S（< 50 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/health-route.test.ts`（Feature 1 + Feature 2 的行为断言）

**交付物**:
- `packages/brain/src/routes/health.js`
- `packages/brain/src/__tests__/routes/health.test.js`（brain 仓库内的正式单元测试，与合同 ws1 测试同构，用于 brain-ci.yml）

### Workstream 2: Server Mount + Integration Smoke（挂载与端到端）

**范围**: 在 `packages/brain/server.js` 的 `app.use('/api/brain', brainRoutes)` 之前注入 `app.use('/api/brain/health', healthRoutes)` 挂载，并新增集成 smoke 测试，通过 supertest 对完整 app 实例发起真实 HTTP 请求，验证响应三字段、错误方法返回 404/405、uptime 单调递增、version 与 package.json 一致。

**大小**: S（< 60 行新增）
**依赖**: Workstream 1 完成后

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws2/health-integration.test.ts`（Feature 3 + Feature 4 的行为断言）

**交付物**:
- `packages/brain/server.js` 挂载改动（新增 import + 新增 `app.use` 行）
- `packages/brain/src/__tests__/integration/health.integration.test.js`（brain 仓库内的正式集成测试）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据（已本地采集） |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/health-route.test.ts` | 契约形状（5 it）+ DB/tick 零耦合（4 it）= 9 个 it | `npx vitest run sprints/tests/ws1/` → **Test Files 1 failed**，suite 在模块解析阶段 fail（`Failed to load url ../../../packages/brain/src/routes/health.js`），9 个 it 全部无法进入执行，等价于 9 red |
| WS2 | `sprints/tests/ws2/health-integration.test.ts` | 挂载可达性（5 it）+ uptime 单调（1 it）= 6 个 it | `npx vitest run sprints/tests/ws2/` → **Test Files 1 failed**，suite 在模块解析阶段 fail（同上），6 个 it 全部无法进入执行，等价于 6 red |

**Red evidence 采集命令**:
```bash
npx vitest run sprints/tests/ws1/ --reporter=verbose
npx vitest run sprints/tests/ws2/ --reporter=verbose
```

**预期总 FAIL 数**: 9 + 6 = 15 个 it 全红

---

## 对 Reviewer 的说明

本轮 1 合同的关键设计：

1. **零耦合断言**：Feature 2 用"pool.query 调用次数 === 0"作硬阈值，直接杜绝 Generator 写"异常捕获后返回默认值"这种假实现。
2. **精确键集断言**：Feature 1 的"恰好三键"断言（用 `Object.keys(body).sort()` 比较），防止 Generator 额外注入 debug 字段混过测试。
3. **挂载顺序断言**：Feature 3 用行号比较，防止 Generator 把 `app.use` 加在 `brainRoutes` 之后导致新端点被旧 goals.js `/health` 遮蔽。
4. **单调性断言**：Feature 4 用真实 sleep 验证 `uptime_seconds` 不是 hardcode 的常量。
