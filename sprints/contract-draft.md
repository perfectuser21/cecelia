# Sprint Contract Draft (Round 3)

> **PRD 来源**：`sprints/sprint-prd.md`（Initiative：Brain 时间端点 — 单一 `GET /api/brain/time` 返回 iso/timezone/unix 三字段）
>
> **Round 2 → Round 3 变更（基于 Reviewer Round 2 REVISION 反馈）**：
>
> - **问题 1（major — iso↔timezone 语义立场）**：Round 2 spec 允许 `iso` 以 `Z` 或 `±HH:MM` 后缀呈现，但未规定 `iso` 的偏移是否必须与 `timezone` 字段一致。真实用户场景下会出现歧义（`timezone='Asia/Tokyo'` 配 `iso='...Z'` 算不算合规）。
>   → **Round 3 立场**：`iso` **锁死为 UTC Z 后缀**（`Date.prototype.toISOString()` 产物形如 `2026-04-23T12:34:56.789Z`）。`timezone` 字段独立反映服务器 Intl 解析的 IANA 名字，**与 `iso` 语义解耦** — `iso` 是绝对时刻的标准化表示，`timezone` 是服务器时区元信息。这与 Node 内置 `toISOString()` 行为一致、无需第三方库，且彻底消除"偏移是否应匹配 timezone"的歧义。硬阈值新增：`body.iso.endsWith('Z') === true`，正则收紧为 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$`。
>
> - **问题 2（major — 非 GET 方法 + body 污染）**：Round 2 未规约 POST/PUT/DELETE/PATCH 到 `/api/brain/time` 的行为，且 query 污染断言未扩展到 body 污染。
>   → **Round 3 立场**：端点**只**声明 `router.get('/time')`；其它 HTTP 方法不得触发 handler，因此**一定非 200** 且响应体**不得含** `iso`/`timezone`/`unix` 任一 key。body 污染由此天然免疫（handler 不执行 ⇒ body 中的 `{iso:"evil",...}` 无路径进入响应）。不强绑 `404` vs `405` 具体状态码（实现细节），只要求非 200 + 不泄漏三字段值。BEHAVIOR 新增 `it(12)` 非 GET 非 200 + `it(13)` POST JSON body 不回显；E2E 脚本新增 step 8 四方法轮询 + body 注入校验。
>
> - **问题 3（minor — for-of 实现细节过度规约）**：Round 2 ARTIFACT 绑定 `for (const subRouter of [...])` 具体写法，未来 routes.js 若重构为插件注册模式会假阳性 FAIL。
>   → **Round 3 放宽**：删除"加入 for-of 合并数组"条目，改为行为等价的"`timeRouter` 标识符在 `routes.js` 中出现 ≥ 2 次"（= 至少 1 次 import + 1 次实际使用；任何挂载模式都满足）。保留 `import timeRouter from './routes/time.js'` 条目作为强形式检查。注意：BEHAVIOR `it(1)` 的 HTTP 200 走的是测试内 `makeApp()` mini app，**并不**覆盖真实 `routes.js` 挂接路径，故不能简单删除该 ARTIFACT；放宽但不删除。
>
> **设计原则**：功能小且无副作用（无 DB、无外部调用），GAN 对抗焦点集中在"BEHAVIOR 测试是否能抓出 iso 假格式 / iso 时区歧义 / 假 IANA / 假 fallback / 假白名单 / 假一致性 / 假 query 免疫 / 假非 GET 行为 / 假 body 污染免疫"这九类假实现 + "E2E 脚本断言强度与 BEHAVIOR 等价"。

---

## Feature 1: `GET /api/brain/time` 返回单一聚合 JSON（iso + timezone + unix）

**行为描述**:

对该 URL 发出 GET 请求时，服务以 HTTP 200 返回 Content-Type 为 JSON 的响应体，对象**恰好**含三个字段 `iso`、`timezone`、`unix`，不混入其它字段。

- `iso` 是代表当前服务器时刻的**严格 ISO 8601 UTC instant 字符串**，**必须以 `Z` 结尾**（对应 Node `Date.prototype.toISOString()` 产物，形如 `2026-04-23T12:34:56.789Z`）。**不允许 `±HH:MM` 本地偏移后缀**、`new Date().toString()` 非标准字符串、无后缀 naive 字符串。`iso` 表达的是 UTC 绝对时刻，与 `timezone` 字段**语义解耦**。
- `timezone` 是**有效 IANA 名字字符串**（`new Intl.DateTimeFormat('en-US', { timeZone })` 不得抛 `RangeError`），正常环境下反映 `Intl.DateTimeFormat().resolvedOptions().timeZone` 实际解析值（不得硬编码为 `'UTC'`），仅当 Intl 返回空/undefined 时才回落 `'UTC'`。`timezone` 为服务器本地时区元信息，供客户端日志对齐场景解读（例如"server log 中的 `2026-04-23T12:34Z` 在服务器本地显示为 Asia/Tokyo 的 21:34"）。
- `unix` 是**整数秒**（非毫秒、非字符串、非浮点），即 `Math.floor(Date.now()/1000)`。

端点不依赖 DB、不依赖鉴权、不依赖外部服务。query 参数一律被**忽略**。**非 GET 方法**（POST/PUT/PATCH/DELETE）不触发该 handler，响应状态必为非 200，响应体不得含 `iso`/`timezone`/`unix` 任一 key；POST JSON body `{iso:"evil",unix:1,timezone:"Fake/Zone"}` 不会污染输出（handler 根本不执行）。三个字段取自**同一次** `Date.now()`（同次请求内，`new Date(iso).getTime()` 与 `unix * 1000` 之间差值 ≤ 2000ms）。

**硬阈值**:

- HTTP status = `200`（GET 请求）
- `Content-Type` 头含 `application/json`
- `Object.keys(body).sort()` 严格等于 `['iso', 'timezone', 'unix']`
- `body.iso` 必须匹配正则 `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/` **（Round 3 收紧：Z-only，不接受 ±HH:MM）**
- `body.iso.endsWith('Z')` 为真 **（Round 3 新增）**
- `new Date(body.iso).getTime()` 为有限数且与请求时刻偏差 ≤ 2000ms
- `Number.isInteger(body.unix)` 为真；`body.unix > 0`；`String(body.unix).length <= 10`（秒，不是毫秒）
- `body.timezone` 为非空字符串，且 `new Intl.DateTimeFormat('en-US', { timeZone: body.timezone })` 不抛错
- `Math.abs(new Date(body.iso).getTime() - body.unix * 1000) <= 2000`
- 当 `Intl.DateTimeFormat().resolvedOptions().timeZone` 返回空字符串/undefined 时，`body.timezone === 'UTC'`
- 当 `Intl.DateTimeFormat().resolvedOptions().timeZone` 返回 `'Asia/Tokyo'` 时，`body.timezone === 'Asia/Tokyo'`
- 传 `?iso=evil&unix=1&timezone=Fake%2FZone` 不改变 body 中三字段的类型约束且值仍为"当前服务器时间"
- **POST/PUT/PATCH/DELETE 到 `/api/brain/time`**：响应状态 **≠ 200**，且响应体不得含 `iso`/`timezone`/`unix` 任一 key **（Round 3 新增 — 问题 2）**
- **POST JSON body `{iso:"evil",unix:1,timezone:"Fake/Zone"}` 到 `/api/brain/time`**：响应正文不得回显 `evil` / `Fake/Zone` 字面；若响应为 JSON 对象则不得含三字段 key **（Round 3 新增 — 问题 2）**

**BEHAVIOR 覆盖**（落入 `tests/ws1/time.test.ts`，**Round 3 从 11 → 13 条**）:

1. `it('GET /api/brain/time responds with HTTP 200 and application/json content type')`
2. `it('response body contains exactly the three keys iso, timezone, unix — no others')`
3. `it('iso is a string parseable as a Date within 2 seconds of request time')`
4. `it('iso matches strict ISO 8601 UTC instant format (Z suffix only, no ±HH:MM)')` **（Round 3 收紧）**
5. `it('unix is a positive integer in seconds (at most 10 digits), not milliseconds')`
6. `it('timezone is a non-empty string')`
7. `it('timezone is a valid IANA zone name (accepted by Intl.DateTimeFormat constructor)')`
8. `it('new Date(iso).getTime() and unix * 1000 agree within 2000ms')`
9. `it('ignores query parameters and returns server-side current time (cannot be poisoned by ?iso=evil etc.)')`
10. `it('timezone falls back to "UTC" when Intl.DateTimeFormat resolves timeZone to empty/undefined')`
11. `it('timezone reflects Intl-resolved value (is NOT hardcoded to "UTC")')`
12. `it('non-GET methods (POST/PUT/PATCH/DELETE) on /api/brain/time do NOT return HTTP 200 and do NOT leak iso/timezone/unix')` **（Round 3 新增 — 问题 2）**
13. `it('POST with JSON body containing {iso,unix,timezone} does NOT poison response (handler never executes)')` **（Round 3 新增 — 问题 2）**

**ARTIFACT 覆盖**（落入 `contract-dod-ws1.md`）:

源码类：
- `packages/brain/src/routes/time.js` 文件存在
- `routes/time.js` 定义 `router.get('/time', ...)` 路由
- `routes/time.js` 默认导出 Express Router 实例（`export default router`）
- `routes/time.js` 使用 `Intl.DateTimeFormat` 且含 `'UTC'` fallback 字面量
- `routes/time.js` 使用 `toISOString()` 生成 iso（保证 UTC Z 后缀） **（Round 3 新增 — 问题 1）**
- `routes/time.js` 文件长度 < 60 行
- `routes/time.js` 不 `import` 任何 DB 或外部服务模块
- `packages/brain/src/routes.js` 导入 time router（含 `from './routes/time.js'`）
- `packages/brain/src/routes.js` 中 `timeRouter` 标识符出现 ≥ 2 次（import + 使用，不锁定挂载写法） **（Round 3 放宽 — 问题 3）**

E2E 脚本类：
- `tests/e2e/brain-time.sh` 文件存在且可执行
- 脚本调用 `/api/brain/time` 端点
- 脚本含字段白名单断言（`Object.keys` 等价 + `jq keys | sort`）
- 脚本含 `.unix | type == "number"` 断言
- 脚本含 unix 字符串 `length <= 10` 断言
- 脚本含 `iso↔unix 差值 <= 2000ms` 断言
- 脚本含严格 ISO 8601 **Z-only** 正则断言 **（Round 3 收紧 — 问题 1）**
- 脚本含 query 污染免疫断言（`iso=evil` + `Fake`）
- 脚本含非 GET 方法轮询 + body 注入污染免疫断言（覆盖 POST/PUT/PATCH/DELETE 四方法） **（Round 3 新增 — 问题 2）**

---

## Workstreams

workstream_count: 1

### Workstream 1: `/api/brain/time` 路由模块 + 聚合器挂接 + 真机 E2E 脚本

**范围**:
- 新增 `packages/brain/src/routes/time.js`（约 20 行）：Express Router，定义 `GET /time` 返回 `{ iso, timezone, unix }`，`iso` 使用 `new Date().toISOString()`（UTC Z 后缀），timezone 含 fallback 到 `UTC`
- 修改 `packages/brain/src/routes.js`：新增 `import timeRouter from './routes/time.js'`，在聚合逻辑中**任意挂载方式**（for-of 合并 / `router.use` / 插件注册均可）使 `timeRouter` 被挂到 `/api/brain/*` 可达路径上
- 新增（已 Round 2 交付，Round 3 已就地更新）`tests/e2e/brain-time.sh`：Round 3 把 step 4 的 ISO 正则收紧为 Z-only，新增 step 8（非 GET 方法轮询 + body 注入）
- **不**改 `server.js`、**不**改 DB、**不**新增依赖、**不**动 middleware

**大小**: S（Brain 源码预计 <30 行净新增 + 1 行 import + 1 处聚合挂接；E2E 脚本 ~130 行 bash 已 Proposer 侧交付）

**依赖**: 无（Brain 已有 express + Router 聚合架构；E2E 脚本只依赖 bash + curl + jq，环境已具备）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/time.test.ts`（**Round 3 = 13 条 `it()`**）
**真机 E2E 脚本**: `tests/e2e/brain-time.sh`（Round 3 = 8 个断言步骤）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖（it 描述） | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/time.test.ts` | **13 条**：1) 200+JSON / 2) 恰好三字段 / 3) iso 2s-of-now / 4) **iso 严格 ISO 8601 UTC Z-only** / 5) unix 整数秒 / 6) timezone 非空 / 7) timezone 是有效 IANA / 8) iso↔unix 一致 / 9) query 忽略 / 10) UTC fallback / 11) timezone 非硬编码（反向 Asia/Tokyo mock）/ 12) **非 GET 非 200 不泄漏三字段** / 13) **POST body 不污染** | 模块 `packages/brain/src/routes/time.js` 尚不存在 → vitest import 解析即失败（suite-level 加载错），13 条 it 均未进入 collect（`Tests no tests`）；Generator 按 `contract-dod-ws1.md` 实现后重跑应得 `Tests 13 passed (13)` |
| WS1-E2E | `tests/e2e/brain-time.sh` | **8 步断言**（HTTP 200+JSON / 字段白名单 / unix type number / unix length ≤ 10 / **ISO 8601 Z-only 正则** / iso↔unix 2s / timezone 非空+IANA 有效 / query 免疫 / **非 GET 4 方法 + body 注入免疫**） | 脚本存在且可执行；Generator 实现路由并启动 Brain 后真机跑应 `exit 0` 并打印 `[e2e] PASS — all 8 assertions met`；未实现或实现错误则按 step 编号 exit 1..8 或 10/11 |

---

## GAN 对抗要点（供 Reviewer 聚焦 Round 3 修订是否充分）

**Round 1 + Round 2 遗留的 mutation 族是否已被 Round 3 全部堵上**：

| # | Mutation 族 | Round 1/2 漏洞 | Round 3 堵法 |
|---|---|---|---|
| 1 | **假 iso 格式**：返回 `new Date().toString()` 形如 `"Wed Apr 23 2026 05:00:00 GMT+0800"` | Round 1 `it(3)` 能混过 | Round 2 `it(4)` 正则 + Round 3 Z-only 收紧 |
| 2 | **假 iso 格式**：返回 `"2024-01-01T00:00:00"`（无时区后缀） | Round 1 能混过 | Round 2 `it(4)` 堵 + Round 3 保留 |
| 3 | **假 iso 格式**：返回 `"2026-04-23T12:00:00+08:00"`（本地偏移） | Round 2 `it(4)` **会 pass**（±HH:MM 合规）；但语义歧义 | Round 3 `it(4)` 收紧 Z-only，反向断言拒绝 `+08:00`/`-05:30` |
| 4 | **假 unix（毫秒）**：实现 `unix: Date.now()` → 13 位 | 已被 `it(5)` 抓住 | 保留 + E2E `length <= 10` 双重 |
| 5 | **假 timezone（任意非空字符串）**：`timezone: 'hello'` | Round 1 `it(6)` 能混过 | Round 2 `it(7)` 堵 + Round 3 保留 |
| 6 | **字段白名单破坏**：多加 `offset`/`version` 字段 | 已被 `it(2)` 抓住 | 保留 + E2E 双重 |
| 7 | **iso 与 unix 不同源** | 已被 `it(8)` 抓住 | 保留 + E2E 双重 |
| 8 | **被 query 污染**：`res.json({ iso: req.query.iso \|\| ... })` | 已被 `it(9)` 抓住 | 保留 + E2E step 7 |
| 9 | **timezone 未 fallback** | 已被 `it(10)` 抓住 | 保留 |
| 10 | **timezone 永远硬编码 UTC**：`timezone: 'UTC'`（不调 Intl） | Round 1 能混过 | Round 2 `it(11)` 反向 mock Asia/Tokyo 堵 + Round 3 保留 |
| 11 | **只挂在单独路径而非聚合器** | Round 2 `for-of 合并数组` ARTIFACT 抓住但过度规约 | Round 3 放宽为 `timeRouter` 标识符 ≥ 2 次（兼容任何挂载模式） |
| 12 | **SC-003 E2E 弱断言假阳性** | Round 1 无脚本 | Round 2 脚本 + Round 3 step 4 Z-only 收紧 + step 8 新增 |
| 13 | **非 GET 方法触发 handler**：`router.all('/time', ...)` | Round 1/2 spec 未规约 | Round 3 `it(12)` + E2E step 8 堵：非 GET 必须非 200 且不泄漏三字段 key |
| 14 | **POST body 污染**：`res.json({ iso: req.body.iso \|\| ..., ... })` 挂在 `router.all/post` 上 | Round 1/2 未覆盖 | Round 3 `it(13)` + E2E step 8 body 注入校验 |
| 15 | **iso 误用 timezone 偏移**：实现 `iso: formatInTimeZone(now, tz)` 产出带 `+09:00` 偏移 | Round 2 正则会 pass（`Z or ±HH:MM`） | Round 3 Z-only 正则拒绝；`body.iso.endsWith('Z')` 硬阈值 |

## PRD 追溯性

| PRD 条目 | 覆盖位置 |
|---|---|
| FR-001（GET /api/brain/time，无鉴权无 DB） | WS1 route 实现 + ARTIFACT "不 import DB/LLM" |
| FR-002（响应体只含 iso/timezone/unix） | BEHAVIOR `it(2)` 字段白名单 + E2E step 1 |
| FR-003（iso=严格 ISO 8601） | BEHAVIOR `it(3)(4)` + E2E step 4（Round 3 = UTC Z-only） |
| FR-003（unix=整数秒） | BEHAVIOR `it(5)` + E2E step 2+3 |
| FR-003（timezone=非空且有效 IANA） | BEHAVIOR `it(6)(7)` + E2E step 6 |
| FR-004（挂接到现有聚合器） | ARTIFACT "routes.js 含 timeRouter 标识符 ≥ 2 次" |
| SC-001（≥3 条单测） | 本合同含 **13 条** it() |
| SC-002（Supertest HTTP 集成） | `tests/ws1/time.test.ts` 全程使用 supertest |
| SC-003（真机 curl + jq） | `tests/e2e/brain-time.sh` 8 步断言强等价 BEHAVIOR `it(2)(4)(5)(7)(8)(9)(12)(13)` |
| SC-004（brain-ci 全绿） | 由 CI 保证；合同测试位于 `sprints/tests/` 不进 brain-ci include |
| 边界: timezone Intl 回落 UTC | BEHAVIOR `it(10)` |
| 边界: timezone 非硬编码 | BEHAVIOR `it(11)` |
| 边界: 忽略客户端输入（query） | BEHAVIOR `it(9)` + E2E step 7 |
| 边界: 忽略客户端输入（非 GET + body） | BEHAVIOR `it(12)(13)` + E2E step 8 **（Round 3 新增）** |
