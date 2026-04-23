# Sprint Contract Draft (Round 5)

> **PRD 来源**：`sprints/sprint-prd.md`（Initiative：Brain 时间端点 — 单一 `GET /api/brain/time` 返回 iso/timezone/unix 三字段）
>
> **Round 4 → Round 5 变更（基于 Reviewer Round 4 REVISION 反馈 — 推荐「放弃硬 ARTIFACT 兜底，改行为路线」）**：
>
> **Reviewer Round 4 的 3 个 Risk**：
> - Risk 1（major）：Round 4 的 `timeRouter` mount-expression 正则把多种合法挂接形式误杀（数组字面量跨多行 / 尾逗号 / 具名变量），同时可被「注释补齐 + 字符串拼接 + 变量别名」等假实现绕过——静态正则在此合同里已被反复证明是猫鼠游戏
> - Risk 2（major）：Round 4 的 `Intl.DateTimeFormat` 切片位置 ARTIFACT 仅做字面量匹配，`const I = Intl` 别名即可绕过；模块顶层缓存的假实现仍能存活
> - Risk 3（moderate）：E2E step 8 硬枚举 `{404, 405}` 未相对化到 Brain 真实 NotFound 行为——若全局 middleware（auth / rate-limit / 自定义 404 handler）把未命中路径改成 401/403/500 等，合法实现也会让 E2E exit 8
>
> **Round 5 对策（按 Reviewer 推荐路线执行）**：
>
> 1. **Risk 1 → 放弃硬 ARTIFACT，合同测试里 spawn/mount 真机行为验证**：
>    - **删除** Round 4 的 mount-expression 正则 ARTIFACT
>    - **新增** `sprints/tests/ws1/routes-aggregator.test.ts` 两条 `it()`：动态 import 真实 `packages/brain/src/routes.js`（用 vi.mock 屏蔽所有非 time 的子路由副作用），从 `/api/brain` 前缀发 supertest 请求。第一条断言 `GET /api/brain/time` 返回 200 + 三字段合规——只要通过即证明 timeRouter 已被真实聚合挂接到某个能解析 `/time` 的位置。第二条反向兜底：一条明显不存在的聚合器路径必须返回非 200，防 `app.all('*')` 骗过。
>    - 保留 `import timeRouter from './routes/time.js'` 的单条 ARTIFACT 作为「必要条件」（证明 Generator 至少 import 了模块）；充分性由行为测试独占承担。
>
> 2. **Risk 2 → 改行为路线 — `it(11)` 重写为动态 import + 双 mock 切换 + 不重载模块**：
>    - **删除** Round 4 的 `Intl.DateTimeFormat` 切片位置 ARTIFACT
>    - **重写** `time.test.ts` 的 `it(11)` 为「模块顶层缓存反向 probe」：`vi.resetModules()` → mock Intl → mock 成 'Asia/Tokyo' → 动态 import `routes/time.js`（触发模块顶层代码在 mock 下执行）→ 发请求 A 拿到 `Asia/Tokyo` → **不重载模块**切换 mock 成 `America/New_York` → 发请求 B 必须拿到 `America/New_York`
>    - 若实现在模块顶层缓存（任何形式，包括 `const I = Intl; const CACHED = I.DateTimeFormat()...`），请求 B 仍返回首次缓存的 `Asia/Tokyo`，测试 fail——对别名、字符串拼接、alias-assign 等绕过方式全部免疫（spy 拦的是 `Intl.DateTimeFormat` 属性访问，别名 `I` 指向同一对象，该属性仍走到 spy）
>
> 3. **Risk 3 → E2E step 8 状态码相对化到 Brain 真实 NotFound 行为**：
>    - **新增** `tests/e2e/brain-time.sh` 的 step 7.5：对一条肯定不存在的路径 `/api/brain/__definitely_not_a_route_xyz__` 依次用 POST/PUT/PATCH/DELETE 各打一发，记录每个 METHOD 的 baseline 状态码
>    - **step 8 相对化**：非 GET 对 `/api/brain/time` 的期望状态码 == 同 METHOD 的 baseline，不再硬编码 `{404, 405}`——这对 Brain 任何全局 404/405/auth 布局免疫，但仍能抓「GET /time 正确、POST /time 也返回 200」这类 mutation（baseline 路径不可能 200）
>    - **sanity 兜底**：若 baseline 本身就是 200（Brain 全部路径都 200 的极端假实现）或 000（curl 打不通），直接 `exit 75`，让整条 step 8 失去意义时即时暴露
>
> **设计原则演进**（Round 1 → Round 5）：
> - Round 1-3：以 BEHAVIOR 测试硬断言为主，ARTIFACT 为辅
> - Round 4：遇到「Generator 能通过测试但实现方式绕过静态正则」的问题，曾尝试收紧 ARTIFACT
> - **Round 5**：Reviewer 明确诊断「ARTIFACT 静态正则在本合同里已被反复证明是猫鼠游戏」，**一次性切到行为层**——凡是「正则匹配代码文本」的兜底，全部改为「动态 import + mock + supertest」的行为 probe。这是 Round 5 的核心哲学转向。

---

## Feature 1: `GET /api/brain/time` 返回单一聚合 JSON（iso + timezone + unix）

**行为描述**:

对该 URL 发出 GET 请求时，服务以 HTTP 200 返回 Content-Type 为 JSON 的响应体，对象**恰好**含三个字段 `iso`、`timezone`、`unix`，不混入其它字段。

- `iso` 是代表当前服务器时刻的**严格 ISO 8601 UTC instant 字符串**，**必须以 `Z` 结尾**（对应 Node `Date.prototype.toISOString()` 产物，形如 `2026-04-23T12:34:56.789Z`）。**不允许 `±HH:MM` 本地偏移后缀**、`new Date().toString()` 非标准字符串、无后缀 naive 字符串。`iso` 表达的是 UTC 绝对时刻，与 `timezone` 字段**语义解耦**。
- `timezone` 是**有效 IANA 名字字符串**（`new Intl.DateTimeFormat('en-US', { timeZone })` 不得抛 `RangeError`），正常环境下反映 `Intl.DateTimeFormat().resolvedOptions().timeZone` 实际解析值（不得硬编码为 `'UTC'`），仅当 Intl 返回空/undefined 时才回落 `'UTC'`。`timezone` 为服务器本地时区元信息。**`Intl.DateTimeFormat` 的调用必须发生在每次 GET /time 请求的 handler 执行时刻**（即不可在模块加载时缓存；Round 5 by 动态 import + 双 mock 切换行为 probe 验证，不再由 ARTIFACT 切片正则验证）。
- `unix` 是**整数秒**（非毫秒、非字符串、非浮点），即 `Math.floor(Date.now()/1000)`。

端点不依赖 DB、不依赖鉴权、不依赖外部服务。query 参数一律被**忽略**。**非 GET 方法**（POST/PUT/PATCH/DELETE）不触发该 handler，合同 BEHAVIOR it(12) 在 supertest 挂接 timeRouter 的场景下断言状态 ∈ `{404, 405}`；真机 E2E（step 8）则**相对化到 Brain 真实 NotFound baseline** 状态码（Round 5 — Risk 3）。POST JSON body `{iso:"evil",unix:1,timezone:"Fake/Zone"}` 不会污染输出（handler 根本不执行，**且原始响应正文 `res.text` 不得含 `evil` 或 `Fake/Zone` 字面量**）。三个字段取自**同一次** `Date.now()`（同次请求内，`new Date(iso).getTime()` 与 `unix * 1000` 之间差值 ≤ 2000ms）。

**聚合挂接行为判据**（Round 5 新增 — Risk 1）：
从 `packages/brain/src/routes.js` 导出的 aggregator 默认 export 被 `app.use('/api/brain', aggregator)` 挂接后，`GET /api/brain/time` 必须返回合规三字段 body；同时 `GET /api/brain/__nope__` 不得返回 200（防 `app.all('*')` 骗过）。

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
- **Round 5 替换原「Intl 切片 ARTIFACT」**：先 mock Intl → `Asia/Tokyo` 动态 import → GET 拿到 `Asia/Tokyo`；**不重载**，切换 mock → `America/New_York`；GET 必须拿到 `America/New_York`（若顶层缓存则仍返回 `Asia/Tokyo`，测试 fail）
- **Round 5 替换原「mount-expression 正则 ARTIFACT」**：从真实 `routes.js` 聚合器挂接后，`GET /api/brain/time` 返回 200 + 三字段合规；`GET /api/brain/__nope__` 非 200
- 传 `?iso=evil&unix=1&timezone=Fake%2FZone` 不改变 body 中三字段的类型约束且值仍为"当前服务器时间"
- **POST/PUT/PATCH/DELETE 到 `/api/brain/time`**：supertest 场景（BEHAVIOR it(12)）状态 ∈ `{404, 405}`；E2E 真机场景（step 8）状态 == baseline（同 METHOD 对 `/api/brain/__definitely_not_a_route_xyz__` 的回应码）
- **POST JSON body `{iso:"evil",unix:1,timezone:"Fake/Zone"}` 到 `/api/brain/time`**：`res.text` 原始正文不得出现 `evil` / `Fake/Zone` 字面；若响应为 JSON 对象则不得含三字段 key

**BEHAVIOR 覆盖**（Round 5 = **13 + 2 = 15 条 `it()`**；`time.test.ts` 13 条 + `routes-aggregator.test.ts` 2 条）:

#### `time.test.ts`（与 Round 4 同 13 条；`it(11)` 在 Round 5 **重写为动态 import + 双 mock 切换**以抓模块顶层缓存）

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
11. **`it('timezone re-resolves per request — NOT cached at module top level (mutation: const CACHED_TZ = Intl.DateTimeFormat()...)')`（Round 5 重写 — Risk 2：动态 import + 双 mock 切换 + 不重载模块抓顶层缓存）**
12. `it('non-GET methods (POST/PUT/PATCH/DELETE) on /api/brain/time respond with status in {404,405} and do NOT leak iso/timezone/unix keys')`
13. `it('POST with JSON body containing {iso,unix,timezone} does NOT poison response — raw res.text must not contain "evil" or "Fake/Zone" literals')`

#### `routes-aggregator.test.ts`（Round 5 新增 2 条 — Risk 1：聚合挂接行为判据）

14. `it('GET /api/brain/time via the REAL routes.js aggregator returns 200 with exact {iso, timezone, unix} body')`
15. `it('non-existent aggregator path /api/brain/__nope__ returns non-2xx — proving the aggregator is not a catch-all')`

**ARTIFACT 覆盖**（Round 5 瘦身版，移交行为判据给 BEHAVIOR；详见 `contract-dod-ws1.md`）:

源码类（保留的必要性约束）：
- `packages/brain/src/routes/time.js` 文件存在
- `routes/time.js` 定义 `router.get('/time', ...)` 路由
- `routes/time.js` 默认导出 Express Router 实例
- `routes/time.js` 不 import 任何 DB 或外部服务模块
- `routes/time.js` 不 import 任何 LLM SDK
- `routes/time.js` 使用 `toISOString()` 生成 iso（保证 UTC Z 后缀）
- `routes/time.js` 文件长度 < 60 行
- `packages/brain/src/routes.js` 含 `import timeRouter from './routes/time.js'`（必要条件；充分性由 BEHAVIOR 14/15 承担）
- **已删除**（Round 5）：mount-expression 正则 ARTIFACT — 移交行为测试
- **已删除**（Round 5）：`Intl.DateTimeFormat` 切片位置 ARTIFACT — 移交 it(11) 行为重写
- **已删除**（Round 5）：`Intl.DateTimeFormat` + `'UTC'` 字面量 ARTIFACT — 移交 it(10) 行为测试（mock Intl 返回空 → timezone 必须 fallback 为 `'UTC'`，即便实现用别名/字符串拼接也会被 it(10) 抓住）

E2E 脚本类：
- `tests/e2e/brain-time.sh` 文件存在且可执行
- 脚本调用 `/api/brain/time` 端点
- 脚本含字段白名单断言（`Object.keys` 等价 + `jq keys | sort`）
- 脚本含 `.unix | type == "number"` 断言
- 脚本含 unix 字符串 `length <= 10` 断言
- 脚本含 `iso↔unix 差值 <= 2000ms` 断言
- 脚本含严格 ISO 8601 **Z-only** 正则断言
- 脚本含 query 污染免疫断言（`iso=evil` + `Fake`）
- 脚本含非 GET 方法轮询（POST/PUT/PATCH/DELETE 四方法）+ body 注入污染免疫断言
- **脚本含 sanity baseline 步骤（step 7.5）** — Round 5 新增，Risk 3
- **脚本非 GET 状态码相对化到 baseline** — Round 5 新增，Risk 3

---

## Workstreams

workstream_count: 1

### Workstream 1: `/api/brain/time` 路由模块 + 聚合器挂接 + 真机 E2E 脚本

**范围**:
- 新增 `packages/brain/src/routes/time.js`（约 20 行）：Express Router，定义 `GET /time` 返回 `{ iso, timezone, unix }`，`iso` 使用 `new Date().toISOString()`（UTC Z 后缀），**`Intl.DateTimeFormat` 调用在 handler 回调体内**（不可缓存在模块顶层；Round 5 由 it(11) 行为 probe 验证）
- 修改 `packages/brain/src/routes.js`：新增 `import timeRouter from './routes/time.js'`，并**真实聚合挂接**（具体语法形式不限 — 行为判据由 Round 5 新增的 `routes-aggregator.test.ts` 承担）
- 更新 `tests/e2e/brain-time.sh`：Round 5 step 7.5 新增 sanity baseline，step 8 状态码相对化到 baseline
- **不**改 `server.js`、**不**改 DB、**不**新增依赖、**不**动 middleware

**大小**: S（Brain 源码预计 <30 行净新增 + 1 行 import + 1 处聚合挂接；E2E 脚本 ~160 行 bash 已 Proposer 侧交付）

**依赖**: 无（Brain 已有 express + Router 聚合架构；E2E 脚本只依赖 bash + curl + jq，环境已具备）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/time.test.ts`（**Round 5 = 13 条 `it()`**）+ `sprints/tests/ws1/routes-aggregator.test.ts`（**Round 5 新增 = 2 条 `it()`**）

**真机 E2E 脚本**: `tests/e2e/brain-time.sh`（Round 5 = 9 个断言步骤，step 7.5 新增 + step 8 相对化）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖（it 描述） | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/time.test.ts` | **13 条**：1) 200+JSON / 2) 恰好三字段 / 3) iso 2s-of-now / 4) iso 严格 ISO 8601 UTC Z-only / 5) unix 整数秒 / 6) timezone 非空 / 7) timezone 是有效 IANA / 8) iso↔unix 一致 / 9) query 忽略 / 10) UTC fallback / 11) **timezone 每次请求重新解析（动态 import + 双 mock 切换抓顶层缓存）** / 12) 非 GET 状态 ∈ {404,405} 且不泄漏三字段 key / 13) POST body 不污染 + res.text 原文不含 evil/Fake/Zone 字面 | 模块 `packages/brain/src/routes/time.js` 尚不存在 → vitest import 解析即失败（suite-level 加载错），13 条 it 均未进入 collect（`Tests no tests`）；Generator 按 `contract-dod-ws1.md` 实现后重跑应得 `Tests 13 passed (13)` |
| WS1 | `sprints/tests/ws1/routes-aggregator.test.ts` | **2 条**：14) 真实 `routes.js` 聚合器挂接后 `GET /api/brain/time` 返回 200 + 三字段合规 / 15) `GET /api/brain/__nope__` 非 200（反 catch-all） | `routes/time.js` 尚不存在时，`routes.js` 虽然可动态 import（已 mock 其它子路由 + db/websocket），但 `import timeRouter from './routes/time.js'` 仍会解析失败 → suite 加载错误，2 条 it 均 fail；Generator 实现后重跑应得 `Tests 2 passed (2)` |
| WS1-E2E | `tests/e2e/brain-time.sh` | **9 步断言**（HTTP 200+JSON / 字段白名单 / unix type number / unix length ≤ 10 / ISO 8601 Z-only 正则 / iso↔unix 2s / timezone 非空+IANA 有效 / query 免疫 / **Round 5 step 7.5 sanity baseline** / **Round 5 step 8 非 GET 状态码 == baseline + body 注入免疫**） | 脚本存在且可执行；Generator 实现路由并启动 Brain 后真机跑应 `exit 0` 并打印 `[e2e] PASS — all 8 assertions met`；未实现或实现错误则按 step 编号 exit 1..8 或 10/11/75 |

---

## GAN 对抗要点（供 Reviewer 聚焦 Round 5 修订是否充分）

**Round 1/2/3/4 遗留的 mutation 族是否已被 Round 5 全部堵上**：

| # | Mutation 族 | 旧轮漏洞 | Round 5 堵法 |
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
| 11 | **只挂在单独路径而非聚合器** | Round 2 for-of 数组 ARTIFACT 过度规约；Round 3 放宽后「`timeRouter` ≥ 2 次」可被注释绕过；Round 4 mount-expression 正则误杀合法 + 被别名/拼接绕过 | **Round 5 行为路线**：`routes-aggregator.test.ts` it(14)(15) 动态 import 真实 `routes.js` 发 supertest 验证 `/api/brain/time` 真实可达（**正向**）+ `/__nope__` 非 200（**反向 anti-catch-all**） |
| 12 | **SC-003 E2E 弱断言假阳性** | Round 1 无脚本 | Round 2 脚本 + Round 3 step 4 Z-only + step 8 / Round 4 step 8 状态码硬枚举 / **Round 5 step 8 相对化到 baseline + step 7.5 sanity 兜底** |
| 13 | **非 GET 方法触发 handler**（`router.all`） | Round 1/2 未规约 | Round 3 `it(12)` + E2E step 8 堵 / Round 4 收紧为 `status ∈ {404,405}` / **Round 5 E2E 相对化到 baseline**（supertest it(12) 保留硬枚举，因为 supertest 挂接无全局 middleware） |
| 14 | **POST body 污染**：`res.json({ iso: req.body.iso ?? ... })` 挂在 `router.all/post` | Round 1/2 未覆盖 | Round 3 `it(13)` + E2E step 8 body 注入 / Round 4 追加 `res.text` 字面量反向断言 / **Round 5 E2E 状态码相对化** |
| 15 | **iso 误用 timezone 偏移**：产出带 `+09:00` 偏移 | Round 2 正则会 pass | Round 3 Z-only 正则 + 保留 |
| 16 | **模块顶层缓存 Intl 解析**：`const CACHED_TZ = Intl.DateTimeFormat()...; handler → timezone: CACHED_TZ` | Round 2/3 `it(11)` 反向 mock 后 Intl 已缓存，mock 不生效 / Round 4 ARTIFACT 切片正则被 `const I = Intl` 别名绕过 | **Round 5 行为路线**：`it(11)` 改写为 `vi.resetModules()` → mock Intl → 动态 import → 拿到 Asia/Tokyo → **不重载**切换 mock 成 New_York → 必须拿到 New_York，否则说明缓存在顶层执行（**对别名/字符串/alias-assign 免疫**——spy 拦的是 `Intl.DateTimeFormat` 属性访问，别名 `I` 同指 Intl 对象，属性访问仍走 spy） |
| 17 | **仅 import 不挂接的假实现**（`import timeRouter from ...; // done`） | Round 3 「标识符 ≥ 2 次」可被注释补齐；Round 4 mount-expression 正则被字符串绕过 | **Round 5 行为路线** — 与 #11 同 |
| 18 | **Brain 全局 middleware 把未命中路径改成 500/401 等**，让合法实现的 POST /time 状态码不属于 `{404, 405}` 被误判（Round 4 漏） | Round 4 硬枚举会误杀 | **Round 5 step 8 状态码相对化**：以 `__definitely_not_a_route_xyz__` 的同 METHOD 响应为 baseline，端点 POST/PUT/PATCH/DELETE 状态码必须 == baseline（若 baseline 本身为 200 或 000 则 step 7.5 先行 fail） |
| 19 | **`app.all('*')` 骗过 routes-aggregator it(14) 的正向断言**（全部路径返回 200 的假实现） | Round 5 it(14) 单独存在时会被骗 | **Round 5 新增 it(15) 反向 anti-catch-all**：`/api/brain/__nope__` 必须非 200 |

## PRD 追溯性

| PRD 条目 | 覆盖位置 |
|---|---|
| FR-001（GET /api/brain/time，无鉴权无 DB） | WS1 route 实现 + ARTIFACT "不 import DB/LLM" |
| FR-002（响应体只含 iso/timezone/unix） | BEHAVIOR `it(2)` 字段白名单 + E2E step 1 + it(14) 聚合行为 |
| FR-003（iso=严格 ISO 8601） | BEHAVIOR `it(3)(4)` + E2E step 4 |
| FR-003（unix=整数秒） | BEHAVIOR `it(5)` + E2E step 2+3 |
| FR-003（timezone=非空且有效 IANA） | BEHAVIOR `it(6)(7)` + E2E step 6 |
| FR-004（挂接到现有聚合器） | **Round 5 — `routes-aggregator.test.ts` it(14)(15) 行为 probe**（替代 Round 4 mount-expression 正则） |
| SC-001（≥3 条单测） | 本合同含 **15 条** it() |
| SC-002（Supertest HTTP 集成） | `tests/ws1/time.test.ts` + `tests/ws1/routes-aggregator.test.ts` 全程使用 supertest |
| SC-003（真机 curl + jq） | `tests/e2e/brain-time.sh` 9 步断言强等价 BEHAVIOR 核心 it() |
| SC-004（brain-ci 全绿） | 由 CI 保证；合同测试位于 `sprints/tests/` 不进 brain-ci include |
| 边界: timezone Intl 回落 UTC | BEHAVIOR `it(10)` |
| 边界: timezone 非硬编码 / 非顶层缓存 | BEHAVIOR `it(11)` **（Round 5 重写为动态 import + 双 mock 切换）** |
| 边界: 忽略客户端输入（query） | BEHAVIOR `it(9)` + E2E step 7 |
| 边界: 忽略客户端输入（非 GET + body） | BEHAVIOR `it(12)(13)` + E2E step 7.5+8 **（Round 5 相对化到 baseline）** |
