# Sprint Contract Draft (Round 8)

> **PRD 来源**：`sprints/sprint-prd.md`（Initiative：Brain 时间端点 — 单一 `GET /api/brain/time` 返回 iso/timezone/unix 三字段）
>
> **Round 7 → Round 8 变更（基于 Reviewer Round 7 REVISION 反馈）**：
>
> **Reviewer Round 7 的关切**（不构成 spec 本体漏洞，聚焦**测试 collect 机制的可观测性**）：
> - **(a)** Proposer 必须在 Test Contract 的"预期红证据"列显式加上一条：`npx vitest list sprints/tests/ws1/time-intl-caching.test.ts` 能 collect 到该文件且其中 `it()` 计数 == 1（脚本形式可用 `vitest list` 输出 grep "Tests 1" 判定）。**动机**：Round 7 把 Intl caching probe 拆到独立测试文件后，若该文件因某种原因（include 列表未覆盖、路径不匹配、扩展名被 glob 漏掉）没被 vitest collect 到，Reviewer 会看到"0 passed"假绿而非真正的 FAIL —— 这是 spec 之外的验证 pipeline 风险，必须显式落到合同里以供 Reviewer 核验。
> - **(b)** 同步要求 Generator（在 Workstream 1 范围内明文规约）：若项目 vitest.config（`packages/brain/vitest.config.js` 或仓库根/被用于执行 sprints 合同测试的 config）使用**字面量 include 列表**，且该 include 列表不能匹配 `sprints/tests/ws1/time-intl-caching.test.ts`，Generator 必须将该路径或等价 glob 登记进 include。**动机**：Harness v6 evaluator 直接 `npx vitest run sprints/tests/ws1/time-intl-caching.test.ts` 时，vitest 对显式传入文件的处理因版本/config 略有差异；防御性登记消除不确定性。
> - **(c)** 在 Test Contract 的"预期红证据"列显式加一条：在 `sprints/tests/ws1/time-intl-caching.test.ts` 文件尚不存在（或假设"未交付"）的前提下，`npx vitest run sprints/tests/ws1/time-intl-caching.test.ts` **必须** fail 于 "No test files found"；若输出 "No tests run" 或 "0 passed" 都说明 collect 机制本身没生效（区别于"文件存在、it() 也能 collect、但断言 fail"的真 red 状态）。
>
> **Reviewer Round 7 的其它观察（不构成 Risk，Round 8 保留现状）**：
> - 原则规则 `400 ≤ code < 600` 处理 Reviewer Round 6 Risk 1/2 合理 — 3xx（重定向）/ 2xx 非 200（204/202）在 `/api/brain/time` 场景均属不合理返回，排除逻辑无漏洞。
> - `routes-aggregator.test.ts` it(14)/it(15) 反 catch-all 断言保留 — Round 5 开的口子封得稳。
>
> **Round 8 对策（一次性解决 (a)+(b)+(c)）**：
>
> 1. **新增 "## Test Collect Sanity" 章节**：列出两条显式可执行命令 + 预期输出：
>    - **预期红（文件尚未交付的状态）**：`npx vitest run sprints/tests/ws1/time-intl-caching.test.ts` → 退出非 0，stdout/stderr 含子串 `No test files found`（不接受 "No tests run" 或 "0 passed"，这两种输出反而证明 collect 机制出错）
>    - **预期就绪（Round 7 已交付文件后的状态）**：`npx vitest list sprints/tests/ws1/time-intl-caching.test.ts` 2>&1 → 输出含子串 `Tests 1`（即 1 条 it() 被 collect）；或等价替代：`npx vitest run sprints/tests/ws1/time-intl-caching.test.ts` 输出含 `Test Files  1` + `Tests  1`（可以是 failed 也可以是 passed，关键是"1"）
> 2. **Test Contract 表第二行（`time-intl-caching.test.ts`）的"预期红证据"列扩写**：明确区分"文件缺失红"（`No test files found`，exit != 0）与"文件存在但实现模块缺失红"（`ERR_MODULE_NOT_FOUND`/`Failed to load url`，exit != 0，`Tests 1 failed (1)`）—— 两种红状态必须明文分开，避免 Reviewer 把"0 tests" 当成"一切正常"。
> 3. **Workstream 1 范围描述里明文写入 include 登记规约**：Generator 在实现开始时必须执行一次 `npx vitest run sprints/tests/ws1/time-intl-caching.test.ts`，看到 "No test files found" 之外的 collect 成功输出（如 `Tests 1 failed (1)`）方可继续；否则必须排查并修正 vitest.config 的 include 列表，让该文件被 collect。
> 4. **新增 ARTIFACT 条目到 `contract-dod-ws1.md`**：
>    - 条件性 ARTIFACT：若任意 vitest.config（brain/quality/engine/dashboard/api 或新建根 config）使用字面量 include 列表且该 config 会被用来运行合同测试，必须覆盖 `sprints/tests/ws1/time-intl-caching.test.ts`；
>    - 无条件 ARTIFACT：`sprints/tests/ws1/time-intl-caching.test.ts` 文件存在且含恰好 1 个 `it(` 顶层调用（与 `vitest list` 预期输出 "Tests 1" 强同构）。
>
> **it 计数稳定**：Round 8 不改动测试文件数量/结构。`time.test.ts` 12 条 + `time-intl-caching.test.ts` 1 条 + `routes-aggregator.test.ts` 2 条 = **15 条 `it()`**（与 Round 6/7 一致）。Round 8 完全不触达 .test.ts 文件内容，**只改合同文本 + DoD 清单 + 新增 Test Collect Sanity 章节** —— 证据：合同里新增的 ARTIFACT 用 `grep -c` 直接数 `sprints/tests/ws1/time-intl-caching.test.ts` 的 `^\s*it(` 命中次数来保证 "恰好 1 条" 的硬约束。
>
> ---
>
> **Round 6 → Round 7 变更（基于 Reviewer Round 6 REVISION 反馈）**：
>
> **Reviewer Round 6 的 3 个 Risk**：
> - **Risk 1（major）**：Round 6 E2E step 8 非 GET 状态码**相对化到 8 码枚举集合** `ACCEPTABLE_NOT_FOUND_STATUS = {401,403,404,405,415,422,429,500}`。Reviewer 指出**集合本身是枚举而非规则**——合法 Brain 实现若引入枚举外的状态码（410 Gone / 426 Upgrade Required / 451 Unavailable For Legal Reasons / 502 Bad Gateway / 503 Service Unavailable / 504 Gateway Timeout 等），step 8 会误杀；同时 step 7.5 的 baseline 校验与 step 8 的目标校验**共用同一集合**，覆盖面对称风险被放大——任何新增合法错误码必须两处同步维护。
> - **Risk 2（major）**：step 7.5 baseline 覆盖面与 step 8 不对称。Round 6 由于枚举写死，baseline 合法状态空间与 step 8 合法状态空间"应当同一"的约束需要枚举维护，任何一侧漏改就有误杀/漏判。
> - **Risk 3（major）**：Round 6 把 `it(11)`（模块顶层 Intl 缓存 mutation probe）抽到 `time.test.ts` **同文件**独立 describe 块 + `afterAll(vi.restoreAllMocks)` 兜底。Reviewer 指出该隔离方案"依赖未明文约束的假设"：afterAll 若自身抛错、describe 块执行顺序被后续修改打乱，或 vitest 池配置变更（threads ↔ forks），都可能让 Intl spy 污染同文件其它 describe 块。推荐路线 (b)：把 `it(11)` 搬到**独立测试文件**，利用 vitest 默认 file-per-worker 的进程/线程级隔离做为主防线。
>
> **Reviewer Round 6 的 minor 建议**：
> - E2E step 8 body key 检查当前"grep 命中才跑 jq"——可被 JSON 格式变体（空白/编码/键顺序）漏检。补无条件 jq 判定很便宜，应当补。
> - HEAD/OPTIONS 方法未测：Express 默认对 GET 路由自动响应 HEAD，风险小，可以不补。（Round 7 **不补**，遵循 Reviewer 判定。）
>
> **Round 7 对策（按 Reviewer 推荐路线一次性解决 Risk 1+2+3 + 吸收 minor）**：
>
> 1. **Risk 1 & Risk 2 → E2E 状态码改原则规则（放弃枚举）**：
>    - 在 `tests/e2e/brain-time.sh` 用 bash 函数 `is_http_error_status(code)` 替代 `ACCEPTABLE_NOT_FOUND_STATUS` 字符串枚举，规则为 **`400 ≤ code < 600`**（任何 HTTP 4xx 或 5xx）
>      - 200 自动排除（< 400）—— 任何"handler 被错误执行并返回 200"的 mutation 都被拒
>      - 000（curl 不通/超时）自动排除（非数字）
>      - 1xx/3xx（信息/重定向）自动排除（< 400）
>      - 6xx+ 非标准扩展排除（≥ 600）
>    - **step 7.5 与 step 8 共用同一函数**（覆盖面天然对称；Reviewer Round 6 Risk 2 由此闭合）
>    - 未来 Brain 新增鉴权返回 401/403、新增限流返回 429、故障返回 503/504 —— 脚本**零改动**自动接纳
>    - 真正的 mutation「POST /time 也返回 200」仍被抓住（200 < 400 → 规则拒绝）
>
> 2. **Risk 3 → `it(11)` 搬到独立测试文件 `time-intl-caching.test.ts`**：
>    - 新建 `sprints/tests/ws1/time-intl-caching.test.ts`，专门承载"模块顶层 Intl 缓存 mutation probe"
>    - `time.test.ts` 主 describe 块减为 12 条 it()（移除了原同文件独立 describe 块的 1 条）
>    - vitest 默认每个 test file 跑在独立 worker 里（threads 池 = 独立 thread，forks 池 = 独立 child process），`Intl.DateTimeFormat` 的 spy + ESM module cache 在 OS/VM 层级都不可能跨文件泄漏
>    - 新文件内保留 `afterAll(vi.restoreAllMocks)` 作为保险（非主防线）
>    - 主 describe 块内的 `it(7)`「timezone 是有效 IANA 名」不再可能受到该 probe 的 spy 溢出影响
>
> 3. **Minor → E2E step 8 body key 检查无条件 jq 判定**：
>    - Round 6 该检查 gated on `grep -Eq '"(iso|unix|timezone)"[[:space:]]*:'` 命中，若 mutation 用非常规 JSON 编码则漏检
>    - Round 7 改为先 `jq -e . "$FILE" >/dev/null 2>&1` 判定 body 是否可解析为 JSON，若是则直接 `jq -e 'has("iso") or has("unix") or has("timezone")'` 硬判；不可解析 JSON（如 HTML 错误页）仍走字面量 not-contain 的兜底
>
> **it 计数稳定**：Round 7 `time.test.ts` **12 条 it()** + `time-intl-caching.test.ts` **1 条 it()** + `routes-aggregator.test.ts` **2 条 it()** = **15 条**，与 Round 6 总数一致（只是 it(11) 从同文件独立 describe 搬到独立文件；物理位置更换，数量不变）。
>
> **设计原则演进**（Round 1 → Round 7）：
> - Round 1-3：以 BEHAVIOR 测试硬断言为主，ARTIFACT 为辅
> - Round 4：遇到「Generator 能通过测试但实现方式绕过静态正则」的问题，曾尝试收紧 ARTIFACT
> - Round 5：Reviewer 明确诊断「ARTIFACT 静态正则在本合同里已被反复证明是猫鼠游戏」，一次性切到行为层——凡是「正则匹配代码文本」的兜底，全部改为「动态 import + mock + supertest」的行为 probe
> - Round 6：行为路线的「过严等式」回调成「合理集合」——E2E step 8 不再用 `== baseline` 硬等式，改用 8 码枚举集合
> - **Round 7**：集合升级为**原则规则**（`400 ≤ code < 600`）—— 合法未命中/错误状态空间开放式全覆盖，放弃枚举维护成本，step 7.5 与 step 8 共用同一函数，覆盖面天然对称；同时把 Intl caching mutation probe 搬到独立测试文件，改"同文件 afterAll 兜底"为"file-per-worker OS 级隔离"。

---

## Feature 1: `GET /api/brain/time` 返回单一聚合 JSON（iso + timezone + unix）

**行为描述**:

对该 URL 发出 GET 请求时，服务以 HTTP 200 返回 Content-Type 为 JSON 的响应体，对象**恰好**含三个字段 `iso`、`timezone`、`unix`，不混入其它字段。

- `iso` 是代表当前服务器时刻的**严格 ISO 8601 UTC instant 字符串**，**必须以 `Z` 结尾**（对应 Node `Date.prototype.toISOString()` 产物，形如 `2026-04-23T12:34:56.789Z`）。**不允许 `±HH:MM` 本地偏移后缀**、`new Date().toString()` 非标准字符串、无后缀 naive 字符串。`iso` 表达的是 UTC 绝对时刻，与 `timezone` 字段**语义解耦**。
- `timezone` 是**有效 IANA 名字字符串**（`new Intl.DateTimeFormat('en-US', { timeZone })` 不得抛 `RangeError`），正常环境下反映 `Intl.DateTimeFormat().resolvedOptions().timeZone` 实际解析值（不得硬编码为 `'UTC'`），仅当 Intl 返回空/undefined 时才回落 `'UTC'`。`timezone` 为服务器本地时区元信息。**`Intl.DateTimeFormat` 的调用必须发生在每次 GET /time 请求的 handler 执行时刻**（即不可在模块加载时缓存；Round 5 起由动态 import + 双 mock 切换行为 probe 验证；Round 7 该 probe 搬到**独立测试文件**，文件级 worker 隔离为主防线）。
- `unix` 是**整数秒**（非毫秒、非字符串、非浮点），即 `Math.floor(Date.now()/1000)`。

端点不依赖 DB、不依赖鉴权、不依赖外部服务。query 参数一律被**忽略**。**非 GET 方法**（POST/PUT/PATCH/DELETE）不触发该 handler，合同 BEHAVIOR it(11)（原 it(12)）在 supertest 挂接 timeRouter 的场景下断言状态 ∈ `{404, 405}`；真机 E2E（step 8）则**用原则规则 `is_http_error_status` 判定**（Round 7 — 放弃 Round 6 的 8 码枚举，改 `400 ≤ code < 600` 原则规则；200 天然被排除）。POST JSON body `{iso:"evil",unix:1,timezone:"Fake/Zone"}` 不会污染输出（handler 根本不执行，**且原始响应正文 `res.text` 不得含 `evil` 或 `Fake/Zone` 字面量**）。三个字段取自**同一次** `Date.now()`（同次请求内，`new Date(iso).getTime()` 与 `unix * 1000` 之间差值 ≤ 2000ms）。

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
- **Round 5 替换原「Intl 切片 ARTIFACT」**：先 mock Intl → `Asia/Tokyo` 动态 import → GET 拿到 `Asia/Tokyo`；**不重载**，切换 mock → `America/New_York`；GET 必须拿到 `America/New_York`（若顶层缓存则仍返回 `Asia/Tokyo`，测试 fail）。**Round 7：该 probe 搬到独立文件 `time-intl-caching.test.ts`，file-per-worker 进程/线程级隔离为主防线**。
- **Round 5 替换原「mount-expression 正则 ARTIFACT」**：从真实 `routes.js` 聚合器挂接后，`GET /api/brain/time` 返回 200 + 三字段合规；`GET /api/brain/__nope__` 非 200
- 传 `?iso=evil&unix=1&timezone=Fake%2FZone` 不改变 body 中三字段的类型约束且值仍为"当前服务器时间"
- **POST/PUT/PATCH/DELETE 到 `/api/brain/time`**：supertest 场景（BEHAVIOR it(11)）状态 ∈ `{404, 405}`；E2E 真机场景（step 8）**状态满足 `is_http_error_status`（`400 ≤ code < 600`）**（Round 7 — 放弃 Round 6 的 8 码枚举，改原则规则；Reviewer Round 6 Risk 1/2；step 7.5 baseline 用同一规则，覆盖面天然对称）
- **POST JSON body `{iso:"evil",unix:1,timezone:"Fake/Zone"}` 到 `/api/brain/time`**：`res.text` 原始正文不得出现 `evil` / `Fake/Zone` 字面；若响应可解析为 JSON 对象则**无条件**断言不含 `iso`/`unix`/`timezone` 任一 key（Round 7 — Reviewer Round 6 minor，解耦 grep 预筛选）

**BEHAVIOR 覆盖**（Round 7 = **12 + 1 + 2 = 15 条 `it()`**；`time.test.ts` 12 条 + `time-intl-caching.test.ts` 1 条 + `routes-aggregator.test.ts` 2 条）:

#### `time.test.ts`（Round 7 = 12 条 — 主 describe 全部 12 条，原独立 describe 块的 Intl caching probe 已移出到独立文件）

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
11. `it('non-GET methods (POST/PUT/PATCH/DELETE) on /api/brain/time respond with status in {404,405} and do NOT leak iso/timezone/unix keys')`
12. `it('POST with JSON body containing {iso,unix,timezone} does NOT poison response — raw res.text must not contain "evil" or "Fake/Zone" literals')`

#### `time-intl-caching.test.ts`（Round 7 新增独立文件 — Reviewer Round 6 Risk 3）

13. **`it('timezone re-resolves per request — NOT cached at module top level (mutation: const CACHED_TZ = Intl.DateTimeFormat()...)')`（Round 5 行为重写 — 动态 import + 双 mock 切换；Round 6 曾在 `time.test.ts` 同文件独立 describe + afterAll；Round 7 —— Risk 3：搬到独立测试文件，vitest file-per-worker 的 OS/VM 级隔离做主防线，afterAll 仅作保险）**

#### `routes-aggregator.test.ts`（Round 5 新增 2 条 — Risk 1：聚合挂接行为判据）

14. `it('GET /api/brain/time via the REAL routes.js aggregator returns 200 with exact {iso, timezone, unix} body')`
15. `it('non-existent aggregator path /api/brain/__nope__ returns non-2xx — proving the aggregator is not a catch-all')`

**ARTIFACT 覆盖**（Round 5 起瘦身版，行为判据为主；详见 `contract-dod-ws1.md`）:

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
- **已删除**（Round 5）：`Intl.DateTimeFormat` 切片位置 ARTIFACT — 移交行为 probe
- **已删除**（Round 5）：`Intl.DateTimeFormat` + `'UTC'` 字面量 ARTIFACT — 移交 it(10) 行为测试

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
- 脚本含 sanity baseline 步骤（step 7.5） — Round 5 引入
- **脚本定义原则性规则函数 `is_http_error_status`**（`400 ≤ code < 600`）— Round 7 — Reviewer Round 6 Risk 1/2（替代 Round 6 的 8 码枚举）
- **脚本 step 7.5 与 step 8 共用同一原则规则函数**（覆盖面对称 — Reviewer Round 6 Risk 2）
- **脚本 step 8 非 GET 状态码用原则规则判定**（自动排除 200）— Round 7 — Reviewer Round 6 Risk 1
- **脚本 step 8 body key 检查无条件 jq 判定**（解耦 grep 预筛选）— Round 7 — Reviewer Round 6 minor

---

## Workstreams

workstream_count: 1

### Workstream 1: `/api/brain/time` 路由模块 + 聚合器挂接 + 真机 E2E 脚本

**范围**:
- 新增 `packages/brain/src/routes/time.js`（约 20 行）：Express Router，定义 `GET /time` 返回 `{ iso, timezone, unix }`，`iso` 使用 `new Date().toISOString()`（UTC Z 后缀），**`Intl.DateTimeFormat` 调用在 handler 回调体内**（不可缓存在模块顶层；Round 5 起由行为 probe 验证；Round 7 把该 probe 搬到独立测试文件，文件级 worker 隔离为主防线）
- 修改 `packages/brain/src/routes.js`：新增 `import timeRouter from './routes/time.js'`，并**真实聚合挂接**（具体语法形式不限 — 行为判据由 Round 5 新增的 `routes-aggregator.test.ts` 承担）
- 更新 `tests/e2e/brain-time.sh`：Round 7 把 step 7.5/step 8 的状态码判定从 8 码枚举升级为原则规则 `is_http_error_status`（`400 ≤ code < 600`，两处共用）；step 8 body key 检查无条件 jq 判定
- **Round 8 新增（Reviewer Round 7 (b)）— vitest collect 登记硬纪律**：Generator 在实现 `routes/time.js` 前必须从仓库根执行一次 `npx vitest run sprints/tests/ws1/time-intl-caching.test.ts`（或等价 `/workspace/node_modules/.bin/vitest run sprints/tests/ws1/time-intl-caching.test.ts`）作为 **collect pre-flight**：若输出含 `No test files found` → 说明 vitest config 把该文件 filter 掉了，必须检查 `packages/brain/vitest.config.js` / `packages/quality/vitest.config.ts` / `packages/engine/vitest.config.ts` / 仓库根（如存在）的字面量 `include` 数组，**显式追加** 能覆盖该路径的 glob（推荐 `sprints/tests/ws1/**/*.{test,spec}.{ts,tsx,js,mjs,cjs}` 或直接 `sprints/tests/ws1/time-intl-caching.test.ts`），并重跑 collect pre-flight 直到看到 `Test Files  1 failed (1)` + `Tests  1 failed (1)` 的红姿态（目标模块 `routes/time.js` 此时尚未实现，红是预期）；**禁止**在看到 `0 tests run` / `0 passed` / `No test files found` 的状态下继续写 Green 实现——那是 collect 机制失效，绿了也不代表 it(13) 真跑过。Round 8 之所以把这条做成"范围内动作"而非"可选建议"，是为了闭合 Reviewer Round 7 的 (a)(b)(c) 三连关切一次到位。
- **不**改 `server.js`、**不**改 DB、**不**新增依赖、**不**动 middleware

**大小**: S（Brain 源码预计 <30 行净新增 + 1 行 import + 1 处聚合挂接；E2E 脚本 ~180 行 bash 已 Proposer 侧交付）

**依赖**: 无（Brain 已有 express + Router 聚合架构；E2E 脚本只依赖 bash + curl + jq，环境已具备）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/time.test.ts`（**Round 7 = 12 条 `it()`**）+ `sprints/tests/ws1/time-intl-caching.test.ts`（**Round 7 新增独立文件 = 1 条 `it()`**）+ `sprints/tests/ws1/routes-aggregator.test.ts`（**Round 5 引入 = 2 条 `it()`**）

**真机 E2E 脚本**: `tests/e2e/brain-time.sh`（Round 7 = 9 个断言步骤，step 7.5/step 8 共用 `is_http_error_status` 原则规则）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖（it 描述） | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/time.test.ts` | **12 条**：1) 200+JSON / 2) 恰好三字段 / 3) iso 2s-of-now / 4) iso 严格 ISO 8601 UTC Z-only / 5) unix 整数秒 / 6) timezone 非空 / 7) timezone 是有效 IANA / 8) iso↔unix 一致 / 9) query 忽略 / 10) UTC fallback / 11) 非 GET 状态 ∈ {404,405} 且不泄漏三字段 key / 12) POST body 不污染 + res.text 原文不含 evil/Fake/Zone 字面 | 模块 `packages/brain/src/routes/time.js` 尚不存在 → vitest import 解析即失败（suite-level 加载错），12 条 it 均未进入 collect（`Tests no tests`）；Generator 按 `contract-dod-ws1.md` 实现后重跑应得 `Tests 12 passed (12)` |
| WS1 | `sprints/tests/ws1/time-intl-caching.test.ts` | **1 条**（Round 7 新增独立文件 — Reviewer Round 6 Risk 3）：13) **timezone 每次请求重新解析（动态 import + 双 mock 切换；文件级 worker 隔离抓顶层缓存）** | **两段红姿态必须严格区分（Round 8 — Reviewer Round 7 (a)+(c)）**：<br/>**① Collect-miss 假红**（禁止出现）：若 `npx vitest run sprints/tests/ws1/time-intl-caching.test.ts` 输出 `No test files found` / `0 tests run` / `Tests 0 (0)` → vitest config include 列表把该文件过滤掉了，collect 机制失效，**不构成合法红证据** — Generator 必须修正 config 并重跑；<br/>**② 模块缺失真红**（期望出现）：Round 7 文件已交付，目标模块 `routes/time.js` 尚未实现时，`Test Files  1 failed (1)` + `Tests  1 failed (1)`，报错信息含 `Failed to load url ../../../packages/brain/src/routes/time.js` 或 `ERR_MODULE_NOT_FOUND` — 这才是 TDD Red 的正确形态；<br/>**③ 就绪 collect 指纹**：`npx vitest list sprints/tests/ws1/time-intl-caching.test.ts` 2>&1 输出含 `Tests  1` 或等价单测 id 行（证明恰好 1 条 it() 被 collect，spy/mock helper 等没被误 collect 成独立 it()）；<br/>**④ Green 期望**：Generator 按 `contract-dod-ws1.md` 实现 `routes/time.js`（不在模块顶层缓存 `Intl.DateTimeFormat`）后重跑，应得 `Test Files  1 passed (1)` + `Tests  1 passed (1)` |
| WS1 | `sprints/tests/ws1/routes-aggregator.test.ts` | **2 条**：14) 真实 `routes.js` 聚合器挂接后 `GET /api/brain/time` 返回 200 + 三字段合规 / 15) `GET /api/brain/__nope__` 非 200（反 catch-all） | `routes/time.js` 尚不存在时，`routes.js` 虽然可动态 import（已 mock 其它子路由 + db/websocket），但 `import timeRouter from './routes/time.js'` 仍会解析失败 → suite 加载错误，2 条 it 均 fail；Generator 实现后重跑应得 `Tests 2 passed (2)` |
| WS1-E2E | `tests/e2e/brain-time.sh` | **9 步断言**（HTTP 200+JSON / 字段白名单 / unix type number / unix length ≤ 10 / ISO 8601 Z-only 正则 / iso↔unix 2s / timezone 非空+IANA 有效 / query 免疫 / **Round 7 step 7.5 baseline ∈ is_http_error_status** / **Round 7 step 8 非 GET 状态码 ∈ is_http_error_status（原则规则 `400 ≤ code < 600`） + body 注入免疫（jq 无条件判定）**） | 脚本存在且可执行；Generator 实现路由并启动 Brain 后真机跑应 `exit 0` 并打印 `[e2e] PASS — all 8 assertions met`；未实现或实现错误则按 step 编号 exit 1..8 或 10/11/75 |

---

## Test Collect Sanity（Round 8 新增 — Reviewer Round 7 (a)(b)(c)）

本章节独立于 Test Contract 表，单独列出 collect 层面的可观测契约，使 Reviewer 在不跑具体 it() 断言的情况下就能判定"合同测试是否真正被 vitest 看到"。覆盖 Reviewer Round 7 的 (a)(b)(c) 三点关切一次到位。

**命令 1（就绪指纹 — Round 7 文件已交付 after；对应 Reviewer (a)）**:

```bash
# 从仓库根运行；预期：退出 0 或非 0 均可，关键是 stdout+stderr 含 "Tests  1"（1 条 it() 被 collect）
npx vitest list sprints/tests/ws1/time-intl-caching.test.ts 2>&1 | tee /tmp/ws1-intl-list.log
# 验证断言：
grep -Eq "Tests[[:space:]]+1" /tmp/ws1-intl-list.log || echo "FAIL: collect 机制异常（未 collect 到预期的 1 条 it()）"
# 也可用 vitest run 等价替代（更稳定，本轮已本地实测）：
npx vitest run sprints/tests/ws1/time-intl-caching.test.ts --no-coverage 2>&1 | tee /tmp/ws1-intl-run.log
grep -Eq "(Test Files[[:space:]]+1[[:space:]]+failed|Tests[[:space:]]+1[[:space:]]+failed)" /tmp/ws1-intl-run.log \
  && grep -Eq "(Failed to load url|ERR_MODULE_NOT_FOUND|routes/time\.js)" /tmp/ws1-intl-run.log \
  || echo "FAIL: Round 7 红姿态与预期不符（要么 collect 到 0 条 — config 问题，要么 Generator 抢跑实现了模块 — 不该出现）"
```

**命令 2（假设文件不存在 — Reviewer (c)）**:

```bash
# 对照实验：若 Generator 不小心把 time-intl-caching.test.ts 删除（或路径错位），vitest 应明确报 "No test files found"
# 不是 "0 tests run" / "No tests found" / "Tests  0" — 这类输出都说明 collect 机制未正常拒绝，是假绿风险
#
# Reviewer 可通过临时 mv 模拟后跑（不是 Proposer 交付时的常态动作，只是作为"失败期望形状"的规约）：
#   mv sprints/tests/ws1/time-intl-caching.test.ts /tmp/__hold.test.ts
#   npx vitest run sprints/tests/ws1/time-intl-caching.test.ts 2>&1 | grep -E "No test files found"   # 必须命中
#   mv /tmp/__hold.test.ts sprints/tests/ws1/time-intl-caching.test.ts
#
# Round 8 不要求 Proposer/Generator 实际执行 mv —— 只是在合同里显式规约"预期失败形状"。
```

**命令 3（include 登记确认 — Reviewer (b)）**:

```bash
# 仅检查"仓库根" vitest.config.{js,ts} —— Harness v6 evaluator 从仓库根执行
# `npx vitest run sprints/tests/ws1/<file>` 时被实际应用的 config 位置。
# packages/brain/vitest.config.js 的 include 仅覆盖 brain 自身 src/tests
# (PRD 范围限定要求合同测试不污染 brain-ci main 绿线 — RED_EVIDENCE.md:75 备注)，
# 故不纳入本命令范围。
for CFG in vitest.config.js vitest.config.ts ; do
  [ -f "$CFG" ] || continue
  # 若仓库根声明了字面量 include，必须能匹配 sprints/tests/ws1/time-intl-caching.test.ts
  # 合法覆盖形式：显式含 sprints/tests / sprints/** / **/*.test.ts / **/sprints/** / 具体路径
  echo "[root config] $CFG $(grep -cE '^\s*include\s*:' "$CFG") 条字面量 include"
done
# 当前 Round 7 环境：仓库根无 vitest.config —— Harness 从根跑 vitest 走默认 glob
# `**/*.{test,spec}.?(c|m)[jt]s?(x)`，能 collect 到 sprints/tests/ws1/*.test.ts。
# 若未来有人在仓库根新建 vitest.config 并使用字面量 include 但未覆盖 sprints，
# 对应的 DoD ARTIFACT (contract-dod-ws1.md) 会 fail → 合同 red → REVISION。
```

**Round 8 硬约束总表**:

| 状态 | vitest 命令 | 必须包含 | 必须不包含 | 原因 |
|---|---|---|---|---|
| Proposer 交付后、Generator 未实现前 | `vitest run sprints/tests/ws1/time-intl-caching.test.ts` | `Test Files  1`、`Tests  1`、`failed (1)`、`Failed to load url` 或 `ERR_MODULE_NOT_FOUND` | `No test files found`、`Tests  0`、`0 passed` | collect 正常 + 模块缺失真红 |
| Proposer 交付后、Generator 实现后 | 同上 | `Tests  1 passed (1)` | 任何 `failed`/`No test files` | TDD Green 阶段 |
| 假设文件被误删 / 路径错位 | 同上 | `No test files found` | `0 tests run`（这种形状说明 config 吞了文件） | collect 机制应当明确拒绝缺失的文件 |

---

## GAN 对抗要点（供 Reviewer 聚焦 Round 7 修订是否充分）

**Round 1 → Round 7 的 mutation 族是否已被一次性堵上**：

| # | Mutation 族 | 旧轮漏洞 | Round 7 堵法 |
|---|---|---|---|
| 1 | **假 iso 格式**：返回 `new Date().toString()` | Round 1 `it(3)` 能混过 | Round 2 `it(4)` 正则 + Round 3 Z-only 收紧 |
| 2 | **假 iso 格式**：返回 `"2024-01-01T00:00:00"` 无后缀 | Round 1 能混过 | Round 2 `it(4)` 堵 + 保留 |
| 3 | **假 iso 格式**：返回本地偏移 `+08:00` | Round 2 `it(4)` **会 pass** | Round 3 `it(4)` 收紧 Z-only + 保留 |
| 4 | **假 unix（毫秒）** | 已被 `it(5)` 抓住 | 保留 + E2E 双重 |
| 5 | **假 timezone（任意非空字符串）** | Round 1 `it(6)` 能混过 | Round 2 `it(7)` 堵 + 保留 |
| 6 | **字段白名单破坏**：多加 `offset`/`version` | 已被 `it(2)` 抓住 | 保留 + E2E 双重 |
| 7 | **iso 与 unix 不同源** | 已被 `it(8)` 抓住 | 保留 + E2E 双重 |
| 8 | **被 query 污染** | 已被 `it(9)` 抓住 | 保留 + E2E step 7 |
| 9 | **timezone 未 fallback** | 已被 `it(10)` 抓住 | 保留 |
| 10 | **timezone 永远硬编码 UTC** | Round 1 能混过 | Round 2 反向 mock + 保留 |
| 11 | **只挂在单独路径而非聚合器** | Round 2-4 各种正则都能被绕过或误杀 | **Round 5 行为路线**：`routes-aggregator.test.ts` it(14)(15) |
| 12 | **SC-003 E2E 弱断言假阳性** | Round 1 无脚本 | Round 2-7 持续加厚 |
| 13 | **非 GET 方法触发 handler**（`router.all`） | Round 1/2 未规约 | Round 3 `it(11)` + E2E step 8 / Round 4 硬枚举 {404,405} / Round 5 相对化 baseline / Round 6 8 码枚举 / **Round 7 原则规则 `is_http_error_status`** |
| 14 | **POST body 污染** | Round 1/2 未覆盖 | Round 3 it(12) + E2E step 8 / Round 4 追加 `res.text` 字面量反向断言 / **Round 7 E2E body key 检查无条件 jq 判定** |
| 15 | **iso 误用 timezone 偏移** | Round 2 正则会 pass | Round 3 Z-only 正则 + 保留 |
| 16 | **模块顶层缓存 Intl 解析** | Round 2/3 `it(11)` 反向 mock 后 Intl 已缓存；Round 4 ARTIFACT 切片正则被别名绕过 | **Round 5 行为路线**：动态 import + 双 mock 切换；**Round 6 同文件独立 describe + afterAll**；**Round 7 — Risk 3：搬到独立测试文件 `time-intl-caching.test.ts`，vitest file-per-worker 的 OS/VM 级隔离做主防线** |
| 17 | **仅 import 不挂接的假实现** | Round 3 标识符 ≥ 2 次可被注释补齐；Round 4 mount-expression 正则被字符串绕过 | **Round 5 行为路线** — 与 #11 同 |
| 18 | **Brain 全局 middleware 把未命中路径改成 500/401 等**，Round 4 硬枚举会误杀 | Round 4 硬枚举会误杀 | Round 5 step 8 相对化 baseline；Round 6 8 码枚举；**Round 7 原则规则 `400 ≤ code < 600`**，自动接纳任何合法 4xx/5xx |
| 19 | **`app.all('*')` 骗过 routes-aggregator it(14) 的正向断言** | Round 5 it(14) 单独存在时会被骗 | Round 5 新增 it(15) 反向 anti-catch-all |
| 20 | **`== baseline` 等式误杀端点级 vs 全局级 middleware 布局不同的合法实现** | Round 5 step 8 等式硬绑 baseline | Round 6 → 8 码枚举；**Round 7 → 原则规则 `400 ≤ code < 600`**（任何合法 4xx/5xx 都放行） |
| 21 | **`it(11)` 的 Intl spy 泄漏到同文件其它 it** | Round 5 主 describe 块 afterEach 仅软兜底 | Round 6 同文件独立 describe + afterAll；**Round 7 — Reviewer Round 6 Risk 3：搬到独立测试文件，vitest file-per-worker 的 OS/VM 级隔离做主防线，消除 afterAll 不可靠假设** |
| 22 | **8 码枚举外的合法状态码误杀**（Round 6 新引入）：Brain 接入鉴权 → 401/403、限流 → 429（在枚举内）；但 Brain 将来引入 410 Gone、451 Unavailable For Legal Reasons、502 Bad Gateway、503 Service Unavailable、504 Gateway Timeout 等均**不在 8 码枚举内** → step 7.5/step 8 误杀合法实现 | Round 6 枚举固定 | **Round 7 原则规则 `400 ≤ code < 600`**：所有合法 HTTP 4xx/5xx 状态码一次性接纳，无需未来维护枚举；真正的 mutation「POST /time 也 200」仍被抓（200 < 400）；step 7.5 与 step 8 **共用同一函数** `is_http_error_status`，覆盖面天然对称 — Reviewer Round 6 Risk 1/2 同步闭合 |
| 23 | **E2E step 8 body key 检查 gated on grep 预筛选导致的漏检**（Round 6 minor）：若 mutation 以非常规 JSON 格式（字段间多空格/奇异 key 编码）回显三字段 key，`grep -Eq '"(iso\|unix\|timezone)"[[:space:]]*:'` 可能漏命中 | Round 6 先 grep 后 jq | **Round 7 改无条件 jq 判定**：先 `jq -e . "$FILE"` 确认 body 可解析为 JSON，若是则直接 `has("iso") or has("unix") or has("timezone")` 硬断言；不可解析 JSON 走字面量 not-contain 兜底 |
| 24 | **collect-miss 假绿：合同测试文件存在但被 vitest.config 字面量 include 列表 filter 掉** — evaluator 跑 `vitest run sprints/tests/ws1/time-intl-caching.test.ts` 得 `Tests  0` 或 `0 passed` 假绿，Reviewer 误判 Green | Round 7 仅交付独立文件但未规约 collect sanity，Reviewer 无可观测契约去区分"真绿"和"文件被吞假绿" | **Round 8 — Reviewer Round 7 (a)+(c)**：新增 `## Test Collect Sanity` 章节，明文规约两段红姿态（"No test files found" = collect miss 禁区；`Failed to load url routes/time.js` = TDD 真红）+ Round 7 后就绪指纹（`Tests  1`）；Test Contract 表第二行"预期红证据"列拆成 ①②③④ 四个硬子项 —— Reviewer 日后只需对照合同里列出的子串做 grep 就能判定 collect 机制是否正常 |
| 25 | **vitest.config 字面量 include 列表未登记新文件导致跨环境差异** — 本仓库当前 brain/quality/engine 各自有字面量 include 列表但 sprints/ 测试目录不在其中；若 Harness v6 evaluator 在某环境下误用带 include 的 config（而非仓库根默认），新文件不会被跑到 | Round 7 未约束 include 登记，依赖"vitest 默认显式文件路径优先于 include" 的行为假设 | **Round 8 — Reviewer Round 7 (b)**：Workstream 1 范围明文写入 collect pre-flight 纪律 —— Generator 在实现前必须跑一次 `vitest run sprints/tests/ws1/time-intl-caching.test.ts` 看到 `Test Files  1 failed (1)` 才继续；若看到 `No test files found` / `Tests  0` 必须修正 include 列表。`contract-dod-ws1.md` 追加条件性 ARTIFACT：任何字面量 include 的 vitest.config 若用于合同测试运行，必须覆盖该路径。防线从"假设默认行为"升级为"合同硬纪律 + 可观测 pre-flight" |

## PRD 追溯性

| PRD 条目 | 覆盖位置 |
|---|---|
| FR-001（GET /api/brain/time，无鉴权无 DB） | WS1 route 实现 + ARTIFACT "不 import DB/LLM" |
| FR-002（响应体只含 iso/timezone/unix） | BEHAVIOR `it(2)` 字段白名单 + E2E step 1 + it(14) 聚合行为 |
| FR-003（iso=严格 ISO 8601） | BEHAVIOR `it(3)(4)` + E2E step 4 |
| FR-003（unix=整数秒） | BEHAVIOR `it(5)` + E2E step 2+3 |
| FR-003（timezone=非空且有效 IANA） | BEHAVIOR `it(6)(7)` + E2E step 6 |
| FR-004（挂接到现有聚合器） | **`routes-aggregator.test.ts` it(14)(15) 行为 probe** |
| SC-001（≥3 条单测） | 本合同含 **15 条** it() |
| SC-002（Supertest HTTP 集成） | `tests/ws1/time.test.ts` + `tests/ws1/time-intl-caching.test.ts` + `tests/ws1/routes-aggregator.test.ts` 全程使用 supertest |
| SC-003（真机 curl + jq） | `tests/e2e/brain-time.sh` 9 步断言强等价 BEHAVIOR 核心 it() |
| SC-004（brain-ci 全绿） | 由 CI 保证；合同测试位于 `sprints/tests/` 不进 brain-ci include |
| 边界: timezone Intl 回落 UTC | BEHAVIOR `it(10)` |
| 边界: timezone 非硬编码 / 非顶层缓存 | BEHAVIOR `time-intl-caching.test.ts` it(13) **（Round 7 — 搬到独立测试文件，Risk 3 闭合；file-per-worker 进程/线程级隔离为主防线）** |
| 边界: 忽略客户端输入（query） | BEHAVIOR `it(9)` + E2E step 7 |
| 边界: 忽略客户端输入（非 GET + body） | BEHAVIOR `it(11)(12)` + E2E step 7.5+8 **（Round 7 — 原则规则 `is_http_error_status`，Risk 1/2 闭合）** |
