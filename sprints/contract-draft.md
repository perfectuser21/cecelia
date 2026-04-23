# Sprint Contract Draft (Round 4)

> **PRD 来源**：`sprints/sprint-prd.md`（Initiative：Brain 时间端点 — 单一 `GET /api/brain/time` 返回 iso/timezone/unix 三字段）
>
> **Round 3 → Round 4 变更（基于 Reviewer Round 3 REVISION 反馈）**：
>
> - **问题 1（major — `timeRouter` 标识符检查被「赋值/注释」假实现绕过；`it(1)` 不走真实 routes.js 无法兜底）**
>   → **Round 4 立场**：
>   1. **收紧 ARTIFACT（替代老版「标识符 ≥ 2 次」软检查）**：`timeRouter` 在 `packages/brain/src/routes.js` 中**必须作为函数调用实参（`router.use('/<path>', timeRouter)`）或作为数组字面量成员（`[..., timeRouter, ...]`）**出现；只出现在 `import` 语句 + 注释 / 字符串 / 类型标注里的实现一律视为未挂接。对应新正则 `(?:router\.use\s*\([^)]*,\s*timeRouter\s*\)|\[[^\]]*\btimeRouter\b[^\]]*\])`。
>   2. **考虑但放弃「直接 import 真实 routes.js aggregate 做 supertest」路线（Reviewer 推荐 a）**：仓库现有 `packages/brain/src/routes.js` 的所有子路由（status/tasks/tick…）**在 import 时级联触发 `db.js`/`websocket.js` 等副作用**（PG Pool 初始化、WS server 启动、`process.env` 读取），在沙箱 Harness 环境跑 vitest 会阻塞或污染 CI，不适合做合同测试。改用**纯静态挂接形态校验（ARTIFACT 收紧）**作为兜底。
>   3. 保留 `import timeRouter from './routes/time.js'` 的独立 ARTIFACT 不变；老版「标识符出现 ≥ 2 次」退役（被新 mount-expression 正则严格覆盖）。
>
> - **问题 2（major — `it(11)` 反向 mock 抓不到「模块顶层缓存 Intl 解析」实现）**
>   → **Round 4 立场**：
>   1. **新增 ARTIFACT：`Intl.DateTimeFormat` 调用必须出现在 `router.get('/time', ...)` 的回调体内部**。机械化检查方式：`routes/time.js` 文件内容按**首次出现的 `router.get(` 位置**切片，切片前缀（模块顶层 + 任何辅助 util）**不得**包含 `Intl.DateTimeFormat`；切片后缀必须**至少出现一次** `Intl.DateTimeFormat`。此条对 Generator 的模块顶层缓存写法（`const CACHED_TZ = Intl.DateTimeFormat()...` 挂在模块顶层）直接 exit 1。
>   2. 保留 `it(10)(11)` 不变（正向 + 反向 mock 双向打击）——即便 Generator 假装配合 ARTIFACT 但运行时行为错误，BEHAVIOR 仍会抓住。
>   3. 理由：选择 ARTIFACT 路线（Reviewer 推荐 a）而非「改 it(11) 为正向 probe」，因为 mock 派生问题的根源就是模块顶层缓存 — 禁止模块顶层调用才是根治，行为 probe 只能碰运气（依赖容器时区恰好不是 `Asia/Tokyo`）。
>
> - **问题 3（moderate — `it(12)/(13)` 非 GET + body 注入「不泄漏」断言语义未机械化）**
>   → **Round 4 立场**：
>   1. **`it(12)` 状态码从「`!==200`」收紧为「`status ∈ {404, 405}`」硬枚举白名单**。理由：Express 默认未匹配路由返回 404；若未来启用 `methodNotAllowed` 中间件则返回 405；这两者之外的任何值（如 500/200/302）均表示 Generator 写了自定义 non-GET handler 或路由配置异常，必须失败。body key 不泄漏断言保留不变。
>   2. **`it(13)` 追加 `response.text` 字面量反向断言**：直接对 `res.text`（原始响应正文，未经 JSON 解析）`expect(res.text).not.toContain('evil')` + `.not.toContain('Fake/Zone')`，与已有的 `body` 结构化断言叠加，形成 **raw string + parsed object 双重免疫墙**。
>   3. E2E 脚本 step 8 同步收紧：非 GET 状态码必须在 `{404, 405}` 内，否则 `exit 8`。
>
> **设计原则**：功能小且无副作用（无 DB、无外部调用），GAN 对抗焦点集中在"BEHAVIOR 测试是否能抓出 iso 假格式 / iso 时区歧义 / 假 IANA / 假 fallback / 假白名单 / 假一致性 / 假 query 免疫 / 假非 GET 行为 / 假 body 污染免疫 / **假 mount（仅 import 不挂接）** / **模块顶层缓存 Intl**"这十一类假实现 + "E2E 脚本断言强度与 BEHAVIOR 等价"。

---

## Feature 1: `GET /api/brain/time` 返回单一聚合 JSON（iso + timezone + unix）

**行为描述**:

对该 URL 发出 GET 请求时，服务以 HTTP 200 返回 Content-Type 为 JSON 的响应体，对象**恰好**含三个字段 `iso`、`timezone`、`unix`，不混入其它字段。

- `iso` 是代表当前服务器时刻的**严格 ISO 8601 UTC instant 字符串**，**必须以 `Z` 结尾**（对应 Node `Date.prototype.toISOString()` 产物，形如 `2026-04-23T12:34:56.789Z`）。**不允许 `±HH:MM` 本地偏移后缀**、`new Date().toString()` 非标准字符串、无后缀 naive 字符串。`iso` 表达的是 UTC 绝对时刻，与 `timezone` 字段**语义解耦**。
- `timezone` 是**有效 IANA 名字字符串**（`new Intl.DateTimeFormat('en-US', { timeZone })` 不得抛 `RangeError`），正常环境下反映 `Intl.DateTimeFormat().resolvedOptions().timeZone` 实际解析值（不得硬编码为 `'UTC'`），仅当 Intl 返回空/undefined 时才回落 `'UTC'`。`timezone` 为服务器本地时区元信息。**`Intl.DateTimeFormat` 的调用必须发生在每次 GET /time 请求的 handler 执行时刻**（即不可在模块加载时缓存）。
- `unix` 是**整数秒**（非毫秒、非字符串、非浮点），即 `Math.floor(Date.now()/1000)`。

端点不依赖 DB、不依赖鉴权、不依赖外部服务。query 参数一律被**忽略**。**非 GET 方法**（POST/PUT/PATCH/DELETE）不触发该 handler，响应状态必为 `404` 或 `405`（二选一的硬枚举），响应体不得含 `iso`/`timezone`/`unix` 任一 key；POST JSON body `{iso:"evil",unix:1,timezone:"Fake/Zone"}` 不会污染输出（handler 根本不执行，**且原始响应正文 `res.text` 不得含 `evil` 或 `Fake/Zone` 字面量**）。三个字段取自**同一次** `Date.now()`（同次请求内，`new Date(iso).getTime()` 与 `unix * 1000` 之间差值 ≤ 2000ms）。

**硬阈值**:

- HTTP status = `200`（GET 请求）
- `Content-Type` 头含 `application/json`
- `Object.keys(body).sort()` 严格等于 `['iso', 'timezone', 'unix']`
- `body.iso` 必须匹配正则 `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/`
- `body.iso.endsWith('Z')` 为真
- `new Date(body.iso).getTime()` 为有限数且与请求时刻偏差 ≤ 2000ms
- `Number.isInteger(body.unix)` 为真；`body.unix > 0`；`String(body.unix).length <= 10`（秒，不是毫秒）
- `body.timezone` 为非空字符串，且 `new Intl.DateTimeFormat('en-US', { timeZone: body.timezone })` 不抛错
- `Math.abs(new Date(body.iso).getTime() - body.unix * 1000) <= 2000`
- 当 `Intl.DateTimeFormat().resolvedOptions().timeZone` 返回空字符串/undefined 时，`body.timezone === 'UTC'`
- 当 `Intl.DateTimeFormat().resolvedOptions().timeZone` 返回 `'Asia/Tokyo'` 时，`body.timezone === 'Asia/Tokyo'`
- 传 `?iso=evil&unix=1&timezone=Fake%2FZone` 不改变 body 中三字段的类型约束且值仍为"当前服务器时间"
- **POST/PUT/PATCH/DELETE 到 `/api/brain/time`**：响应状态必须 `∈ {404, 405}`（硬枚举），且响应体不得含 `iso`/`timezone`/`unix` 任一 key **（Round 4 收紧 — 问题 3）**
- **POST JSON body `{iso:"evil",unix:1,timezone:"Fake/Zone"}` 到 `/api/brain/time`**：`res.text` 原始正文不得出现 `evil` / `Fake/Zone` 字面；若响应为 JSON 对象则不得含三字段 key **（Round 4 追加 raw-text 断言 — 问题 3）**

**BEHAVIOR 覆盖**（落入 `tests/ws1/time.test.ts`，**Round 4 = 13 条 `it()`**，与 Round 3 同数但 `it(12)(13)` 语义收紧）:

1. `it('GET /api/brain/time responds with HTTP 200 and application/json content type')`
2. `it('response body contains exactly the three keys iso, timezone, unix — no others')`
3. `it('iso is a string parseable as a Date within 2 seconds of request time')`
4. `it('iso matches strict ISO 8601 UTC instant format (Z suffix only, no ±HH:MM)')`
5. `it('unix is a positive integer in seconds (at most 10 digits), not milliseconds')`
6. `it('timezone is a non-empty string')`
7. `it('timezone is a valid IANA zone name (accepted by Intl.DateTimeFormat constructor)')`
8. `it('new Date(iso).getTime() and unix * 1000 agree within 2000ms')`
9. `it('ignores query parameters and returns server-side current time (cannot be poisoned by ?iso=evil etc.)')`
10. `it('timezone falls back to "UTC" when Intl.DateTimeFormat resolves timeZone to empty/undefined')`
11. `it('timezone reflects Intl-resolved value (is NOT hardcoded to "UTC")')`
12. `it('non-GET methods (POST/PUT/PATCH/DELETE) on /api/brain/time respond with status in {404,405} and do NOT leak iso/timezone/unix keys')` **（Round 4 收紧 — 问题 3：状态码改为硬枚举）**
13. `it('POST with JSON body containing {iso,unix,timezone} does NOT poison response — raw res.text must not contain "evil" or "Fake/Zone" literals')` **（Round 4 追加 raw-text 断言 — 问题 3）**

**ARTIFACT 覆盖**（落入 `contract-dod-ws1.md`）:

源码类：
- `packages/brain/src/routes/time.js` 文件存在
- `routes/time.js` 定义 `router.get('/time', ...)` 路由
- `routes/time.js` 默认导出 Express Router 实例（`export default router`）
- `routes/time.js` 使用 `Intl.DateTimeFormat` 且含 `'UTC'` fallback 字面量
- `routes/time.js` 使用 `toISOString()` 生成 iso（保证 UTC Z 后缀）
- `routes/time.js` **`Intl.DateTimeFormat` 调用必须发生在 `router.get` 回调体内部（首次 `router.get(` 之前的切片不得含 `Intl.DateTimeFormat`）** **（Round 4 新增 — 问题 2）**
- `routes/time.js` 文件长度 < 60 行
- `routes/time.js` 不 `import` 任何 DB 或外部服务模块
- `packages/brain/src/routes.js` 导入 time router（含 `from './routes/time.js'`）
- `packages/brain/src/routes.js` 中 `timeRouter` **必须作为 `router.use('/<path>', timeRouter)` 实参或出现在数组字面量 `[..., timeRouter, ...]` 成员中**（两种挂载模式任一满足即可） **（Round 4 收紧 — 问题 1，替代原「标识符 ≥ 2 次」）**

E2E 脚本类：
- `tests/e2e/brain-time.sh` 文件存在且可执行
- 脚本调用 `/api/brain/time` 端点
- 脚本含字段白名单断言（`Object.keys` 等价 + `jq keys | sort`）
- 脚本含 `.unix | type == "number"` 断言
- 脚本含 unix 字符串 `length <= 10` 断言
- 脚本含 `iso↔unix 差值 <= 2000ms` 断言
- 脚本含严格 ISO 8601 **Z-only** 正则断言
- 脚本含 query 污染免疫断言（`iso=evil` + `Fake`）
- 脚本含非 GET 方法轮询（POST/PUT/PATCH/DELETE 四方法）+ body 注入污染免疫断言，**且非 GET 响应状态必须 `∈ {404, 405}` 硬枚举** **（Round 4 收紧 — 问题 3）**

---

## Workstreams

workstream_count: 1

### Workstream 1: `/api/brain/time` 路由模块 + 聚合器挂接 + 真机 E2E 脚本

**范围**:
- 新增 `packages/brain/src/routes/time.js`（约 20 行）：Express Router，定义 `GET /time` 返回 `{ iso, timezone, unix }`，`iso` 使用 `new Date().toISOString()`（UTC Z 后缀），**`Intl.DateTimeFormat` 调用在 handler 回调体内**（不可缓存在模块顶层）
- 修改 `packages/brain/src/routes.js`：新增 `import timeRouter from './routes/time.js'`，并**以 `router.use('/<path>', timeRouter)` 或数组字面量成员形式**真实挂接（不能只 import 不用）
- 更新 `tests/e2e/brain-time.sh`：Round 4 step 8 状态码从「非 200」收紧为「`∈ {404, 405}`」
- **不**改 `server.js`、**不**改 DB、**不**新增依赖、**不**动 middleware

**大小**: S（Brain 源码预计 <30 行净新增 + 1 行 import + 1 处聚合挂接；E2E 脚本 ~135 行 bash 已 Proposer 侧交付）

**依赖**: 无（Brain 已有 express + Router 聚合架构；E2E 脚本只依赖 bash + curl + jq，环境已具备）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/time.test.ts`（**Round 4 = 13 条 `it()`**）
**真机 E2E 脚本**: `tests/e2e/brain-time.sh`（Round 4 = 8 个断言步骤，step 8 状态码收紧）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖（it 描述） | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/time.test.ts` | **13 条**：1) 200+JSON / 2) 恰好三字段 / 3) iso 2s-of-now / 4) iso 严格 ISO 8601 UTC Z-only / 5) unix 整数秒 / 6) timezone 非空 / 7) timezone 是有效 IANA / 8) iso↔unix 一致 / 9) query 忽略 / 10) UTC fallback / 11) timezone 非硬编码（反向 Asia/Tokyo mock）/ 12) **非 GET 状态 ∈ {404,405} 且不泄漏三字段 key** / 13) **POST body 不污染 + res.text 原文不含 evil/Fake/Zone 字面** | 模块 `packages/brain/src/routes/time.js` 尚不存在 → vitest import 解析即失败（suite-level 加载错），13 条 it 均未进入 collect（`Tests no tests`）；Generator 按 `contract-dod-ws1.md` 实现后重跑应得 `Tests 13 passed (13)` |
| WS1-E2E | `tests/e2e/brain-time.sh` | **8 步断言**（HTTP 200+JSON / 字段白名单 / unix type number / unix length ≤ 10 / ISO 8601 Z-only 正则 / iso↔unix 2s / timezone 非空+IANA 有效 / query 免疫 / **非 GET 4 方法状态 ∈ {404,405} + body 注入免疫**） | 脚本存在且可执行；Generator 实现路由并启动 Brain 后真机跑应 `exit 0` 并打印 `[e2e] PASS — all 8 assertions met`；未实现或实现错误则按 step 编号 exit 1..8 或 10/11 |

---

## GAN 对抗要点（供 Reviewer 聚焦 Round 4 修订是否充分）

**Round 1/2/3 遗留的 mutation 族是否已被 Round 4 全部堵上**：

| # | Mutation 族 | 旧轮漏洞 | Round 4 堵法 |
|---|---|---|---|
| 1 | **假 iso 格式**：返回 `new Date().toString()` | Round 1 `it(3)` 能混过 | Round 2 `it(4)` 正则 + Round 3 Z-only 收紧 |
| 2 | **假 iso 格式**：返回 `"2024-01-01T00:00:00"` 无后缀 | Round 1 能混过 | Round 2 `it(4)` 堵 + 保留 |
| 3 | **假 iso 格式**：返回本地偏移 `+08:00` | Round 2 `it(4)` **会 pass**（±HH:MM 合规） | Round 3 `it(4)` 收紧 Z-only + 保留 |
| 4 | **假 unix（毫秒）**：`unix: Date.now()` → 13 位 | 已被 `it(5)` 抓住 | 保留 + E2E 双重 |
| 5 | **假 timezone（任意非空字符串）**：`'hello'` | Round 1 `it(6)` 能混过 | Round 2 `it(7)` 堵 + 保留 |
| 6 | **字段白名单破坏**：多加 `offset`/`version` | 已被 `it(2)` 抓住 | 保留 + E2E 双重 |
| 7 | **iso 与 unix 不同源** | 已被 `it(8)` 抓住 | 保留 + E2E 双重 |
| 8 | **被 query 污染**：`res.json({ iso: req.query.iso ?? ... })` | 已被 `it(9)` 抓住 | 保留 + E2E step 7 |
| 9 | **timezone 未 fallback** | 已被 `it(10)` 抓住 | 保留 |
| 10 | **timezone 永远硬编码 UTC** | Round 1 能混过 | Round 2 `it(11)` 反向 mock + 保留 |
| 11 | **只挂在单独路径而非聚合器** | Round 2 for-of 数组 ARTIFACT 过度规约；Round 3 放宽后「`timeRouter` ≥ 2 次」可被「import + 注释里再提一次」绕过 | **Round 4 mount-expression 正则**：必须是 `router.use(…, timeRouter)` 实参 OR 数组字面量成员；仅 import + 注释不通过 |
| 12 | **SC-003 E2E 弱断言假阳性** | Round 1 无脚本 | Round 2 脚本 + Round 3 step 4 Z-only + step 8 / Round 4 step 8 状态码硬枚举 |
| 13 | **非 GET 方法触发 handler**（`router.all`） | Round 1/2 未规约 | Round 3 `it(12)` + E2E step 8 堵 / Round 4 收紧为 `status ∈ {404,405}` |
| 14 | **POST body 污染**：`res.json({ iso: req.body.iso ?? ... })` 挂在 `router.all/post` | Round 1/2 未覆盖 | Round 3 `it(13)` + E2E step 8 body 注入 / Round 4 追加 `res.text` 字面量反向断言 |
| 15 | **iso 误用 timezone 偏移**：产出带 `+09:00` 偏移 | Round 2 正则会 pass | Round 3 Z-only 正则 + 保留 |
| 16 | **模块顶层缓存 Intl 解析**：`const CACHED_TZ = Intl.DateTimeFormat()...; handler → timezone: CACHED_TZ` | Round 2/3 `it(11)` 反向 mock 后 Intl 已缓存，mock 不生效 — 若容器时区恰好不是 Asia/Tokyo 能抓，但依赖环境 | **Round 4 ARTIFACT 切片检查**：首次 `router.get(` 之前不得出现 `Intl.DateTimeFormat`（模块顶层禁区），彻底根治 |
| 17 | **仅 import 不挂接的假实现**（`import timeRouter from ...; // done`） | Round 3 「标识符 ≥ 2 次」可被注释补齐 | **Round 4 mount-expression 正则**：必须作为函数调用实参 OR 数组成员，不计 import/注释 |

## PRD 追溯性

| PRD 条目 | 覆盖位置 |
|---|---|
| FR-001（GET /api/brain/time，无鉴权无 DB） | WS1 route 实现 + ARTIFACT "不 import DB/LLM" |
| FR-002（响应体只含 iso/timezone/unix） | BEHAVIOR `it(2)` 字段白名单 + E2E step 1 |
| FR-003（iso=严格 ISO 8601） | BEHAVIOR `it(3)(4)` + E2E step 4 |
| FR-003（unix=整数秒） | BEHAVIOR `it(5)` + E2E step 2+3 |
| FR-003（timezone=非空且有效 IANA） | BEHAVIOR `it(6)(7)` + E2E step 6 |
| FR-004（挂接到现有聚合器） | ARTIFACT "routes.js 含 timeRouter **mount-expression 正则**" **（Round 4 强化）** |
| SC-001（≥3 条单测） | 本合同含 **13 条** it() |
| SC-002（Supertest HTTP 集成） | `tests/ws1/time.test.ts` 全程使用 supertest |
| SC-003（真机 curl + jq） | `tests/e2e/brain-time.sh` 8 步断言强等价 BEHAVIOR `it(2)(4)(5)(7)(8)(9)(12)(13)` |
| SC-004（brain-ci 全绿） | 由 CI 保证；合同测试位于 `sprints/tests/` 不进 brain-ci include |
| 边界: timezone Intl 回落 UTC | BEHAVIOR `it(10)` |
| 边界: timezone 非硬编码 | BEHAVIOR `it(11)` **+ ARTIFACT 「Intl 必须在 handler 回调体内」（Round 4 新增）** |
| 边界: 忽略客户端输入（query） | BEHAVIOR `it(9)` + E2E step 7 |
| 边界: 忽略客户端输入（非 GET + body） | BEHAVIOR `it(12)(13)` + E2E step 8 **（Round 4 状态码硬枚举 + res.text 字面量断言）** |
