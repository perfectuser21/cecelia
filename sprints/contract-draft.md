# Sprint Contract Draft (Round 1)

本合同由 Proposer 针对 `sprints/sprint-prd.md`（Brain `/api/brain/time` 端点）起草，
进入 GAN 对抗。合同外一字不加，Generator 须严格按本合同实现。

---

## Feature 1: GET /api/brain/time 只读时间端点

**行为描述**:
外部调用方向 Brain 发送 `GET /api/brain/time`，Brain 在单次请求的一个时间快照内
返回一段 JSON，同时表达"当前时刻"的三种形式：ISO 8601 扩展字符串、IANA 时区名、
Unix 秒级整数。端点不需要鉴权、无副作用、对同一进程的重复调用每次都成功，
不依赖任何数据库或外部服务。

**硬阈值**:
- HTTP 响应状态码必须为 `200`
- 响应头 `Content-Type` 以 `application/json` 开头
- 响应体是 JSON 对象，恰好或至少包含 3 个字段：`iso`、`timezone`、`unix`
- `iso` 是能够被 `new Date(iso)` 成功解析、且 `!Number.isNaN(Date.parse(iso))` 的字符串；
  且 `iso` 字符串匹配正则 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$`
  （ISO 8601 扩展格式，含时区偏移）
- `timezone` 是长度 ≥ 1 的非空字符串；禁止为空字符串 `""`、禁止为 `null`
- `unix` 是严格正整数：`Number.isInteger(unix) === true` 且 `unix > 0`；
  `unix` 数量级必须是秒（判定：`unix < 1e12`，而毫秒级会 ≥ 1e12）
- 同一响应内 `iso` 与 `unix` 表达的时刻差距 ≤ 2 秒：
  `Math.abs(Math.floor(Date.parse(iso) / 1000) - unix) <= 2`
- 连续两次调用均返回 200，每次响应内部仍满足上述所有阈值（无态污染）

**BEHAVIOR 覆盖**（落入 `tests/ws1/time.test.ts`）:
- `it('returns HTTP 200 with application/json content-type')`
- `it('response body contains iso, timezone, unix fields all non-empty')`
- `it('iso is a valid ISO 8601 extended format string parseable by Date')`
- `it('timezone is a non-empty string')`
- `it('unix is a positive integer in seconds, not milliseconds and not float')`
- `it('iso and unix within a single response represent the same moment within 2 seconds')`
- `it('two consecutive calls both succeed and each response is internally consistent')`
- `it('does not require any auth header to return 200')`

**ARTIFACT 覆盖**（落入 `contract-dod-ws1.md`）:
- `packages/brain/src/routes/time.js` 文件存在
- 该路由文件使用 `express.Router()` 并 `export default` 一个 Router 实例（ESM 约定）
- `packages/brain/server.js` 含 `time` 路由的 `import` 语句，指向 `./src/routes/time.js`
- `packages/brain/server.js` 含 `app.use('/api/brain', ...)` 或 `app.use('/api/brain/time', ...)` 之一，
  且能将 `time` router 挂到 `/api/brain/time` 路径下
- 单元测试文件 `packages/brain/src/__tests__/routes-time.test.js` 存在
- `docs/current/README.md` 含 `/api/brain/time` 字符串，并含一段包含 `iso` 和 `unix` 字样的示例

---

## Workstreams

workstream_count: 1

### Workstream 1: Brain /api/brain/time 只读时间端点

**范围**:
- 新增 `packages/brain/src/routes/time.js`（Express Router，仅一个 `GET /time` 处理函数）
- 在 `packages/brain/server.js` 顶部 import 该路由，并在主中间件区挂载到 `/api/brain/time`
- 新增单元测试 `packages/brain/src/__tests__/routes-time.test.js`（supertest，无 DB 依赖）
- 在 `docs/current/README.md` 中新增 `/api/brain/time` 条目（方法、路径、字段示例）

**大小**: S（总新增 < 100 行；纯路由，无 DB、无中间件改造）
**依赖**: 无（与其他 workstream 完全独立；本 sprint 仅此一个 workstream）

**BEHAVIOR 覆盖测试文件**: `tests/ws1/time.test.ts`
（以 supertest 对真实 Express 应用端到端断言；覆盖上方 8 条 `it` 块）

**实现约束**（由合同强制，Generator 不可偏离）:
- 三字段 **必须来自同一个 `Date` 快照**——即 `const now = new Date()` 只调用一次，
  `iso` 来自 `now.toISOString()`，`unix` 来自 `Math.floor(now.getTime() / 1000)`，
  `timezone` 来自 `Intl.DateTimeFormat().resolvedOptions().timeZone`
- 不得引入新的 npm 依赖；只能使用已存在的 `express`
- 不得添加鉴权中间件、不得添加限流中间件、不得写 DB

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/time.test.ts` | 8 条 `it`：200/JSON、三字段存在、iso 合规、timezone 非空、unix 秒级正整数、iso↔unix 同时刻、连续两次调用一致性、无需鉴权 | `npx vitest run sprints/tests/ws1/` → 8 failures（当前 `packages/brain/src/routes/time.js` 不存在，测试在 import 阶段即全部失败） |

