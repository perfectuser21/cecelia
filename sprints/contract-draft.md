# Sprint Contract Draft (Round 1)

> **PRD 来源**：`sprints/sprint-prd.md`（Initiative：Brain 时间端点 — 单一 `GET /api/brain/time` 返回 iso/timezone/unix 三字段）
>
> **重要说明**：Round 1 远端之前推过 3 端点设计（`/time/iso`、`/time/timezone`、`/time/unix`），与当前 PRD（FR-001 "新增路由 `GET /api/brain/time`"、FR-002 "响应体只含 iso/timezone/unix 三字段"）不一致。本轮按当前 PRD 重新设计合同，收敛为**单 workstream**。
>
> **设计原则**：功能小且无副作用（无 DB、无外部调用），GAN 对抗焦点应集中在"BEHAVIOR 测试是否能抓出'端点返回但 payload 形状错 / 字段偏离 / 内部时刻不一致 / 被 query 污染 / timezone 未 fallback' 这五类假实现"。

---

## Feature 1: `GET /api/brain/time` 返回单一聚合 JSON（iso + timezone + unix）

**行为描述**:

对该 URL 发出 GET 请求时，服务以 HTTP 200 返回 Content-Type 为 JSON 的响应体，对象**恰好**含三个字段 `iso`、`timezone`、`unix`，不混入其它字段。`iso` 是代表当前服务器时刻的 ISO 8601 字符串（含时区后缀 `Z` 或 `±HH:MM`，精度到毫秒）；`timezone` 是一个 IANA 名字字符串（如 `Asia/Shanghai`、`UTC`、`America/New_York`），必须非空；`unix` 是**整数秒**（非毫秒、非字符串、非浮点），即 `Math.floor(Date.now()/1000)`。端点不依赖 DB、不依赖鉴权、不依赖外部服务。query 参数与 request body 一律被**忽略**（客户端即使传 `?iso=evil&unix=1&timezone=Fake` 也不能污染输出）。三个字段取自**同一次** `Date.now()`（同次请求内，`new Date(iso).getTime()` 与 `unix * 1000` 之间差值 ≤ 2000ms）。

**硬阈值**:

- HTTP status = `200`
- `Content-Type` 头含 `application/json`
- `Object.keys(body).sort()` 严格等于 `['iso', 'timezone', 'unix']`
- `typeof body.iso === 'string'` 且 `new Date(body.iso).getTime()` 为有限数
- `Number.isInteger(body.unix)` 为真；`body.unix > 0`；`String(body.unix).length <= 10`（秒，不是毫秒）
- `typeof body.timezone === 'string'` 且 `body.timezone.length > 0`
- `Math.abs(new Date(body.iso).getTime() - body.unix * 1000) <= 2000`
- 当 `Intl.DateTimeFormat().resolvedOptions().timeZone` 返回空字符串/undefined 时，`body.timezone === 'UTC'`（PRD 边界情况）
- 响应时间对比客户端时刻偏差 ≤ 2 秒（排除实现用了过期缓存）
- 传 `?iso=evil&unix=1&timezone=Fake` 不改变 body 中三字段的类型约束且值仍为"当前服务器时间"

**BEHAVIOR 覆盖**（落入 `tests/ws1/time.test.ts`）:

- `it('GET /api/brain/time responds with HTTP 200 and application/json content type')`
- `it('response body contains exactly the three keys iso, timezone, unix — no others')`
- `it('iso is a string parseable as a Date within 2 seconds of request time')`
- `it('unix is a positive integer in seconds (at most 10 digits), not milliseconds')`
- `it('timezone is a non-empty string')`
- `it('new Date(iso).getTime() and unix * 1000 agree within 2000ms')`
- `it('ignores query parameters and returns server-side current time (cannot be poisoned by ?iso=evil etc.)')`
- `it('timezone falls back to "UTC" when Intl.DateTimeFormat resolves timeZone to empty/undefined')`

**ARTIFACT 覆盖**（落入 `contract-dod-ws1.md`）:

- `packages/brain/src/routes/time.js` 文件存在
- `routes/time.js` 定义 `router.get('/time', ...)` 路由
- `routes/time.js` 默认导出 Express Router 实例（`export default router`）
- `packages/brain/src/routes.js` 导入 time router（含 `from './routes/time.js'`）
- `packages/brain/src/routes.js` 将 `timeRouter` 加入 for-of 合并数组（出现在 `router.stack.push(...)` 上下文附近）
- `routes/time.js` 不 `import` 任何 DB 或外部服务模块（`db.js`、`pg`、`redis`、`openai`、`anthropic` 均不出现）

---

## Workstreams

workstream_count: 1

### Workstream 1: `/api/brain/time` 路由模块 + 聚合器挂接

**范围**:
- 新增 `packages/brain/src/routes/time.js`（约 20 行）：Express Router，定义 `GET /time` 返回 `{ iso, timezone, unix }`，含 timezone fallback 到 `UTC`
- 修改 `packages/brain/src/routes.js`：新增 `import timeRouter from './routes/time.js'`，将 `timeRouter` 加入现有 `for (const subRouter of [...])` 合并数组末尾
- **不**改 `server.js`、**不**改 DB、**不**新增依赖、**不**动 middleware

**大小**: S（预计 <30 行净新增 + 1 行 import + 1 个数组成员追加）

**依赖**: 无（Brain 已有 express + Router 聚合架构）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/time.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖（it 描述） | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/time.test.ts` | 1) 200+JSON / 2) 恰好三字段 / 3) iso 2s-of-now / 4) unix 整数秒 / 5) timezone 非空 / 6) iso↔unix 一致 / 7) query 忽略 / 8) UTC fallback | 模块 `packages/brain/src/routes/time.js` 尚不存在 → vitest import 解析即失败，全套 8 个 it 在 load phase 被标记 FAIL（suite-level unhandled error）；Generator 实现后 8 测全转绿 |

---

## GAN 对抗要点（供 Reviewer 聚焦）

Reviewer 应当挑战以下命题能否被本合同中的测试/ARTIFACT 精准抓出（Mutation 视角）：

1. **"假 iso"**：实现返回固定字符串 `"2024-01-01T00:00:00.000Z"` → 被 `it(3)` 的 2s 偏差阈值抓住
2. **"假 unix（毫秒而非秒）"**：实现 `unix: Date.now()` → 13 位长度 → 被 `it(4)` 的 `String().length <= 10` 抓住
3. **"假 timezone（空字符串）"**：实现 `timezone: ''` → 被 `it(5)` 的 `length > 0` 抓住
4. **"字段白名单破坏（多加 offset/version）"** → 被 `it(2)` 的 `Object.keys(...).sort() === [...]` 严格相等抓住
5. **"iso 与 unix 不同源（两次 Date.now 相差大）"** → 被 `it(6)` 的 2000ms 阈值抓住
6. **"被 query 污染"**：实现 `res.json({ iso: req.query.iso || ..., unix: Number(req.query.unix) || ..., ... })` → 被 `it(7)` 抓住（传入 `?iso=evil&unix=1` 时 iso 不能为 `'evil'`，unix 不能为 1）
7. **"timezone 未 fallback"**：实现 `timezone: Intl.DateTimeFormat().resolvedOptions().timeZone`（未加 `|| 'UTC'`）→ 被 `it(8)` 的 spy mock 抓住
8. **"只挂在单独路径而非聚合器（破坏 FR-004）"** → 被 ARTIFACT 检查 `routes.js` 中 `timeRouter` 入合并数组抓住

## PRD 追溯性

| PRD 条目 | 覆盖位置 |
|---|---|
| FR-001（GET /api/brain/time，无鉴权无 DB） | WS1 route 实现 + ARTIFACT "不 import DB" |
| FR-002（响应体只含 iso/timezone/unix） | BEHAVIOR `it(2)` 字段白名单 |
| FR-003（iso=ISO 8601 / unix=整数秒 / timezone 非空） | BEHAVIOR `it(3)(4)(5)` |
| FR-004（挂接到现有聚合器） | ARTIFACT "routes.js 含 timeRouter 且加入合并数组" |
| SC-001（≥3 条单测） | 本合同含 8 条 it() |
| SC-002（Supertest HTTP 集成） | tests/ws1/time.test.ts 用 supertest |
| SC-003（真机 curl + jq） | 由 `harness-final-e2e` 阶段执行；本合同 BEHAVIOR 复现等价断言 |
| SC-004（brain-ci 全绿） | 由 CI 保证（新增测试含类型/值断言不会误伤 main） |
| 边界: timezone Intl 回落 UTC | BEHAVIOR `it(8)` |
| 边界: 忽略客户端输入 | BEHAVIOR `it(7)` |
