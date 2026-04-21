# Sprint Contract Draft (Round 3)

本合同由 Proposer 针对 `sprints/sprint-prd.md`（Brain `/api/brain/time` 端点）起草，
进入 GAN 对抗。合同外一字不加，Generator 须严格按本合同实现。

> **Round 3 修订说明**（响应 Round 2 Reviewer 反馈）：
> 1. **主要阻断修复**：测试文件由 `sprints/tests/ws1/time.test.ts` 改为 `sprints/tests/ws1/time.test.js`，
>    与 Brain workspace 同语言（`type: module` ESM JS），消除"vitest 是否能解析 .ts"的环境疑虑；
>    与 PRD 假设"沿用既有路由/测试约定"完全一致；不引入 `tsconfig.json` / `tsx` 等额外依赖。
> 2. **次要修订 1**：删除 ARTIFACT "`new Date(` 文本恰好 1 次"约束（避免 Generator 写注释/示例时被字符匹配误伤）。
>    "单一快照"语义改由更强的行为断言兜底——`Math.floor(Date.parse(iso) / 1000) === unix` 严格相等。
>    实现里若分两次调用 `new Date()` 而跨秒，行为测试会立即捕获；ARTIFACT 仅保留 `toISOString` / `getTime` / `resolvedOptions` 三个调用线索。
> 3. **次要修订 2**：`unix` 数量级硬阈值新增下限 `unix > 1e9`（≈ 2001-09-09 后），
>    与现有上限 `< 1e12` 共同夹住"秒级时间戳"区间，防止 `1` / `42` 等极小退化值蒙混过关。
> 4. 上述 3 处变更同时落入 `contract-dod-ws1.md` 与 `tests/ws1/time.test.js`，并已本地实跑确认 10/10 红（见底部 Test Contract 表）。
>
> **Round 2 修订说明**（保留以便上下文追溯）：
> - 已在本地实跑测试并记录 Red 证据；
> - 新增 ARTIFACT 强挂载校验：server.js 中 import 变量名必须与 `app.use('/api/brain/time', …)` 挂载变量名一致，且路径字面量严格为 `/api/brain/time`；同时新增一条 BEHAVIOR 测试静态解析 server.js 验证同一点；
> - iso↔unix 硬阈值由"≤ 2 秒"收紧为同秒严格相等；
> - `timezone` 合法性硬阈值由"非空字符串"升级为"能被 `new Intl.DateTimeFormat('en', { timeZone: <value> })` 无异常构造"。

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
- 响应体是 JSON 对象，至少包含 3 个字段：`iso`、`timezone`、`unix`
- `iso` 是能被 `Date.parse(iso)` 成功解析（`!Number.isNaN`）的字符串；
  且匹配正则 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$`
  （ISO 8601 扩展格式，含时区后缀）
- `timezone` 是长度 ≥ 1 的字符串，且**必须是合法 IANA 时区名**：
  `new Intl.DateTimeFormat('en-US', { timeZone: <value> })` 调用不抛异常（等价于 ICU/V8 认可的 IANA tzdb 条目，含 `UTC`）；禁止 `""` / `null` / `"local"` / `"x"` 等非 IANA 占位
- `unix` 是严格正整数：`Number.isInteger(unix) === true`；
  数量级必须落在秒级区间：`unix > 1e9`（**R3 新增下限**，约 2001-09-09 后）且 `unix < 1e12`（毫秒级会 ≥ 1e12）；
  且不应偏离真实当下 60 秒以上：`Math.abs(unix - Math.floor(Date.now() / 1000)) ≤ 60`
- 同一响应内 `iso` 与 `unix` 表达的时刻**同秒严格相等**：
  `Math.floor(Date.parse(iso) / 1000) === unix`（不允许任何秒级偏差——这是"单一 `new Date()` 快照"语义的真正兜底）
- 连续两次调用均返回 200，每次响应内部仍满足上述所有阈值（无状态污染）

**BEHAVIOR 覆盖**（落入 `tests/ws1/time.test.js`）:
- `it('returns HTTP 200 with application/json content-type')`
- `it('response body contains iso, timezone, unix fields all non-empty')`
- `it('iso is a valid ISO 8601 extended format string parseable by Date')`
- `it('timezone is a non-empty string')`
- `it('timezone is a valid IANA name accepted by Intl.DateTimeFormat')`
- `it('unix is a positive integer in seconds (lower bound > 1e9, upper bound < 1e12)')`（**R3 加下限**）
- `it('iso and unix within a single response represent the exact same second (strict equality)')`
- `it('two consecutive calls both succeed and each response is internally consistent to the second')`
- `it('does not require any auth header to return 200')`
- `it('packages/brain/server.js imports time router and mounts it at /api/brain/time using the same variable')`

**ARTIFACT 覆盖**（落入 `contract-dod-ws1.md`）:
- `packages/brain/src/routes/time.js` 存在，使用 `express.Router()` 并 `export default` 一个 Router 实例
- 路由文件含 `toISOString`、`getTime`、`resolvedOptions` 三个调用（**R3 修订**：删除"`new Date(` 文本恰好 1 次"约束，避免误伤合法注释；单一快照语义改由行为断言强等兜底）
- `packages/brain/server.js` 用 ESM import 引入该路由，指向 `./src/routes/time.js`
- `packages/brain/server.js` 的 `app.use('/api/brain/time', <varname>)` 挂载变量与 import 变量**同名**（避免错挂）
- 单元测试文件 `packages/brain/src/__tests__/routes-time.test.js` 存在，使用 `supertest` 发 `GET /api/brain/time`，含至少 4 个 `it(` 块
- `docs/current/README.md` 含 `/api/brain/time` 条目、三字段名、响应示例

---

## Workstreams

workstream_count: 1

### Workstream 1: Brain /api/brain/time 只读时间端点

**范围**:
- 新增 `packages/brain/src/routes/time.js`（Express Router，仅一个 `GET /` 处理函数；挂载前缀 `/api/brain/time`）
- 在 `packages/brain/server.js` 顶部 import 该路由，并在主中间件区挂载到 `/api/brain/time`（挂载变量名与 import 变量名一致）
- 新增单元测试 `packages/brain/src/__tests__/routes-time.test.js`（supertest，无 DB 依赖）
- 在 `docs/current/README.md` 中新增 `/api/brain/time` 条目（方法、路径、字段示例）

**大小**: S（总新增 < 100 行；纯路由，无 DB、无中间件改造）
**依赖**: 无（本 sprint 仅此一个 workstream）

**BEHAVIOR 覆盖测试文件**: `tests/ws1/time.test.js`（**R3**：由 `.ts` 改为 `.js`，与 Brain workspace 同语言）
（以 supertest 对真实 Express 应用端到端断言，共 10 条 `it` 块；其中 9 条走 router 行为断言，1 条静态解析 server.js 验证挂载可达）

**实现约束**（由合同强制，Generator 不可偏离）:
- 三字段 **必须来自同一个 `Date` 快照**——即 `const now = new Date()` 只调用一次，
  `iso` 来自 `now.toISOString()`，`unix` 来自 `Math.floor(now.getTime() / 1000)`，
  `timezone` 来自 `Intl.DateTimeFormat().resolvedOptions().timeZone`
- 因单一快照约束，`Math.floor(Date.parse(iso) / 1000)` 与 `unix` 必然严格相等（同秒），测试按此严格断言（**R3**：这是单一快照的唯一硬证据，ARTIFACT 不再用文本计数兜底）
- 不得引入新的 npm 依赖；只能使用已存在的 `express`
- 不得添加鉴权中间件、不得添加限流中间件、不得写 DB
- 在 `packages/brain/server.js` 中，import 变量名必须为 `timeRoutes`，且 `app.use('/api/brain/time', timeRoutes)` 严格字面量（消歧，避免挂载/import 错位）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据（Proposer 本地实跑） |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/time.test.js` | 10 条 `it`：200/JSON、三字段存在、iso 合规、timezone 非空、timezone IANA 合法、unix 秒级正整数（含 1e9 下限）、iso↔unix 同秒严格相等、连续两次调用同秒一致、无需鉴权、server.js 挂载可达 | `npx vitest run sprints/tests/ws1/time.test.js` → **10 failed**（Proposer 已实跑，见下方证据） |

**R3 本地 Red evidence**（Proposer 运行记录，由 .ts → .js 后重跑）:
```
RUN  v1.6.1 /workspace
× sprints/tests/ws1/time.test.js > ... > returns HTTP 200 with application/json content-type
× sprints/tests/ws1/time.test.js > ... > response body contains iso, timezone, unix fields all non-empty
× sprints/tests/ws1/time.test.js > ... > iso is a valid ISO 8601 extended format string parseable by Date
× sprints/tests/ws1/time.test.js > ... > timezone is a non-empty string
× sprints/tests/ws1/time.test.js > ... > timezone is a valid IANA name accepted by Intl.DateTimeFormat
× sprints/tests/ws1/time.test.js > ... > unix is a positive integer in seconds (lower bound > 1e9, upper bound < 1e12)
× sprints/tests/ws1/time.test.js > ... > iso and unix within a single response represent the exact same second (strict equality)
× sprints/tests/ws1/time.test.js > ... > two consecutive calls both succeed and each response is internally consistent to the second
× sprints/tests/ws1/time.test.js > ... > does not require any auth header to return 200
× sprints/tests/ws1/time.test.js > ... > packages/brain/server.js imports time router and mounts it at /api/brain/time using the same variable

Test Files  1 failed (1)
     Tests  10 failed (10)
```
前 9 条失败源于 `Failed to load url ../../../packages/brain/src/routes/time.js`（TDD Red —— 实现尚不存在）；
第 10 条（server.js 挂载静态解析）失败源于 server.js 中尚无 time 路由的 import 与 `app.use('/api/brain/time', …)`（TDD Red —— 挂载尚未接线）。

> **环境一致性说明**（响应 Round 2 阻断点）：
> 本测试文件改为纯 JS（`.test.js`），无任何 TypeScript 类型注解。vitest 1.6.1 内置 ESM JS 解析，
> 不依赖 `tsconfig.json` / `tsx` / `typescript` 任何 TS 工具链；此条 Red evidence 与 Brain workspace
> （`vitest.config.js` 的 `include` 同时收 `.test.js` 与 `.test.ts`）的 vitest 行为完全一致。
> 即便 sprints/tests/ws1/ 不在 Brain workspace 的 include 路径里，根目录 `npx vitest run` 也能直接解析。
