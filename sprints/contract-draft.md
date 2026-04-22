# Sprint Contract Draft (Round 1)

> **PRD 来源**：`sprints/sprint-prd.md`（Initiative：Harness v6 真机闭环 — 最小时间端点靶标）
>
> **设计原则**：3 个端点行为简单且可观测，行为差异（payload shape）用 BEHAVIOR 测试覆盖；端点存在性、模块结构、挂载、LOC 上限用 ARTIFACT 覆盖。GAN 对抗的焦点应集中在"BEHAVIOR 测试是否能抓出'端点存在但 payload 形状错'的假实现"。

---

## Feature 1: `GET /api/brain/time/iso` 返回 ISO 8601 当前时刻

**行为描述**:
对该 URL 发出 GET 请求时，服务以 HTTP 200 返回 JSON `{"iso": "<ISO 8601 字符串>"}`。其中 `iso` 字段必须是合法的 ISO 8601 格式：含日期、时间（精确到毫秒）、时区后缀（`Z` 表示 UTC，或 `±HH:MM` 表示偏移）。响应 `Content-Type` 为 `application/json`。任意 query 参数都被忽略，端点仍返回当前时刻。返回的 `iso` 与服务器系统时钟当前时刻偏差不超过 5 秒。

**硬阈值**:
- HTTP status = `200`
- Response body 为 JSON 对象，**必须**含字段 `iso`
- `iso` 值匹配正则 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}:\d{2})$`
- `Content-Type` 头含 `application/json`
- `iso` 解析后的时间戳与 `Date.now()` 偏差 < 5000 ms
- 加入 `?foo=bar&unknown=1` query 仍返回 200 与同样格式

**BEHAVIOR 覆盖**（落入 `tests/ws1/time-endpoints.test.ts`）:
- `it('GET /iso returns 200 with ISO 8601 string ending with Z or ±HH:MM and millisecond precision')`
- `it('GET /iso ignores unknown query parameters and still returns 200 with valid iso')`
- `it('GET /iso timestamp is within 5 seconds of test execution time')`

**ARTIFACT 覆盖**（落入 `contract-dod-ws1.md`）:
- `time-endpoints.js` 含 `router.get('/iso'` 路由声明
- `time-endpoints.js` 默认导出 Express Router

---

## Feature 2: `GET /api/brain/time/timezone` 返回 IANA 时区与偏移

**行为描述**:
对该 URL 发出 GET 请求时，服务以 HTTP 200 返回 JSON `{"timezone": "<IANA>", "offset": "<±HH:MM>", "iso": "<ISO 8601>"}`。`timezone` 是合法 IANA 名（如 `Asia/Shanghai`、`UTC`、`America/New_York`），`offset` 形如 `+08:00` / `-05:00` / `+00:00`，`iso` 与 Feature 1 同格式。当 `process.env.TZ` 与 `Intl.DateTimeFormat().resolvedOptions().timeZone` 均不可用时，端点必须 fallback 为 `timezone="UTC"` + `offset="+00:00"`，且仍返回 HTTP 200（无 5xx）。

**硬阈值**:
- HTTP status = `200`
- Body 含字段 `timezone`、`offset`、`iso` 三者全部非空字符串
- `timezone` 匹配 IANA 命名（首字母大写，可含 `/` 分隔，正则 `^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z][A-Za-z0-9_+\-]*)*$`）
- `offset` 严格匹配 `^[+-]\d{2}:\d{2}$`
- `iso` 同 Feature 1 的正则
- 强制 `Intl.DateTimeFormat` 不可用时仍返回 200，且 `timezone="UTC"`、`offset="+00:00"`

**BEHAVIOR 覆盖**（落入 `tests/ws1/time-endpoints.test.ts`）:
- `it('GET /timezone returns 200 with timezone, offset, iso fields all matching expected formats')`
- `it('GET /timezone offset string strictly matches ±HH:MM regex (rejects HHMM, ±H:MM, etc.)')`
- `it('GET /timezone falls back to UTC and +00:00 when Intl resolves to undefined')`

**ARTIFACT 覆盖**:
- `time-endpoints.js` 含 `router.get('/timezone'` 路由声明

---

## Feature 3: `GET /api/brain/time/unix` 返回 10 位 Unix 秒整数

**行为描述**:
对该 URL 发出 GET 请求时，服务以 HTTP 200 返回 JSON `{"unix": <integer>}`。`unix` 字段必须是 JavaScript Number 类型的**整数**（非字符串、非浮点），值为当前 Unix 秒（即 `Math.floor(Date.now() / 1000)`）。其十进制字符串长度恰好为 10 位（覆盖到 2286 年前），值为正数。返回的 `unix` 与测试时刻偏差不超过 5 秒。

**硬阈值**:
- HTTP status = `200`
- Body 含字段 `unix`，类型必须 `Number.isInteger(body.unix) === true`
- `body.unix > 0` 且 `String(body.unix).length === 10`
- `Math.abs(body.unix - Math.floor(Date.now()/1000)) < 5`
- 不能返回毫秒值（13 位）—— 必须是秒

**BEHAVIOR 覆盖**（落入 `tests/ws1/time-endpoints.test.ts`）:
- `it('GET /unix returns 200 with body.unix as a 10-digit positive integer (seconds, not milliseconds)')`
- `it('GET /unix value is within 5 seconds of test execution Math.floor(Date.now()/1000)')`
- `it('GET /unix returns Number type for unix field, not a string')`

**ARTIFACT 覆盖**:
- `time-endpoints.js` 含 `router.get('/unix'` 路由声明

---

## Feature 4: 路由模块挂载到 `/api/brain/time` 前缀

**行为描述**:
新建文件 `packages/brain/src/routes/time-endpoints.js` 实现一个 Express Router，挂载 3 条 GET 子路由（`/iso`、`/timezone`、`/unix`）。在 `packages/brain/src/routes.js` 中 `import` 该 Router 并 `router.use('/time', timeEndpointsRouter)`。这样 server.js 的 `app.use('/api/brain', brainRoutes)` 会让 3 个端点暴露在 `/api/brain/time/*`。

**硬阈值**:
- 文件 `packages/brain/src/routes/time-endpoints.js` 存在
- `time-endpoints.js` 含 `import { Router } from 'express'`
- `time-endpoints.js` 含 `export default router`（默认导出）
- `routes.js` 含 `import timeEndpointsRouter from './routes/time-endpoints.js'`
- `routes.js` 含 `router.use('/time', timeEndpointsRouter)`
- `time-endpoints.js` 总行数 ≤ 80（满足 SC-003 LOC ≤ 100 约束）

**BEHAVIOR 覆盖**（与 Feature 1-3 共用 `tests/ws1/time-endpoints.test.ts`）:
- 上述所有 BEHAVIOR 测试都从 router 模块直接 import handlers 调用，间接验证 router 注册
- `it('default exported router exposes 3 GET routes: /iso /timezone /unix')`

**ARTIFACT 覆盖**: 全部进 `contract-dod-ws1.md`（见上述硬阈值）。

---

## Feature 5: 端到端冒烟脚本 + 可单元测试的 validators

**行为描述**:
新建文件 `packages/brain/test/time-endpoints.smoke.mjs` —— 这是 Final E2E 阶段执行的真机冒烟脚本，对 `localhost:5221` 的 3 个 `/api/brain/time/*` 端点逐一发 GET，校验 status 与 body shape，全部通过则 `exit 0`，任一失败 `exit 1`。脚本通过 `BRAIN_BASE` 环境变量可覆盖默认 base URL。同时该脚本将"判断 body shape"的逻辑抽成 3 个**纯函数 validator**：`validateIsoBody(body)`、`validateTimezoneBody(body)`、`validateUnixBody(body)`，全部 `export` 出去，便于单元测试在不启动 Brain 的前提下覆盖 shape 校验逻辑。

**硬阈值**:
- 文件 `packages/brain/test/time-endpoints.smoke.mjs` 存在
- 含 3 个 `export function validate*Body` 命名导出
- 主函数行为：3 个端点全 200 且 shape 通过 → `exit 0`；任一失败 → `exit 1`
- 脚本内引用了 `process.env.BRAIN_BASE`（可覆盖默认 base URL）
- `validateIsoBody`：接受合法 ISO 8601（毫秒 + Z 或 ±HH:MM），拒绝缺字段、非字符串、缺毫秒、缺时区后缀
- `validateTimezoneBody`：接受 `{timezone, offset, iso}` 三字段全合法，拒绝缺任一字段、`offset` 格式错（如 `+0800`、`+8:00`）
- `validateUnixBody`：接受 10 位正整数，拒绝 13 位（毫秒）、0、负数、非整数、字符串
- 总行数 ≤ 60（满足 SC-003 LOC ≤ 100 约束）

**BEHAVIOR 覆盖**（落入 `tests/ws2/smoke-validators.test.ts`）:
- `it('validateIsoBody accepts ISO 8601 with millisecond precision and Z suffix')`
- `it('validateIsoBody accepts ISO 8601 with millisecond precision and ±HH:MM offset suffix')`
- `it('validateIsoBody rejects body missing iso field')`
- `it('validateIsoBody rejects iso string without millisecond fraction')`
- `it('validateIsoBody rejects iso string without timezone suffix')`
- `it('validateIsoBody rejects non-object body (null, string, number)')`
- `it('validateTimezoneBody accepts {timezone, offset, iso} with all three fields valid')`
- `it('validateTimezoneBody rejects body missing timezone field')`
- `it('validateTimezoneBody rejects body missing offset field')`
- `it('validateTimezoneBody rejects offset in HHMM (no colon) format')`
- `it('validateTimezoneBody rejects offset with single-digit hour (+8:00)')`
- `it('validateUnixBody accepts a 10-digit positive integer like Math.floor(Date.now()/1000)')`
- `it('validateUnixBody rejects 13-digit millisecond value')`
- `it('validateUnixBody rejects zero and negative integers')`
- `it('validateUnixBody rejects string representation of integer')`
- `it('validateUnixBody rejects non-integer (float) value')`

**ARTIFACT 覆盖**（落入 `contract-dod-ws2.md`）:
- `time-endpoints.smoke.mjs` 文件存在且 ≤ 60 行
- 文件含 `export function validateIsoBody`、`validateTimezoneBody`、`validateUnixBody`
- 文件含 `process.env.BRAIN_BASE` 引用

---

## Workstreams

workstream_count: 2

### Workstream 1: time-endpoints router 实现 + 挂载

**范围**:
- 新建 `packages/brain/src/routes/time-endpoints.js`（实现 3 条 GET 路由 + 默认导出 Router + 命名导出 3 个 handler 便于测试）
- 修改 `packages/brain/src/routes.js`：新增 import 一行 + 新增 `router.use('/time', timeEndpointsRouter)` 一行
- 不动 server.js、不动 db、不动其他路由

**大小**: S（新增 ≤ 80 行 + 修改 ≤ 4 行）

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/time-endpoints.test.ts`（覆盖 Feature 1/2/3/4 的端点行为）

### Workstream 2: 端到端冒烟脚本 + validators

**范围**:
- 新建 `packages/brain/test/time-endpoints.smoke.mjs`（导出 3 个纯函数 validator + 提供 main 入口跑 3 个端点冒烟）
- 不依赖 WS1 实现完成（脚本只在 Final E2E 阶段运行；validator 可独立单元测试）

**大小**: S（新增 ≤ 60 行）

**依赖**: 无（与 WS1 在代码层完全独立；运行时由 Final E2E 串起来）

**BEHAVIOR 覆盖测试文件**: `tests/ws2/smoke-validators.test.ts`（覆盖 Feature 5 的 validator 纯函数行为）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/time-endpoints.test.ts` | 3 端点 happy path（iso/timezone/unix shape）+ query 参数忽略 + 时间戳 ±5s 精度 + Intl fallback + Number 类型 + Router 注册 | `npx vitest run sprints/tests/ws1/` → 11 failures（模块文件不存在，全部 import 报错） |
| WS2 | `tests/ws2/smoke-validators.test.ts` | 3 个 validator 纯函数：accept/reject 各种合法与非法输入；ISO 格式、IANA + offset 格式、10 位整数与 13 位毫秒区分 | `npx vitest run sprints/tests/ws2/` → 16 failures（smoke 脚本文件不存在，全部 import 报错） |

**Red evidence 收集**：见 `tests/ws*/RED_EVIDENCE.md`（Step 2d 输出，本轮记录"node_modules 在隔离环境未预装；测试通过 import 路径静态校验 + Generator 实跑前需 `npm i -w packages/brain`"）。

---

## GAN 对抗指南（给 Reviewer 看）

Reviewer 应聚焦的 mutation 思路：
1. **假实现 1**：handler 总是返回 `{iso: "ok"}` —— 应被 ISO 正则断言抓出
2. **假实现 2**：unix handler 返回 `Date.now()`（13 位毫秒）—— 应被 `String(unix).length === 10` 抓出
3. **假实现 3**：timezone handler 返回 `offset: "+0800"`（缺冒号）—— 应被 OFFSET_RE 抓出
4. **假实现 4**：iso handler 返回 ISO 但无毫秒 `2026-04-22T12:00:00Z` —— 应被毫秒断言抓出
5. **假实现 5**：unix handler 返回字符串 `"1745324400"` —— 应被 `Number.isInteger` 抓出
6. **假实现 6**：路由挂载在 `/timestamp` 而非 `/time` —— 应被 ARTIFACT grep 抓出
7. **假实现 7**：smoke validator 永远返回 `true` —— 应被"reject 非法输入"测试抓出

如 Reviewer 发现以上任一 mutation 能通过当前测试集，提 REVISION 加强。
