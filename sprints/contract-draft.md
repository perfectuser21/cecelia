# Sprint Contract Draft (Round 9)

对应 PRD: `sprints/sprint-prd.md` — Brain GET /api/brain/time 端点

## Round 8 Reviewer 反馈回应（VERDICT: REVISION）

| # | Reviewer 指出 | 级别 | Round 9 回应 |
|---|---|---|---|
| 1 | Round 8 把 DoD 第 8 条拆成 (a)(b) 入参捕获 + (c) `<ST>(<SRV>)` 出现 + (d) `.get('/api/brain/time')` 出现 + (e) `.expect(200)` / `toBe(200)` / `toEqual(200)` 任一出现 **五条独立 substring 检查**。关键漏洞：**(c)(d)(e) 独立存在 ≠ 同一链式调用**。Generator 可分散布置三者让三条独立检查同时命中，但 200 断言并未挂在 time 端点的真实响应上（例如 `supertest(server).get('/health')` 命中 (c)、`supertest(fakeApp).get('/api/brain/time').expect(200)` 命中 (d)(e)、`expect(res.status).toBe(200)` 也命中 (e)）。Reviewer 明确给出修复：**`<ST_NAME>(<SRV_NAME>).get('/api/brain/time').expect(200)` 必须作为单一链式表达式存在** | 阻塞 | **采纳 Reviewer 明确建议的"(c)(d)(e) 强制同链"**：`contract-dod-ws1.md` 第 8 条 Test 从"3 条独立 substring 检查"升级为"链路游走器（walker）" —— 锚定 `<ST>(<SRV>)` 起点，沿 `.<method>(<balanced-parens>)` 游走链路，要求链中**依序**命中 `.get('/api/brain/time')` 与 `.expect(200)`，链条被 `;`/赋值/新语句打断即 break。同时**关闭 `toBe(200)`/`toEqual(200)` 旁路**（这两种断言无法证明挂在 time 端点响应上）。这一改动一箭双雕：(i) 锁死 200 断言必须挂在 time 端点响应上；(ii) 顺带关闭 Round 7 残留的"import 存在 ≠ 被 supertest 使用"后门（Reviewer 明确指出这是路径 1 的同步收益） |
| E | （非阻塞观察）`.expect(status => status === 200)` / `.expect(res => assert.equal(res.status, 200))` 是 supertest 官方支持的 200 等价断言，不在硬门白名单内。非阻塞 | 非阻塞（Reviewer 明确"Generator 可以改用 `.expect(200)`"） | 不纳入硬门。回调式断言需 AST 级解析才能确证（如 `res.status === 200` 与 `status === 200` 这类等价表达式），超出合同守门职责。Generator 直接写 `.expect(200)` 即可满足 |

## Round 7 Reviewer 反馈回应（Round 8 已处理，保留索引）

| # | Reviewer 指出 | 级别 | Round 8 回应 |
|---|---|---|---|
| 1 | Round 7 把 body 断言收紧到 matcher 白名单仍有两处问题：(i) 值比较 matcher 本身也能写 `toMatch(/./)` 类无意义断言；(ii) `.toBeDefined` / `.toBeTruthy` / `.toBeFalsy` / `.toBeNull` 与裸 expect 语义距离过近，`.not.` 前缀等价于 `toBeDefined` 属于同一等价类。路径 2（Reviewer 推荐）把 (e) 改为 `.expect(200)` 硬性必须 | 阻塞 | Round 8 采纳路径 2（200 硬门 + body 可选）；Round 9 在此基础上进一步同链化，body 断言保持不参与判定 |
| D | （非阻塞）`Intl.DateTimeFormat` 对 `CET` / `Etc/GMT+0` 在 small-icu 与 full-icu Node 下行为可能不完全一致 | 非阻塞 | 不动。多数 CI/dev 环境用 full-icu |

## Round 6 Reviewer 反馈回应（Round 7 已处理，保留索引）

| # | Reviewer 指出 | 级别 | Round 7 回应 |
|---|---|---|---|
| 1 | Round 6 新增的 `hasBody` variant (i) `/expect\s*\(\s*[\w.]*\.body\.(iso\|timezone\|unix)/` 只锚定 `expect(res.body.iso)` 开头，不要求 `.toBe(...)` 等 matcher 后缀 → 裸 expect 即可通过 | 阻塞 | Round 7 采"matcher 白名单"；Round 8 发现该路径仍有无意义断言 / 等价类问题，被 Reviewer 否决，改走路径 2（见上表） |
| 2 | `hasSrv` 只要求 "import 语句存在"，Generator 可 `import app from '../server.js'` 后自建 `const a = express(); request(a)` 绕开 server.js 的 app | 阻塞 | Round 7 采"捕获变量名 + 强制 supertest 入参" + **禁动态 import**（Round 6 观察 C 一并关闭）；Round 8 沿用不变 |

## Round 5 Reviewer 反馈回应（Round 6 已处理，保留索引）

| # | Reviewer 指出 | 级别 | Round 6 回应 |
|---|---|---|---|
| 1 | DoD 第 6 条 "对每个匹配行向上最多 5 行扫描" 量化词含义不明，FOR-ALL 解读下合法注释 / 数据结构里的字面量会判红 | 阻塞 | Round 6 改为 EXISTS 语义，代码用 `.some()` 自文档化；Round 7 未再挑战 |
| 2 | DoD 第 8 条 `hasBody` 用 `/\.body\.(iso\|timezone\|unix)/` 只识别属性访问 | 阻塞 | Round 6 收紧到 `expect(...)` 包装三选一；Round 7 进一步加 matcher 白名单（见上表风险 1） |
| C | `hasSrv` 允许动态 import | 非阻塞 | Round 7 连同风险 2 一并关闭（禁动态 import） |

## Round 4 Reviewer 反馈回应（Round 5 已处理，保留索引）

| # | Reviewer 指出 | 级别 | Round 5 回应 |
|---|---|---|---|
| 1 | DoD 第 6 条把"零缩进顶层"和"路径字面量 `/api/brain/time`"压在同一条正则 `/^app\.use\(\s*['\"]\/api\/brain\/time.../`，导致合法多行写法 `app.use(\n  '/api/brain/time',\n  timeRoutes\n);` 被误杀——`app.use(` 行零缩进但不含路径字面量，路径字面量行有缩进但不是 `app.use(` 起始 | 阻塞 | 采纳"拆分两步语义"路径：`contract-dod-ws1.md` 第 6 条改为 (a) 先 split 文件、定位所有含 `'/api/brain/time'` 字面量的行索引；(b) 对每个匹配行向上最多 5 行扫描，要求存在一行以 `^app\.use\(` **零缩进**起始。单行写法 `app.use('/api/brain/time', timeRoutes)` 路径行本身就是 `app.use(` 起始行（j=t.i 命中）；多行写法 `app.use(\n  '/api/brain/time',...` 路径行上一行是 `app.use(` 起始行（j=t.i-1 命中）。if/try/else 块内的假挂载因包裹缩进无法通过 |
| 2 | DoD 第 8 条只要求 `.get('/api/brain/time')` 调用字符串出现，Generator 可写 `await request(app).get('/api/brain/time');` 不加任何 assert，让 supertest 默认 promise resolve（即便服务器 500/404）→ vitest 第 11 条运行时锁只看到"测试跑完没抛"而非"响应正确"，真闭环未建立 | 阻塞 | 采纳"追加强制 assert"路径：`contract-dod-ws1.md` 第 8 条追加两选一硬阈值 — 必须出现 `.expect(200)` / `toBe(200)` / `toEqual(200)` 任一 200 状态码断言，**或** 出现 `res.body.iso` / `res.body.timezone` / `res.body.unix` / `toMatchObject({...iso/timezone/unix...})` 任一 body 三字段断言。这样第 11 条 vitest 运行时锁才能真正看到"HTTP 200 + 三字段 schema"在进程里被断言通过 |
| A | （观察）与风险 2 同源 — DoD 8 + 11 允许裸 `.get(...)` | 观察（与风险 2 合并修复） | 同风险 2：第 8 条追加 `.expect(200)` 或 body 断言强制后关闭 |
| B | （观察）`packages/brain/tests/time.test.js` 与 `sprints/tests/ws1/time.test.js` 双测试文件并存，Generator 可能困惑能否合并 | 观察（非阻塞，显式说明） | 合同 `Generator commit 2 的职责` 第 3 点显式标注：两份测试**职责不同不得合并**——sprint 侧是 BEHAVIOR 覆盖（8 个功能 it，走私有 express + supertest，由 `vitest.sprint.config.mjs` 执行），brain 包内是入口可达双层锁（import server.js default export，做真实 supertest，由 brain 包自带 vitest 配置执行 + 被 DoD 第 11 条直接 `npx vitest run` 拉起）。二者用不同 config、跑不同测试目标 |

## Round 3 Reviewer 反馈回应（Round 4 已处理，保留索引）

| # | Reviewer 指出 | Round 4 回应 |
|---|---|---|
| 1 | IANA 正则 `[A-Za-z_]+/[A-Za-z_]+(/[A-Za-z_]+)?` 误杀 `Etc/GMT+0`/`GMT`/`CET` | Round 4 采纳"删正则"：`sprints/tests/ws1/time.test.js` 移除 `IANA_TZ_RE`，IANA 合法性完全由 `round-trip through Intl.DateTimeFormat` 承担 |
| 2 | DoD 10 条形式未指定运行时验证，纯 `node -e`/`grep` 静态检查留下"假挂载"后门 | Round 4 追加 DoD 第 11 条 vitest 运行时锁（Round 5 配合第 8 条 assert 强制完全闭环） |
| 3 | sleep 1050ms 可选升 1100ms | Round 4 已升回 1100ms |

## Round 2 Reviewer 反馈回应（Round 3/4 已处理，保留索引）

| 来源 | Reviewer 指出 | 回应 |
|---|---|---|
| Risk 3（静态正则脆弱） | Round 2 新增的 `readFileSync(server.js)` 静态四 it 对风格敏感 | Round 3 采用 Reviewer 路径 ② 收敛，删除 BEHAVIOR-STATIC describe |
| 非阻塞观察（CI 开销） | `sleep 1.1 秒` 加 ~1.1s 固定开销 | Round 3 调整 1050ms，Round 4 回退 1100ms |
| 非阻塞观察（PRD 用词） | PRD "新增一行 require" 与 ESM `import` 不一致 | 合同以 ESM `import` 为准 |

## Round 1 Reviewer 反馈回应（已处理，保留索引）

| 风险 | Reviewer 指出 | 回应 |
|---|---|---|
| 风险 2（timezone 硬阈值弱） | `typeof === 'string' && length > 0` 放行 `"abc"` / `"1"` | Round 2 新增 IANA 正则 + round-trip；Round 4 删除 IANA 正则，round-trip 独立承担（Intl.DateTimeFormat 对 "abc"/"1" 抛 RangeError） |
| 风险 3（BEHAVIOR 从未触碰 server.js） | 7 个 it 全挂私有 `express()` | Round 2/3/4 逐步收敛到"DoD 静态 import 锁 + DoD vitest 运行时锁"；Round 5 追加 `.expect(200)`/body assert 强制让运行时锁真的看到行为正确 |

---

## Feature 1: GET /api/brain/time 时间探针端点

**行为描述**:
Brain 暴露一个无鉴权、无副作用的只读 HTTP 端点，调用方通过 `GET /api/brain/time` 拿到 Brain 进程当前的标准化时间信息。每次调用独立计算当前时间，不缓存，字段严格为 `iso` / `timezone` / `unix` 三项。三个字段同源同一时刻，`iso` 与 `unix` 之间必须自洽。路由必须从 `packages/brain/server.js` 顶层入口挂载到 `/api/brain/time`，且必须通过"生产侧测试以 `<ST_NAME>(<SRV_NAME>).get('/api/brain/time').expect(200)` **单一链式表达式**发起真实 supertest 请求"这一端到端路径可达，并在 vitest 下真实 exit 0（Round 4 入口锁 + Round 5 行为锁 + Round 6 断言形式收紧 + Round 7 "supertest 真用 server.js 的 app" + Round 8 "`.expect(200)` 硬性必须" + Round 9 "(c)(d)(e) 强制同链（链路游走器）" 六层闭环）。

**硬阈值**:

- HTTP 状态码严格 `200`
- 响应 `Content-Type` 以 `application/json` 开头
- 响应体顶层字段名排序后等于 `['iso', 'timezone', 'unix']`（不多不少）
- `iso` 匹配正则 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`（UTC 毫秒 ISO-8601）
- `timezone` 满足（Round 4：删除 IANA 字符集严格正则，避免误杀 `Etc/GMT+0` / `GMT` / `CET` 等合法别名）：
  - `typeof === 'string'` 且 `length > 0`
  - **能被 `new Intl.DateTimeFormat('en-US', { timeZone })` 接受不抛 RangeError**（IANA 权威校验，独立承担原 IANA 正则的拦截职责）
- `unix` 满足 `Number.isInteger === true`，且落在调用前后 1 秒窗口内
- `|Math.floor(new Date(iso).getTime()/1000) - unix| <= 1`
- 两次调用之间 sleep **1.1 秒**，`unix` 严格递增（禁止缓存/静态值）
- **server.js 挂载完整性**（由 DoD ARTIFACT 强制；Round 6 第 6 条在 Round 5 拆分基础上**量化词显式化为 EXISTS**：代码用 `.some()` 取代 `for(...){if(ok)break;}` 自文档化，允许注释/数据结构中的字面量共存）：
  - 顶部出现行级精确 `import timeRoutes from './src/routes/time.js'`（分号可选）
  - 出现 `app.use('/api/brain/time', timeRoutes)` 调用（路径字面量精确；`\s*` 允许任意空白/换行；`;?` 允许分号可选）
  - **注册点在顶层**（EXISTS 语义）：**存在至少一行**含 `/api/brain/time` 字面量，且其自身或向上 5 行内有一行以 `^app\.use\(` **零缩进**起始（if/try/else/function 块内的假挂载因包裹缩进无法通过；合法注释/数据结构中的字面量不阻塞）
  - 禁止 `/api/brain/times` / `/api/brain/timer` 等笔误（负向前瞻 `(?![A-Za-z0-9_])`）
- **从 server.js 入口真实可达**（Round 4 双层锁 × Round 5 行为锁 × Round 6 断言形式收紧 × Round 7 supertest 入参锁 × Round 8 `.expect(200)` 硬性必须 × **Round 9 (c)(d)(e) 强制同链**）：
  - **入口 + 行为同链锁（Round 9 收紧）**：`packages/brain/tests/time.test.js` 必须 **静态** `import <SRV_NAME> from '../server.js'`（禁动态 import — 同步关闭 Round 6 观察 C），必须 `import <ST_NAME> from 'supertest'`，且必须以 **`<ST_NAME>(<SRV_NAME>).get('/api/brain/time').expect(200)` 单一链式表达式**形态调用（允许中间穿插 `.set()` / `.send()` / `.query()` / `.expect('Content-Type', /json/)` 等 supertest 链接方法；`.expect(200)` 必须在 `.get('/api/brain/time')` 之后）
  - **为何要同链**：Reviewer Round 8 指出 Round 8 的"(c)(d)(e) 独立检查"漏洞 —— 三条 substring 可以分散存在，200 断言未必挂在 time 端点响应上。Round 9 用链路游走器（walker）锚定 `<ST>(<SRV>)` 起点沿 `.method(...)` 游走链路，强制链中依序出现 `.get('/api/brain/time')` 与 `.expect(200)`，链条遇 `;` / 赋值 / 新语句即断裂。同链化后，无论 Generator 如何穿插或嵌套，200 断言必然绑定于"server.js 导出的 app 对 time 端点的真实响应"
  - **旁路关闭**：Round 8 允许的 `toBe(200)` / `toEqual(200)` 替代路径**已关闭**（这两种断言无法证明挂在 time 端点响应上）。硬门仅接受链上字面量 `.expect(200)`
  - **（非阻塞观察 E 不纳入）**：supertest 回调式断言 `.expect(status => status === 200)` 虽等价，但需 AST 解析才能确证，本轮不纳入硬门。Generator 直接写 `.expect(200)` 即可
  - 运行时锁（DoD 第 11 条）：该生产侧测试在 vitest 下必须 exit 0 通过 —— 同链锁 + 运行时双重保障。若 server.js 未真正注册路由，supertest 真跑必然 404 → 链上 `.expect(200)` 抛错 → vitest exit 非 0 → 红

**BEHAVIOR 覆盖**（落在 `sprints/tests/ws1/time.test.js` — Round 4/5/6/7/8/9 共 **8 个 it**，均走私有 express + supertest，Round 9 未改动 sprint 侧测试——修订仅发生在 DoD 第 8 条的"(c)(d)(e) 强制同链 + 链路游走器"）:

- `it('responds with HTTP 200 and application/json on GET /api/brain/time')`
- `it('response body has exactly three keys: iso, timezone, unix')`
- `it('iso is an ISO-8601 UTC millisecond string')`
- `it('timezone is a non-empty string')`
- `it('timezone round-trips through Intl.DateTimeFormat without throwing')`
- `it('unix is an integer within 1 second of current wall clock')`
- `it('iso and unix represent the same moment within 1 second tolerance')`
- `it('two consecutive calls spaced 1.1 seconds return different unix values')`

**ARTIFACT 覆盖**（写进 `contract-dod-ws1.md` — 共 **11 条**，Round 9 再度修订第 8 条：(c)(d)(e) 强制同链 + 链路游走器 + 关闭 toBe/toEqual 旁路）:

1. `packages/brain/src/routes/time.js` 存在且 `export default` 是 Express Router
2. 路由文件注册 `GET /` 处理器
3. `packages/brain/server.js` 顶部 `import timeRoutes from './src/routes/time.js'`（行首精确，分号可选）
4. `packages/brain/server.js` 注册 `app.use('/api/brain/time', timeRoutes)`（路径字面量精确 + `\s*` 允许换行/空白 + `;?` 允许分号可选 + 行尾 `$` with /m 标志，禁 `/api/brain/times` 形变）
5. **Round 6 修订** — `server.js` 中 `/api/brain/time` 挂载点在**顶层零缩进**（**EXISTS 语义**）：split 文件后定位所有 `/api/brain/time` 字面量行，**存在至少一行**满足"自身或向上 5 行内有一行 `^app\.use\(` 零缩进起始"即通过。代码用 `ti.some(t => {...})` 替代 Round 5 的 `for(const t of ti){...if(ok)break;}`，让 EXISTS 语义自文档化，消除"每个匹配行"的 FOR-ALL 误读风险。支持单行 `app.use('/api/brain/time', timeRoutes)`（t.i 命中自身）和合法多行（t.i-1 命中 `app.use(`）两种写法，同时排除 if/try/else/function 块内假挂载（包裹缩进使其无法通过），并容忍注释/数据结构中的字面量共存
6. `packages/brain/tests/time.test.js` 存在
7. `packages/brain/tests/time.test.js` import 真实 route 模块 `../src/routes/time.js`
8. **Round 9 修订** — `packages/brain/tests/time.test.js` 必须同时满足：(a) **静态** `import <SRV_NAME> from '../server.js'` 捕获变量名（**禁动态 import**，同步关闭 Round 6 观察 C），(b) `import <ST_NAME> from 'supertest'` 捕获变量名，**(c)(d)(e) 作为单一链式表达式** —— `<ST_NAME>(<SRV_NAME>).get('/api/brain/time').expect(200)` 必须在测试文件中作为单一链式表达式存在（允许中间穿插 `.set()` / `.send()` / `.query()` / `.expect('Content-Type', /json/)` 等 supertest 链接方法；`.expect(200)` 必须在 `.get('/api/brain/time')` 之后；链条被 `;` / 赋值 / 新语句打断即视为链断裂）。Round 9 采纳 Reviewer Round 8 反馈：Round 8 的"(c)(d)(e) 独立 substring 检查"存在"三者分散布置也能全命中但 200 断言并未挂在 time 端点响应上"的漏洞。链路游走器（walker）锚定 `<ST>(<SRV>)` 起点沿 `.method(<balanced-parens>)` 游走，强制依序命中 `.get('/api/brain/time')` 与 `.expect(200)`。**Round 8 的 `toBe(200)` / `toEqual(200)` 旁路关闭**（链外断言无法证明挂在 time 端点响应上）。非阻塞观察 E（`.expect(status => status === 200)` 回调式）不纳入 —— 需 AST 级解析确证，Generator 直接写 `.expect(200)` 即可
9. `CLAUDE.md` 第 7 节 "Brain 知识查询工具" 区块包含字面量 `/api/brain/time`
10. **Round 4 新增 × Round 9 收紧** — `bash -c "cd packages/brain && npx vitest run tests/time.test.js --no-coverage --reporter=basic"` **exit 0** —— 把"入口真实可达"从"字符串存在"升级到"运行时通过"，并配合第 8 条 Round 9 的"链上 `.expect(200)`"让 vitest 真正看到 "supertest 以 server.js 的 app 为入参 → `.get('/api/brain/time')` → `.expect(200)` 单链真实命中"（禁止假挂载、禁止路径笔误、禁止 import 但未注册、禁止 import 但自建 express 绕开、禁止动态 import 藏死分支、禁止裸 `.get()` 不 assert、**禁止 200 断言与 `.get(time)` 分属不同链**）

（合计 11 条，DoD 文件里对应 ARTIFACT 条目顺序一致，10 条前置静态检查 + 1 条末条运行时锁。）

---

## Workstreams

workstream_count: 1

### Workstream 1: GET /api/brain/time 端点 + 路由注册 + 文档同步

**范围**:

1. 新增 `packages/brain/src/routes/time.js`（Express Router，`GET /` 返回 `{iso, timezone, unix}`）
2. 在 `packages/brain/server.js` 顶部 `import timeRoutes from './src/routes/time.js'` + 在路由注册区（**顶层零缩进**）增加 `app.use('/api/brain/time', timeRoutes)`（单行或合法多行皆可——Round 6 DoD 第 6 条用 `.some()` EXISTS 语义识别）
3. 新增 `packages/brain/tests/time.test.js`（必须既 import `../src/routes/time.js` 做私有 supertest 又 **静态** import `../server.js` default export 并用作 supertest 入参做真实 supertest，**且 supertest 调用必须以 `<ST_NAME>(<SRV_NAME>).get('/api/brain/time').expect(200)` 单一链式表达式存在** —— Round 9 第 8 条 DoD 采纳 Reviewer Round 8 反馈：(c)(d)(e) 强制同链；动态 import 不再允许；`toBe(200)` / `toEqual(200)` 旁路关闭）
4. `CLAUDE.md` 第 7 节 "Brain 知识查询工具" 追加一行说明此端点

**大小**: S（总改动预计 <100 行）

**依赖**: 无（纯增量，不依赖其他 workstream）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/time.test.js`（8 个 it）

**时区取值策略**（对应 PRD ASSUMPTION）:

1. 优先 `process.env.TZ`（必须先用 `Intl.DateTimeFormat` 校验 IANA 合法性，不合法降级；Round 4 删除正则层后，Intl 校验是唯一合法性闸门）
2. 次选 `Intl.DateTimeFormat().resolvedOptions().timeZone`
3. 仍缺或非 IANA → `'UTC'`

每次响应都重新计算，禁止模块级缓存。

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/time.test.js` | **8 个功能 it**（Round 9 未改动 sprint 侧） | `npx vitest run --config ./vitest.sprint.config.mjs` → **8 tests failed (8)**（动态 import `packages/brain/src/routes/time.js` 不存在 → 每个 it 独立红）|

**运行命令**:

```bash
npx vitest run --config ./vitest.sprint.config.mjs --reporter=verbose
```

**DoD 运行时锁附加运行命令**（Round 4 新增，Round 5/6/7/8/9 逐轮收紧行为语义）:

```bash
cd packages/brain && npx vitest run tests/time.test.js --no-coverage --reporter=basic
```

此命令在 Red 阶段也会失败（`packages/brain/tests/time.test.js` 尚不存在），在 Green commit 完成后必须 exit 0 —— Round 9 第 8 条 DoD 保证该测试必然是"supertest 以 server.js 导入的 app 为入参，以 `<ST>(<SRV>).get('/api/brain/time').expect(200)` **单一链式表达式**发起"，因此 exit 0 等价于"HTTP 200 在运行时作为 time 端点响应被真实断言验证 + server.js 注册真的生效"（三字段 schema 由 sprint 侧 8 个 it 独立覆盖）。

---

## Red 证据说明（Round 8 本地实跑，Round 9 sprint 侧未改动沿用）

```
 Test Files  1 failed (1)
      Tests  8 failed (8)
```

根因：`packages/brain/src/routes/time.js` 在 Red 阶段不存在，`getApp()` 内 `await import('../../../packages/brain/src/routes/time.js')` 抛 `Failed to load url ... Does the file exist?`，每个 it 独立红。

DoD 第 11 条（vitest 运行时锁）在 Red 阶段也为红（`packages/brain/tests/time.test.js` 尚不存在 → vitest exit 非 0），等待 Green commit 后转绿。

Generator commit 2 的职责：
1. 创建 `packages/brain/src/routes/time.js`（Express Router，`GET /` 返回 `{iso, timezone, unix}` 并走"`process.env.TZ` → Intl → UTC"三级时区策略；TZ 合法性用 `new Intl.DateTimeFormat('en-US', { timeZone })` 判断，不用正则）
2. 在 `packages/brain/server.js` 顶部加 `import timeRoutes from './src/routes/time.js'`，并在顶层零缩进处 `app.use('/api/brain/time', timeRoutes)`（允许单行或合法多行写法；Round 6 DoD 第 6 条 `.some()` EXISTS 语义均能识别）
3. 新增 `packages/brain/tests/time.test.js`：
   - import `../src/routes/time.js` 做私有 supertest（覆盖基础行为）
   - **且** **静态** `import <SRV_NAME> from '../server.js'`（默认导出 app；禁动态 import —— Round 7 关闭 Round 6 观察 C），**且** `import <ST_NAME> from 'supertest'`
   - **且** 真实 supertest 调用必须以 `<ST_NAME>(<SRV_NAME>).get('/api/brain/time').expect(200)` **单一链式表达式**出现（Round 9 闭环 —— Reviewer Round 8 反馈采纳：(c)(d)(e) 强制同链；允许中间穿插 `.set()` / `.send()` / `.query()` 等 supertest 链接方法，`.expect(200)` 必须在 `.get('/api/brain/time')` 之后）
   - **链外 `toBe(200)` / `toEqual(200)` 旁路关闭**（Round 8 遗留通道 Round 9 关闭 —— 这两种断言无法证明挂在 time 端点响应上）
   - DoD 第 11 条强制此测试本身必须 vitest exit 0
   - **职责分工（观察 B 显式说明）**：此文件与 `sprints/tests/ws1/time.test.js` 职责不同不得合并——
     - `sprints/tests/ws1/time.test.js` = BEHAVIOR 覆盖（8 个功能 it，走私有 `express()` + 动态 import route module，跨 sprint vitest config 执行；三字段 schema + round-trip 在此处覆盖）
     - `packages/brain/tests/time.test.js` = 入口可达同链锁（静态 import server.js default export + `<ST>(<SRV>).get('/api/brain/time').expect(200)` 单一链式表达式，由 brain 包 vitest 配置执行 + DoD 第 11 条直接 `npx vitest run` 拉起）
     - 两者跑不同 config、覆盖不同语义，试图合并会导致"路由注册正确但 server.js 注入失败"这类假绿回到视野之外
4. `CLAUDE.md` 第 7 节追加 `GET /api/brain/time` 一行

届时 `sprints/tests/ws1/time.test.js` 的 8 个 it 全部转 Green，DoD 11 条 ARTIFACT 命令全部 exit 0（含第 11 条 vitest 运行时通过，vitest 进程真实看到"supertest 用 server.js 的 app 发起 GET 拿到 200"；三字段 schema 由 sprint 侧 8 个 it 同时验证）。
