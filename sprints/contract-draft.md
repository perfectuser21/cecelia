# Sprint Contract Draft (Round 3)

> **PRD 来源**：`sprints/sprint-prd.md`（Initiative：Harness v6 真机闭环 — 最小时间端点靶标）
>
> **设计原则**：3 个端点行为简单且可观测，行为差异（payload shape）用 BEHAVIOR 测试覆盖；端点存在性、模块结构、挂载、LOC 上限用 ARTIFACT 覆盖。GAN 对抗的焦点应集中在"BEHAVIOR 测试是否能抓出'端点存在但 payload 形状错'的假实现"。
>
> **Round 3 修订摘要**（响应 Round 2 Reviewer 反馈的 3 项风险）：
> 1. **mockRes 语义锁死（反制 mutation 10 的 send 绕过）**：mockRes 新增 `.send(payload)`（只写 body、不写 content-type）和 `.setHeader(name, value)`（显式写 header）方法，并在注释里明示：只有 `.json()` 与显式 `.set('content-type', ...)` 会写 content-type。任何试图用 `res.status(200).send(JSON.stringify(body))` 绕过 `res.json()` 的假实现，其 3 个 Content-Type it() 必定失败。
> 2. **timezone/offset 联合一致性（反制新 mutation 11）**：Feature 2 新增 `it('binds offset to timezone: Asia/Kolkata must yield +05:30')`。选 `Asia/Kolkata` 是因为印度标准时固定 `+05:30` 且**无 DST**，消除季节性歧义。这让"timezone 从 Intl 读但 offset 走独立分支返回 `+08:00`"一类的错配假实现被直接抓出。
> 3. **handler 禁止模块级缓存 Intl（反制新 mutation 12）**：
>    - **ARTIFACT 侧**：`contract-dod-ws1.md` 新增一条硬约束——`getTimezoneHandler` **函数体内部** 必须引用 `Intl.DateTimeFormat`（正则锁定函数起点后 2000 字符窗口）。如果写成 `const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone` 的模块级常量，函数体内就查不到 Intl，ARTIFACT 直接 fail。
>    - **BEHAVIOR 侧**：新增 `it('calls Intl.DateTimeFormat on every request')`，同一测试里连续两次 stubGlobal Intl（第一次 `Europe/London`，第二次 `America/New_York`），断言 handler 两次返回值跟随 stub 变化且彼此不同。若 handler 在模块加载时固化 TZ，两次返回会相同 → 测试失败。
>
> **本轮 it() 计数**：WS1 由 14 → 16（+2）；WS2 不变（16）。Test Contract 表"预期红证据"相应更新为 `16 failures`（WS1）。
>
> **Round 2 修订摘要**（保留为历史记录）：
> 1. **红数量表对齐**：WS1 由 10 → 14 it()，新增 `Content-Type` ×3 + `Intl 正向读取` ×1
> 2. **Content-Type 补 BEHAVIOR**：Feature 1/2/3 三端点新增 `Content-Type` BEHAVIOR it()
> 3. **IANA 正则收紧**：Feature 2 硬阈值改为白名单式正则，抓出 mutation 9（`timezone: "Foo"`）
> 4. **Intl mock 正向路径**：Feature 2 新增 `reads IANA timezone from Intl.DateTimeFormat` it()（用 `Pacific/Auckland`）
> 5. **ARTIFACT handler 导出正则扩展**：覆盖 `export { NAME }` / `export { xxx as NAME }` 两种语法

---

## Feature 1: `GET /api/brain/time/iso` 返回 ISO 8601 当前时刻

**行为描述**:
对该 URL 发出 GET 请求时，服务以 HTTP 200 返回 JSON `{"iso": "<ISO 8601 字符串>"}`。其中 `iso` 字段必须是合法的 ISO 8601 格式：含日期、时间（精确到毫秒）、时区后缀（`Z` 表示 UTC，或 `±HH:MM` 表示偏移）。响应 `Content-Type` 为 `application/json`。任意 query 参数都被忽略，端点仍返回当前时刻。返回的 `iso` 与服务器系统时钟当前时刻偏差不超过 5 秒。

**硬阈值**:
- HTTP status = `200`
- Response body 为 JSON 对象，**必须**含字段 `iso`
- `iso` 值匹配正则 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}:\d{2})$`
- `Content-Type` 响应头匹配 `application/json`（调用方式必须走 `res.json()`，禁止 `res.send(JSON.stringify(...))` 这类绕开 Express content-type 协商的写法）
- `iso` 解析后的时间戳与 `Date.now()` 偏差 < 5000 ms
- 加入 `?foo=bar&unknown=1` query 仍返回 200 与同样格式

**BEHAVIOR 覆盖**（落入 `tests/ws1/time-endpoints.test.ts`）:
- `it('returns 200 with ISO 8601 string ending with Z or ±HH:MM and millisecond precision')`
- `it('ignores unknown query parameters and still returns 200 with valid iso')`
- `it('timestamp is within 5 seconds of test execution time')`
- `it('GET /iso responds with application/json Content-Type header')` ← **Round 2 新增**

**ARTIFACT 覆盖**（落入 `contract-dod-ws1.md`）:
- `time-endpoints.js` 含 `router.get('/iso'` 路由声明
- `time-endpoints.js` 默认导出 Express Router

---

## Feature 2: `GET /api/brain/time/timezone` 返回 IANA 时区与偏移

**行为描述**:
对该 URL 发出 GET 请求时，服务以 HTTP 200 返回 JSON `{"timezone": "<IANA>", "offset": "<±HH:MM>", "iso": "<ISO 8601>"}`。`timezone` 是合法 IANA 名（`UTC` / `GMT` 或 `<Region>/<City>[/<SubCity>]`，其中 Region 必须命中官方白名单：`Asia|America|Europe|Africa|Australia|Pacific|Atlantic|Indian|Antarctica|Etc`）。`offset` 形如 `+08:00` / `-05:00` / `+00:00`，`iso` 与 Feature 1 同格式。响应 `Content-Type` 为 `application/json`。当 `process.env.TZ` 与 `Intl.DateTimeFormat().resolvedOptions().timeZone` 均不可用时，端点必须 fallback 为 `timezone="UTC"` + `offset="+00:00"`，且仍返回 HTTP 200（无 5xx）。当 Intl 可用时（例如返回 `Pacific/Auckland`），必须透传而非强制覆盖为 `UTC`。
**Round 3 新增**：`timezone` 与 `offset` 必须**联合一致**——两者同源于 Intl 解析同一时刻，不得走独立分支；具体地，当 Intl 返回 `Asia/Kolkata` 时 `offset` 必须为 `+05:30`（印度标准时固定 `+05:30`，无 DST）。**handler 必须在每次请求内部调用 `Intl.DateTimeFormat().resolvedOptions().timeZone`，不得在模块加载时固化为常量**（否则无法随运行时 TZ/Intl stub 变化）。

**硬阈值**:
- HTTP status = `200`
- Body 含字段 `timezone`、`offset`、`iso` 三者全部非空字符串
- `timezone` 匹配**严格 IANA 白名单**正则 `^(UTC|GMT|(Asia|America|Europe|Africa|Australia|Pacific|Atlantic|Indian|Antarctica|Etc)\/[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z][A-Za-z0-9_+\-]*)?)$`（Round 2 收紧：宽松正则 `^[A-Za-z][A-Za-z0-9_+\-]*(\/...)*$` 会接受 `X`、`Foo`、`Abc123` 等非 IANA 字符串，无法抓出 mutation 9）
- `offset` 严格匹配 `^[+-]\d{2}:\d{2}$`
- `iso` 同 Feature 1 的正则
- `Content-Type` 响应头匹配 `application/json`
- 强制 `Intl.DateTimeFormat` 不可用（`resolvedOptions().timeZone === undefined` 且 `process.env.TZ` 未设置）时仍返回 200，且 `timezone="UTC"`、`offset="+00:00"`
- 当 `Intl.DateTimeFormat().resolvedOptions().timeZone` 返回合法 IANA 字符串（测试用 `Pacific/Auckland`），`body.timezone` **必须**为该字符串（反制 mutation 8：硬编码 UTC fallback）
- **联合一致**（Round 3）：当 Intl 返回 `Asia/Kolkata`，`body.timezone==='Asia/Kolkata'` **且** `body.offset==='+05:30'`（反制 mutation 11：timezone/offset 独立分支导致错配）
- **非缓存**（Round 3）：同一测试内连续两次用不同 Intl stub（如 `Europe/London` → `America/New_York`）调用 handler，两次 `body.timezone` 必须不同且等于当前 stub 值（反制 mutation 12：模块级 `const TZ = Intl...`）
- **Content-Type 路径**（Round 3 锁死）：mockRes 的 `.json()` 与 `.set('content-type', ...)` 是唯二写入 content-type 的入口；`.send()` 只写 body。handler 若用 `res.status(200).send(JSON.stringify(body))` 绕过 `res.json()`，Content-Type it() 直接失败

**BEHAVIOR 覆盖**（落入 `tests/ws1/time-endpoints.test.ts`）:
- `it('returns 200 with timezone, offset, iso fields all matching expected formats')`（含严格 IANA 正则断言，同时抓 mutation 9）
- `it('offset string strictly matches ±HH:MM regex (rejects HHMM, ±H:MM, etc.)')`
- `it('falls back to UTC and +00:00 when Intl.DateTimeFormat resolves to undefined')`
- `it('reads IANA timezone from Intl.DateTimeFormat (not hardcoded UTC) when resolvedOptions provides one')` ← **Round 2 新增**
- `it('binds offset to timezone: Asia/Kolkata must yield +05:30 (not any other valid offset)')` ← **Round 3 新增**（抓 mutation 11）
- `it('calls Intl.DateTimeFormat on every request (handler must not cache at module load)')` ← **Round 3 新增**（抓 mutation 12）
- `it('GET /timezone responds with application/json Content-Type header')` ← **Round 2 新增**

**ARTIFACT 覆盖**:
- `time-endpoints.js` 含 `router.get('/timezone'` 路由声明
- `getTimezoneHandler` 函数体内部引用 `Intl.DateTimeFormat`（Round 3 新增：禁止模块级缓存）

---

## Feature 3: `GET /api/brain/time/unix` 返回 10 位 Unix 秒整数

**行为描述**:
对该 URL 发出 GET 请求时，服务以 HTTP 200 返回 JSON `{"unix": <integer>}`。`unix` 字段必须是 JavaScript Number 类型的**整数**（非字符串、非浮点），值为当前 Unix 秒（即 `Math.floor(Date.now() / 1000)`）。其十进制字符串长度恰好为 10 位（覆盖到 2286 年前），值为正数。响应 `Content-Type` 为 `application/json`。返回的 `unix` 与测试时刻偏差不超过 5 秒。

**硬阈值**:
- HTTP status = `200`
- Body 含字段 `unix`，类型必须 `Number.isInteger(body.unix) === true`
- `body.unix > 0` 且 `String(body.unix).length === 10`
- `Math.abs(body.unix - Math.floor(Date.now()/1000)) < 5`
- 不能返回毫秒值（13 位）—— 必须是秒
- `Content-Type` 响应头匹配 `application/json`

**BEHAVIOR 覆盖**（落入 `tests/ws1/time-endpoints.test.ts`）:
- `it('returns 200 with body.unix as a 10-digit positive integer (seconds, not milliseconds)')`
- `it('value is within 5 seconds of test execution Math.floor(Date.now()/1000)')`
- `it('returns Number type for unix field, not a string')`
- `it('GET /unix responds with application/json Content-Type header')` ← **Round 2 新增**

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
- `time-endpoints.js` 必须命名导出 3 个 handler（`getIsoHandler` / `getTimezoneHandler` / `getUnixHandler`），覆盖 `export function ...` 与 `export { ... }` 两种语法（Round 2：ARTIFACT 正则扩展以兜底第二种写法）
- `routes.js` 含 `import timeEndpointsRouter from './routes/time-endpoints.js'`
- `routes.js` 含 `router.use('/time', timeEndpointsRouter)`
- `routes.js` 仍保持既有挂载（`/registry` `/pipelines` `/content-library` `/social` `/topics` `/harness` `/kr3`）
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
- 总行数 ≤ 60（满足 SC-003 LOC ≤ 100 总约束）

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

**BEHAVIOR 覆盖测试文件**: `tests/ws1/time-endpoints.test.ts`（16 个 `it()` 块，覆盖 Feature 1/2/3/4 的端点行为 + 3 端点 Content-Type 响应头 + Intl 正向读取 + timezone/offset 联合一致 + handler 非模块级缓存）

### Workstream 2: 端到端冒烟脚本 + validators

**范围**:
- 新建 `packages/brain/test/time-endpoints.smoke.mjs`（导出 3 个纯函数 validator + 提供 main 入口跑 3 个端点冒烟）
- 不依赖 WS1 实现完成（脚本只在 Final E2E 阶段运行；validator 可独立单元测试）

**大小**: S（新增 ≤ 60 行）

**依赖**: 无（与 WS1 在代码层完全独立；运行时由 Final E2E 串起来）

**BEHAVIOR 覆盖测试文件**: `tests/ws2/smoke-validators.test.ts`（16 个 `it()` 块，覆盖 Feature 5 的 validator 纯函数行为）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/time-endpoints.test.ts` | 3 端点 happy path + query 参数忽略 + 时间戳 ±5s + Intl fallback + Intl 正向透传 + **timezone/offset 联合一致** + **handler 非模块级缓存** + Number 类型 + Router 注册 + 3 端点 Content-Type 响应头 | `npx vitest run sprints/tests/ws1/` → **16 failures**（模块文件不存在，16 个 it() 全部 import 报错） |
| WS2 | `tests/ws2/smoke-validators.test.ts` | 3 个 validator 纯函数：accept/reject 各种合法与非法输入；ISO 格式、IANA + offset 格式、10 位整数与 13 位毫秒区分 | `npx vitest run sprints/tests/ws2/` → **16 failures**（smoke 脚本文件不存在，16 个 it() 全部 import 报错） |

**Red evidence 收集**：见 `tests/ws*/RED_EVIDENCE.md`（Step 2d 输出；Round 3 WS1 的 it() 数从 14 → 16，RED_EVIDENCE 同步更新）。

---

## GAN 对抗指南（给 Reviewer 看）

Reviewer 应聚焦的 mutation 思路（Round 3 追加 mutation 11、12，并强化 mutation 10 的 mockRes 语义锁死）：

1. **假实现 1**：handler 总是返回 `{iso: "ok"}` —— 应被 ISO 正则断言抓出
2. **假实现 2**：unix handler 返回 `Date.now()`（13 位毫秒）—— 应被 `String(unix).length === 10` 抓出
3. **假实现 3**：timezone handler 返回 `offset: "+0800"`（缺冒号）—— 应被 OFFSET_RE 抓出
4. **假实现 4**：iso handler 返回 ISO 但无毫秒 `2026-04-22T12:00:00Z` —— 应被毫秒断言抓出
5. **假实现 5**：unix handler 返回字符串 `"1745324400"` —— 应被 `Number.isInteger` 抓出
6. **假实现 6**：路由挂载在 `/timestamp` 而非 `/time` —— 应被 ARTIFACT grep 抓出
7. **假实现 7**：smoke validator 永远返回 `true` —— 应被 WS2 的"reject 非法输入"测试抓出
8. **假实现 8**（Round 2）：timezone handler 直接 `return { timezone: 'UTC', offset: '+00:00', iso: ... }` 硬编码 —— 应被 `reads IANA timezone from Intl.DateTimeFormat` it() 抓出（Pacific/Auckland）
9. **假实现 9**（Round 2）：timezone handler 返回 `{ timezone: 'Foo', offset: '+08:00', ... }`（非 IANA 字符串）—— 应被严格 IANA 白名单正则抓出
10. **假实现 10**（Round 2 提出 / Round 3 强化）：handler 走 `res.send(JSON.stringify(body))` 而非 `res.json(body)` 绕开 Express 的 content-type 协商 —— 应被 3 个 Content-Type it() 抓出。**Round 3 锁死 mockRes 语义**：`.send()` 只写 body 不写 header，`.json()` 与显式 `.set('content-type', ...)` 是唯二写入 header 的入口；任何绕过路径要么让 it 失败，要么必须显式 set header 也等于遵守契约。
11. **假实现 11**（Round 3 新增）：handler `timezone` 从 Intl 读，但 `offset` 走独立分支硬编码返回 `+08:00`，两者独立计算。测试 `{timezone: 'Asia/Kolkata', offset: '+08:00', ...}` 能通过严格 IANA 正则 + OFFSET_RE 两个个体校验，但违反联合一致性 —— 应被 `binds offset to timezone: Asia/Kolkata must yield +05:30` it() 抓出（印度标准时固定 `+05:30` 无 DST，消除季节性歧义）
12. **假实现 12**（Round 3 新增）：handler 在模块加载时就 `const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone; const OFFSET = ...` 固化为常量，请求时直接引用这些常量。stubGlobal Intl 后 handler 仍返回最初缓存值 —— 应被 `calls Intl.DateTimeFormat on every request` it() 抓出（连续两次不同 stub 应得到不同返回值）；同时 ARTIFACT 正则从 `getTimezoneHandler` 函数体内部搜 `Intl.DateTimeFormat` 应找不到，双重拦截

如 Reviewer 发现以上任一 mutation 能通过当前测试集，提 REVISION 加强。
