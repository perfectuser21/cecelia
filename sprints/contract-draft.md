# Sprint Contract Draft (Round 2)

> PRD: `sprints/sprint-prd.md`（/api/brain/health 最小健康端点，harness v2 闭环验证）
> Task ID: bb245cb4-f6c4-44d1-9f93-cecefb0054b3
> Proposer Branch: `cp-harness-propose-r2-bb245cb4`
> 上轮反馈: Round 1 Reviewer VERDICT=REVISION（见"Round 1 Reviewer 反馈处理"章节）

---

## Round 1 Reviewer 反馈处理

### R1-F1 — WS2 cascade 依赖（必须显式）

**问题**：WS2 的 supertest 在 `beforeAll` 里 `await import('../../../packages/brain/src/routes/health.js')`，WS1 若未先合并，该 import 会爆；更早版本甚至导致 suite 在模块解析阶段 fail（"suite 不进入执行"不计入 red 证据）。

**Mitigation（本轮已落）**：
1. Contract "Workstreams" 区块：WS2 显式声明 `depends_on: ["ws1"]`；大小写语义交给 Phase B Dispatcher 读取。
2. WS2 测试 `beforeAll` 用 `try/catch` 吞掉 import 错误，`router=null` 时 app 仍构造但不挂路由 — 每个 it 进入执行后在断言行 FAIL（见 R1-F4 断言级 Red）。
3. 对 Phase B 派发器的约束（合同声明，具体实现不在本合同范围）：派发 WS2 前必须确认 WS1 已合并主线，且 WS2 分支在 rebase 阶段必须 pull WS1 合入后的 main。

### R1-F2 — 挂载顺序被后续 PR 倒序覆盖

**问题**：若后续 PR 在 `app.use('/api/brain', brainRoutes)` 之后再次 `app.use('/api/brain/health', ...)`，旧 `goals.js` 的 `/health` 路径会先截胡。单靠行号断言不够——后续 PR 可能新增一行倒序挂载但源代码格式不变。

**Mitigation（本轮已落）**：
1. 既有行号断言（contract-dod-ws2.md ARTIFACT）保留：`health` 挂载行号严格小于 `brainRoutes` 挂载行号。
2. 新增 ARTIFACT：`packages/brain/server.js` 中 `app.use('/api/brain/health', ...)` 挂载**有且仅有一次**（grep -c 必须 == 1）——避免倒序叠加。
3. 新增 ARTIFACT：brain-ci 流水线含一条独立守卫（`scripts/check-health-mount-order.sh` 或等价 CI 步骤），在 CI 时对 `server.js` 执行挂载顺序校验，防止未来 PR 绕过本合同。

### R1-F3 — version 字段与 VERSION 文件漂移

**问题**：`packages/brain/package.json` 的 `version` 被改，但仓库根 `VERSION` 文件未同步；端点报的 version 虽然正确，但部署后与运维追踪到的仓库版本号不一致。

**Mitigation（本轮声明兜底，不在本 Initiative 范围）**：
- PRD 明确"版本号同步机制的任何改造（VERSION ↔ package.json）"不在范围内。
- 兜底机制依赖既有 DevGate `scripts/check-version-sync.sh`（CLAUDE.md §2 DevGate 要求）——该脚本已在 brain 改动前被强制运行，若 `package.json` 与 `VERSION` 漂移则直接挡住合并。
- 本合同不新增 version 同步检查，但在合同后续"假设"章节显式引用该 DevGate 作为前置保障。

### R1-F4 — 断言级 Red 证据强化

**问题**：Round 1 的 Red evidence 是"suite 在模块解析阶段 fail"（`Failed to load url ../../../packages/brain/src/routes/health.js`），9+6 个 it 全部无法进入执行。Reviewer 判定"suite 不进入执行"不计入 red 证据，必须 it 内断言 FAIL。同时警告 Generator 不得用空 stub 绕过模块解析错误。

**Mitigation（本轮已落）**：
1. WS1/WS2 测试文件的 `beforeAll` 用 `try/catch` 吞掉 import 错误，router 设为 null，app 正常构造但不挂路由 — 每个 it 进入执行，然后在断言行 FAIL（例：`AssertionError: expected 404 to be 200`）。
2. WS2 的 POST/PUT/DELETE 三个 it 原本在 router 不存在时返回 404 恰好满足 `404 or 405` 意外绿 — 本轮每个 it 开头新增 `probe GET` 断言（`expect(probe.status).toBe(200)`），路由不可达时这 3 个 it 也断言级 FAIL。
3. Test Contract 表格新增"断言级红证据"列，记录每个 it 的预期 AssertionError 消息（已本地执行 vitest 采集）。
4. 合同显式约束 Generator：**不得通过空 stub（返回 `{}` / 204 / hardcoded 常量 / `router.all(...)` 全方法接管）绕过测试**。Contract 硬阈值已多维锁定——`status==='ok'` + 恰好三键 + `version===package.json.version`（外部文件联动）+ `uptime` 两次严格递增（时间联动）+ POST→404/405 + probe GET==200——空 stub 至少触 1 条 FAIL。

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

## Feature 3: Server 挂载与端到端可达性（含挂载顺序守卫）

**行为描述**:
路由模块在 `packages/brain/server.js` 中以 `/api/brain/health` 前缀挂载，并且挂载位置位于 `app.use('/api/brain', brainRoutes)` 之前（否则 `goals.js` 里旧的 `/health` 会先截胡）。挂载语句有且仅出现一次（防止后续 PR 倒序叠加）。端到端打开真实 Express app，对 `/api/brain/health` 发起 `GET` 能拿到 200 + 三字段，对同一路径发起 `POST`/`PUT`/`DELETE` 必须返回 `404` 或 `405`，不得 `200` 也不得 `5xx`。

**硬阈值**:
- `server.js` 中存在 `import ... from './src/routes/health.js'` 行
- `server.js` 中存在 `app.use('/api/brain/health', ...)` 挂载行
- `server.js` 中 `app.use('/api/brain/health', ...)` 匹配数严格等于 `1`（grep -c == 1）
- `app.use('/api/brain/health', ...)` 行号严格小于 `app.use('/api/brain', brainRoutes)` 行号
- CI 存在独立守卫脚本 `scripts/check-health-mount-order.sh`（可执行 + exit 0 当顺序正确）
- GET `/api/brain/health` → HTTP 200 + 三字段完整
- POST/PUT/DELETE `/api/brain/health` → HTTP ∈ {404, 405}（既不 200 也不 5xx）且 **前置 probe GET 必须是 200**（保证不是因路由不可达而"意外绿"）
- `version` 字段值严格等于 `packages/brain/package.json` 的 `version` 字段

**BEHAVIOR 覆盖**（在 `tests/ws2/health-integration.test.ts` 落成 it()）:
- `it('GET /api/brain/health returns 200 with status/uptime_seconds/version fields')`
- `it('version field equals packages/brain/package.json version field')`
- `it('POST /api/brain/health returns 404 or 405, never 200 or 5xx')`（内含 probe GET==200 前置）
- `it('PUT /api/brain/health returns 404 or 405, never 200 or 5xx')`（内含 probe GET==200 前置）
- `it('DELETE /api/brain/health returns 404 or 405, never 200 or 5xx')`（内含 probe GET==200 前置）

**ARTIFACT 覆盖**（写进 `contract-dod-ws2.md`）:
- `packages/brain/server.js` 含 `import` health 路由模块的语句
- `packages/brain/server.js` 含 `app.use('/api/brain/health', ...)` 挂载（且只 1 次）
- 挂载行出现在 `app.use('/api/brain', brainRoutes)` 之前
- 新增 `scripts/check-health-mount-order.sh`，exit code 0 当且仅当上面三条全满足

---

## Feature 4: `uptime_seconds` 随时间单调不降

**行为描述**:
连续两次对 `/api/brain/health` 的 `GET` 请求之间，只要真实挂钟时间向前推进（≥150ms），第二次响应体的 `uptime_seconds` 值必须**严格大于**第一次。

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
**依赖**: 无（`depends_on: []`）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/health-route.test.ts`（Feature 1 + Feature 2 的行为断言）

**交付物**:
- `packages/brain/src/routes/health.js`
- `packages/brain/src/__tests__/routes/health.test.js`（brain 仓库内的正式单元测试，与合同 ws1 测试同构，用于 brain-ci.yml）

### Workstream 2: Server Mount + Integration Smoke（挂载与端到端 + CI 守卫）

**范围**: 在 `packages/brain/server.js` 的 `app.use('/api/brain', brainRoutes)` 之前注入 `app.use('/api/brain/health', healthRoutes)` 挂载（且只 1 次），并新增集成 smoke 测试 + CI 挂载顺序守卫脚本。通过 supertest 对完整 app 实例发起真实 HTTP 请求，验证响应三字段、错误方法返回 404/405、uptime 单调递增、version 与 package.json 一致。

**大小**: S（< 80 行新增）
**依赖**: Workstream 1（`depends_on: ["ws1"]`）——WS2 测试会 import WS1 交付的 `health.js`，Phase B 派发器必须确保 WS1 合并后再 rebase 派发 WS2

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws2/health-integration.test.ts`（Feature 3 + Feature 4 的行为断言）

**交付物**:
- `packages/brain/server.js` 挂载改动（新增 import + 新增 `app.use` 行）
- `packages/brain/src/__tests__/integration/health.integration.test.js`（brain 仓库内的正式集成测试）
- `scripts/check-health-mount-order.sh`（CI 挂载顺序守卫脚本）

---

## Test Contract

### 断言级 Red 证据（本轮本地已采集）

| Workstream | Test File | it 数 | FAIL 数 | 断言级红证据示例（AssertionError 消息）|
|---|---|---|---|---|
| WS1 | `sprints/tests/ws1/health-route.test.ts` | 9 | 9 | 9/9 it 均为 `AssertionError: expected 404 to be 200` — 断言行 `expect(res.status).toBe(200)` FAIL，体现在每个 it 的 `health-route.test.ts:44:24` / `:55:24` / `:66:24` / `:79:24` / `:86:24` / `:94:24` / `:101:24` / `:108:24` / `:118:24` 附近 |
| WS2 | `sprints/tests/ws2/health-integration.test.ts` | 6 | 6 | 6/6 it 均为 `AssertionError: expected 404 to be 200` — 断言行分别是 `expect(res.status).toBe(200)`（GET/version）/ `expect(probe.status).toBe(200)`（POST/PUT/DELETE 前置 probe）/ `expect(first.status).toBe(200)`（monotonicity），具体位置：`health-integration.test.ts:57:24` / `:68:24` / `:78:26` / `:87:26` / `:92:26` / `:104:26` |
| **合计** | — | **15** | **15** | 全部 FAIL 均发生在 `it()` 内部的 `expect(...).toBe(200)` 断言行，无 suite-level / module-resolution 级失败 |

### Red evidence 采集命令（Reviewer 可独立复现）

```bash
npx vitest run sprints/tests/ws1/ --reporter=verbose
# 预期输出: Test Files  1 failed (1)  |  Tests  9 failed (9)

npx vitest run sprints/tests/ws2/ --reporter=verbose
# 预期输出: Test Files  1 failed (1)  |  Tests  6 failed (6)
```

**预期总 FAIL 数**: 9 + 6 = **15 个 it 全红**，**全部为 it 内部断言级 FAIL**（`AssertionError: expected ...`），无一例 "suite 不进入执行"。

---

## 对 Generator 的硬约束（禁止作弊）

Generator 在 Green 阶段**禁止**使用以下手段绕过测试：

1. **空对象 stub**：`res.json({})` — 会让"恰好三键"和"status==='ok'" FAIL
2. **204 No Content**：走这条会让 `status===200` FAIL
3. **Hardcode version**：写死字符串 — 会让 `res.body.version === pkg.version` FAIL（因为 package.json 可能被 version-sync bump）
4. **Hardcode uptime**：返回常量 — 会让单调递增断言 FAIL
5. **`router.all(...)` 全方法接管**：让 POST/PUT/DELETE 也返回 200 — 会触 `expect(res.status).not.toBe(200)` FAIL
6. **在 server.js 倒序叠加 mount**：额外加一行在 `brainRoutes` 之后 — 会触 `mount matches == 1` 和行号比较 FAIL
7. **在 handler 里 try/catch 吞掉真 DB 调用**：mockPoolQuery 的 `toHaveBeenCalledTimes(0)` 直接 FAIL

合同硬阈值覆盖多维：键集 + 值 + 类型 + 跨文件一致性 + 时间单调 + 方法语义 + 挂载位置 + 调用计数，单一空 stub 策略无法全部满足。

---

## 对 Reviewer 的说明（本轮更新）

1. **零耦合断言**：Feature 2 用 `pool.query` / `getTickStatus` 调用次数 === 0 作硬阈值，直接杜绝 Generator 写"异常捕获后返回默认值"这种假实现。
2. **精确键集断言**：Feature 1 的"恰好三键"断言（`Object.keys(body).sort()` 比较），防止 Generator 额外注入 debug 字段混过测试。
3. **挂载顺序三重锁**（Round 2 新增第三重）：(a) 行号比较、(b) 挂载语句仅一次、(c) CI 守卫脚本独立校验。防止后续 PR 在 `brainRoutes` 之后倒序叠加。
4. **单调性断言**：Feature 4 用真实 sleep 验证 `uptime_seconds` 不是 hardcode 的常量。
5. **断言级 Red 强化**（Round 2 新增）：所有 15 个 it 均在本地已验证"进入执行 + 断言行 FAIL"，无一例模块解析失败绕过。
6. **依赖链显式**（Round 2 新增）：WS2 `depends_on: ["ws1"]`，Phase B 派发器必须保障 WS1 合并后再派发 WS2。
