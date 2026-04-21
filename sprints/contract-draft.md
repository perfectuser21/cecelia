# Sprint Contract Draft (Round 6)

本合同由 Proposer 针对 `sprints/sprint-prd.md`（Brain `/api/brain/time` 端点）起草，
进入 GAN 对抗。合同外一字不加，Generator 须严格按本合同实现。

> **Round 6 修订说明**（响应 Round 5 Reviewer 阻断反馈）：
> **阻断点**：R5 的 ARTIFACT #7（`packages/brain/src/__tests__/routes-time.test.js` 文件存在）
> + ARTIFACT #8（含 ≥ 4 个 `it(` 块）+ ARTIFACT #9（使用 supertest 打 `/api/brain/time`）
> 三条**只做静态文件结构检查**——Brain workspace 真实单测是否能跑过、是否 **真的** 覆盖到
> 200/iso/unix/IANA 四个核心语义，静态 grep 抓不到。而 PRD SC-001 明确要求
> "`npm test` 在 Brain workspace 通过 + 专门覆盖 /api/brain/time 的 test 文件"。
> `sprints/tests/ws1/time.test.js`（GAN 对抗套件）里的 12 条 `it` 跑绿，不等同于 Brain
> workspace 自己的 `packages/brain/src/__tests__/routes-time.test.js` 跑绿。
>
> **R6 选择方案 A（Reviewer 推荐的最小改动）**：
> 1. **新增 ARTIFACT #14（动态运行验证）**：从仓库根执行
>    `cd packages/brain && npx vitest run src/__tests__/routes-time.test.js` 必须 exit 0，
>    且 vitest 输出含 `Tests  X passed`（`X ≥ 4`）。此条把 SC-001 从"静态文件形态"升级
>    为"实跑过"——任何未真连到 `src/routes/time.js` 的桩测试、`it.skip(...)` 偷懒、
>    空 body `it('x', () => {})` 等反模式都会被 exit code 或 passed 数量挡下。
>    与现有 ARTIFACT #7/#8/#9（静态锁）+ BEHAVIOR it#11（端到端真实 app）形成四通道闭环。
>
> **Reviewer 留痕的非阻断项（R6 留痕，不强改）**：
> - R5 ARTIFACT #13 注释剥离顺序（先 `/*…*/` 再 `//`）对"源码字符串里含 `//` URL"会有
>   理论上的边界误伤；但 `routes/time.js` 是新建纯净文件且合同约束其只含单一快照实现，
>   实际风险接近 0，R6 不调整剥离算法。
> - R5 BEHAVIOR it#12 的 50 次连调在合法单一快照实现下恒绿（trivially pass），只在
>   ARTIFACT #13 被 exotic 绕过时才产生价值；作为 belt-and-suspenders 留着无害。
>
> **Round 5 修订说明**（保留以便上下文追溯）：
> **阻断点**：R4 对 FR-003「三字段同一 `Date` 快照」只有"行为层概率断言"兜底——
> `Math.floor(Date.parse(iso)/1000) === unix` 在单次调用里通常能被"两次 `new Date()`"
> 的坏实现偶然通过，因为两次 `new Date()` 只相差微秒、几乎总在同一秒内。
> 真正的跨秒偏差只在极罕见的"秒边界恰好落在两次 `new Date()` 之间"才会显形，
> 概率远低于 CI 一次 run 能碰到的量级。Reviewer 给出的三个加固方案里：
>   1. 反复调用 N 次（仍概率）；2. 对齐秒边界再打（仍概率）；3. 文档层提示（软约束）。
> 三者都不是 deterministic。
>
> **R5 选择的加固**（做加法，不回退 R4 已有约束）：
> 1. **新增 ARTIFACT #13（静态硬锁）**：`packages/brain/src/routes/time.js` 在注释剥离后——
>    - 无参 `new Date()` 字面量恰好出现 **1 次**；
>    - `Date.now(` 字面量出现 **0 次**（禁止旁路 wall-clock 采样）；
>    这条与 R4 已有的"`toISOString` / `getTime` / `resolvedOptions` 三调用"（实现锁）合并后，
>    唯一合法的 iso / unix 生成路径就是：`const now = new Date(); now.toISOString(); now.getTime()`。
>    任何分别取时间的反模式被**静态**禁止，不靠运行时侥幸触发跨秒才暴露。
> 2. **新增 BEHAVIOR it#12（概率兜底）**：连续 50 次 `GET /api/brain/time`，**每一次**
>    都必须 `Math.floor(Date.parse(iso)/1000) === unix`。即使 ARTIFACT #13 被规避
>    （如放宽成模板字符串 / eval / 间接构造 Date），50 次连调里跨秒概率也被抬到可感水平。
>    这一条是 belt-and-suspenders，和 #13 是"一票否决"关系：静态失败或任一次行为失败都判红。
>
> **Reviewer 留痕的非阻断项（R5 留痕，不强改）**：
> - R4 ARTIFACT #11 允许 `export const app = …` 或 `export { app }`；当前 `server.js`
>   文件末尾已有 `export default app;`（grep 全仓库无外部以默认导入方式引用该路径）。
>   **Generator 指引（软提示，不硬约束）**：保留既有 `export default app;` 完全可以，
>   只需额外加一处命名导出让 it#11 导入成功即可——最小改动是在 `const app = express()`
>   行加 `export`，或在文件末尾 `export default app;` 旁追加 `export { app };`。
>   合同层不强制删除默认导出（避免潜在回归）。
> - R4 ARTIFACT #12 的 regex 只锚定 `runMigrations(` + `listenWithRetry(` 两个关键函数，
>   其他副作用（`initConsciousnessGuard` / `loadSpendingCapsFromDB` / `loadAuthFailuresFromDB` /
>   `initWebSocketServer` / `initTickLoop` / `startFleetRefresh` / `initNarrativeTimer` /
>   `startCeceliaBridge`）漏 guard 时会由 it#11（真实 app 动态 import 时的副作用抛错）兜底。
>   属"behavior-enforced" 策略，R5 不调整。
>
> **Round 4 修订说明**（保留以便上下文追溯）：
> - 新增 BEHAVIOR it#11：直接 `import { app } from '../../../../packages/brain/server.js'`
>   用 supertest 打真实 Express 应用，闭合"import 变量名 + app.use 字面量 + 真实 app 实例"三者一致性。
> - 新增 ARTIFACT #11：`server.js` 必须命名导出 `app`。
> - 新增 ARTIFACT #12：`server.js` 的 DB / WS / 端口副作用顶层 `await` 必须被
>   `if (!process.env.VITEST)` 护栏块包住（至少 `runMigrations` + `listenWithRetry` 两个关键锚点）。
>
> **Round 3 修订说明**（保留）：
> 1. 测试文件由 `.ts` 改为 `.js`，与 Brain workspace 同语言（`type: module` ESM JS）。
> 2. 删除 ARTIFACT "`new Date(` 文本恰好 1 次"约束（R3 当时判定易误伤）。
>    R5 重新把"无参 `new Date()` 恰好 1 次 + `Date.now(` 为 0"作为静态硬锁加回来——
>    和 R3 删除的版本差异是：R5 先剥离行/块注释再计数，不再被注释/示例文本误伤。
> 3. `unix` 数量级硬阈值新增下限 `unix > 1e9`，与现有上限 `< 1e12` 共同夹住"秒级时间戳"区间。
>
> **Round 2 修订说明**（保留以便上下文追溯）：
> - 已在本地实跑测试并记录 Red 证据；
> - 新增 ARTIFACT 强挂载校验：server.js 中 import 变量名必须与 `app.use('/api/brain/time', …)` 挂载变量名一致，且路径字面量严格为 `/api/brain/time`；
> - iso↔unix 硬阈值由"≤ 2 秒"收紧为同秒严格相等；
> - `timezone` 合法性硬阈值由"非空字符串"升级为"能被 `new Intl.DateTimeFormat('en', { timeZone: <value> })` 无异常构造"。

---

## Feature 1: GET /api/brain/time 只读时间端点

**行为描述**:
外部调用方向 Brain 发送 `GET /api/brain/time`，Brain 在单次请求的一个时间快照内
返回一段 JSON，同时表达"当前时刻"的三种形式：ISO 8601 扩展字符串、IANA 时区名、
Unix 秒级整数。端点不需要鉴权、无副作用、对同一进程的重复调用每次都成功，
不依赖任何数据库或外部服务。**这个端点必须挂载在 `packages/brain/server.js` 导出的真实 app
上**——PRD US-001/SC-002 要求的是"跑起来的 Brain 能被外部 GET 到"，合成 Express 合规不算数。
**三字段必须来自同一次 `new Date()` 调用的同一 `Date` 实例**——这是 FR-003 的核心，
由 R5 的静态 ARTIFACT (new Date() 恰好 1 次 + Date.now 为 0) + 行为概率兜底 (50 次连调)
双通道强制。

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
  数量级必须落在秒级区间：`unix > 1e9`（约 2001-09-09 后）且 `unix < 1e12`（毫秒级会 ≥ 1e12）；
  且不应偏离真实当下 60 秒以上：`Math.abs(unix - Math.floor(Date.now() / 1000)) ≤ 60`
- 同一响应内 `iso` 与 `unix` 表达的时刻**同秒严格相等**：
  `Math.floor(Date.parse(iso) / 1000) === unix`（不允许任何秒级偏差）
- 连续两次调用均返回 200，每次响应内部仍满足上述所有阈值（无状态污染）
- **（R4）** 从 `packages/brain/server.js` 的**命名导出 `app`** 以 supertest 打 `GET /api/brain/time`，
  必须返回 200、`Content-Type` 以 `application/json` 开头，且 body 含 `iso / timezone / unix` 三字段；
  `Math.floor(Date.parse(iso) / 1000) === unix` 仍成立
- **（R5 新增）** 连续 50 次 `GET /api/brain/time`，**每一次**响应都必须 200 且
  `Math.floor(Date.parse(iso) / 1000) === unix`（不允许任意一次跨秒漂移）
- **（R5 新增 / 静态源码层）** `packages/brain/src/routes/time.js` 注释剥离后：
  无参 `new Date()` 字面量恰好 1 次；`Date.now(` 字面量 0 次（禁止旁路 wall-clock 采样）
- **（R6 新增 / 动态运行层）** `packages/brain/src/__tests__/routes-time.test.js` 在 Brain
  workspace 下能实际跑过：`cd packages/brain && npx vitest run src/__tests__/routes-time.test.js`
  exit 0 且输出含 `Tests  X passed`（`X ≥ 4`）——SC-001 的实跑兜底

**BEHAVIOR 覆盖**（落入 `tests/ws1/time.test.js`）:
- `it('returns HTTP 200 with application/json content-type')`
- `it('response body contains iso, timezone, unix fields all non-empty')`
- `it('iso is a valid ISO 8601 extended format string parseable by Date')`
- `it('timezone is a non-empty string')`
- `it('timezone is a valid IANA name accepted by Intl.DateTimeFormat')`
- `it('unix is a positive integer in seconds (lower bound > 1e9, upper bound < 1e12)')`
- `it('iso and unix within a single response represent the exact same second (strict equality)')`
- `it('two consecutive calls both succeed and each response is internally consistent to the second')`
- `it('does not require any auth header to return 200')`
- `it('packages/brain/server.js imports time router and mounts it at /api/brain/time using the same variable')`
- `it('can GET /api/brain/time against the real Brain app exported from server.js')`
- `it('fifty consecutive requests each satisfy strict iso/unix same-second equality')`（**R5 新增 #12**）

**ARTIFACT 覆盖**（落入 `contract-dod-ws1.md`）:
- `packages/brain/src/routes/time.js` 存在，使用 `express.Router()` 并 `export default` 一个 Router 实例
- 路由文件含 `toISOString`、`getTime`、`resolvedOptions` 三个调用（R4 实现锁）
- `packages/brain/server.js` 用 ESM import 引入该路由，指向 `./src/routes/time.js`
- `packages/brain/server.js` 的 `app.use('/api/brain/time', <varname>)` 挂载变量与 import 变量**同名**
- 单元测试文件 `packages/brain/src/__tests__/routes-time.test.js` 存在，使用 `supertest` 发 `GET /api/brain/time`，含至少 4 个 `it(` 块
- `docs/current/README.md` 含 `/api/brain/time` 条目、三字段名、响应示例
- **（R4）** `packages/brain/server.js` 以命名导出暴露 `app`（`export const app = …` 或等价的 `export { app }`），这是 it#11 能导入真实 app 的基础
- **（R4）** `packages/brain/server.js` 的 DB / WS / 外部端口副作用顶层 await 必须被 `process.env.VITEST` 护栏块包住，使 `VITEST=true` 下 `import { app }` 不连 DB、不开端口
- **（R5 新增 #13）** `packages/brain/src/routes/time.js` 注释剥离后：无参 `new Date()` 字面量恰好 1 次 + `Date.now(` 字面量恰好 0 次（静态硬锁"单一 Date 快照"实现路径）
- **（R6 新增 #14）** Brain workspace 单测文件 `packages/brain/src/__tests__/routes-time.test.js` 必须能**实际跑过**：`cd packages/brain && npx vitest run src/__tests__/routes-time.test.js` exit 0 且输出含 `Tests  X passed`（`X ≥ 4`）——把 SC-001 由"静态文件形态"升级为"实跑过"，挡下 `it.skip` / 空 body / 未真连 router 的桩测试

---

## Workstreams

workstream_count: 1

### Workstream 1: Brain /api/brain/time 只读时间端点

**范围**:
- 新增 `packages/brain/src/routes/time.js`（Express Router，仅一个 `GET /` 处理函数；挂载前缀 `/api/brain/time`）
- 在 `packages/brain/server.js` 顶部 import 该路由，并在主中间件区挂载到 `/api/brain/time`（挂载变量名与 import 变量名一致）
- **（R4）** 将 `packages/brain/server.js` 中的 `const app = express()` 改为 `export const app = express()`（或在文件末尾追加 `export { app }`——允许与既有 `export default app;` 共存）
- **（R4）** 将 `packages/brain/server.js` 中会触发 DB / WS / 端口监听的顶层 `await` 调用链
  （`runMigrations` / `runSelfCheck` / `initConsciousnessGuard` / `loadActiveProfile` /
  `loadSpendingCapsFromDB` / `loadAuthFailuresFromDB` / `initWebSocketServer` / `initTickLoop` /
  `startFleetRefresh` / `initNarrativeTimer` / `startCeceliaBridge` / `listenWithRetry`）
  收进 `if (!process.env.VITEST)` 护栏块；中间件 + route 挂载 + error handler 保持顶层同步执行
- 新增单元测试 `packages/brain/src/__tests__/routes-time.test.js`（supertest，无 DB 依赖）
- 在 `docs/current/README.md` 中新增 `/api/brain/time` 条目（方法、路径、字段示例）
- **（R5 隐含）** `packages/brain/src/routes/time.js` 实现路径被静态锁死为单一 `const now = new Date(); … now.toISOString() … now.getTime() …` 形态——不允许出现第二个无参 `new Date()` 或任何 `Date.now(` 调用

**大小**: S（新增 <100 行 + server.js 2 处最小改动：1 行命名导出 + 1 层 VITEST 护栏包围）
**依赖**: 无（本 sprint 仅此一个 workstream）

**BEHAVIOR 覆盖测试文件**: `tests/ws1/time.test.js`（共 12 条 `it` 块；其中 9 条走合成 Express 合约断言，
1 条静态解析 server.js 验证挂载字面量，1 条（R4）直接导入 server.js 命名导出的 `app` 用 supertest 打真实端点，
1 条（**R5 新增 #12**）50 次连调强验 iso/unix 同秒严格相等）

**实现约束**（由合同强制，Generator 不可偏离）:
- 三字段 **必须来自同一个 `Date` 快照**——即 `const now = new Date()` 只调用一次，
  `iso` 来自 `now.toISOString()`，`unix` 来自 `Math.floor(now.getTime() / 1000)`，
  `timezone` 来自 `Intl.DateTimeFormat().resolvedOptions().timeZone`
- 因单一快照约束，`Math.floor(Date.parse(iso) / 1000)` 与 `unix` 必然严格相等（同秒）
- 不得引入新的 npm 依赖；只能使用已存在的 `express`
- 不得添加鉴权中间件、不得添加限流中间件、不得写 DB
- 在 `packages/brain/server.js` 中，import 变量名必须为 `timeRoutes`，且 `app.use('/api/brain/time', timeRoutes)` 严格字面量
- **（R4）** `packages/brain/server.js` 中 `const app = express()` 必须改写为 `export const app = express()`（或等价地保留既有 `const app = express()` 并在文件末尾追加 `export { app }`；可与 `export default app;` 共存）
- **（R4）** `packages/brain/server.js` 中所有会导致 DB 连接 / 端口监听 / 子进程启动的顶层 `await`
  必须收进 `if (!process.env.VITEST) { ... }` 护栏块；顶层同步代码只允许构造 `app` + 安装中间件 +
  挂 router + 定义 error handler
- **（R5 新增）** `packages/brain/src/routes/time.js` 的源码（注释剥离后）必须满足：
  无参 `new Date()` 字面量恰好 1 次；`Date.now(` 字面量 0 次。测试以正则 `/\bnew\s+Date\s*\(\s*\)/g`
  与 `/\bDate\s*\.\s*now\s*\(/g` 断言。合法实现（`const now = new Date(); now.toISOString(); now.getTime()`）
  自然满足；试图通过分别 `new Date()` / 分别 `Date.now()` 采样时间来凑数的反模式被 deterministic 挡住
- **（R6 新增）** Brain workspace 单测文件 `packages/brain/src/__tests__/routes-time.test.js`
  必须能在仓库根以 `cd packages/brain && npx vitest run src/__tests__/routes-time.test.js`
  实际跑通：exit code 0 且输出含 `Tests  X passed`（`X ≥ 4`）。此约束与 ARTIFACT #7/#8/#9
  的静态结构锁互补——静态锁保证文件存在且 `it(` 数量 ≥ 4 且含 supertest 字面量，但不能
  保证这些 `it` 真的测到行为；动态跑一遍把"桩测试 / `it.skip` / 空 body / 未真连 router"
  全部挡下。这也是 SC-001（`npm test` 在 Brain workspace 通过）的直接兑现

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据（Proposer 本地实跑） |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/time.test.js` | 12 条 `it`：200/JSON、三字段存在、iso 合规、timezone 非空、timezone IANA 合法、unix 秒级正整数（含 1e9 下限）、iso↔unix 同秒严格相等、连续两次调用同秒一致、无需鉴权、server.js 挂载可达、真实 app 命名导出 + supertest 端到端、**（R5 新增）50 次连调每次同秒相等** | `npx vitest run sprints/tests/ws1/time.test.js` → **12 failed**（Proposer 已实跑，见下方证据） |

**R6 本地 Red evidence**（Proposer 本地运行记录，12 条 it 全红，5.47s；R6 未改动测试文件，行为层 Red 证据与 R5 一致）:

```
RUN  v1.6.1 /workspace
Test Files  1 failed (1)
     Tests  12 failed (12)
  Duration  5.47s
```

R6 额外新增 ARTIFACT #14（动态运行 Brain workspace 单测）也处于 Red：Brain 单测文件
`packages/brain/src/__tests__/routes-time.test.js` 在 Green 阶段前尚不存在，`cd packages/brain && npx vitest run src/__tests__/routes-time.test.js` 必然 exit 非 0。

**R5 本地 Red evidence**（Proposer 本地运行记录，12 条 it 全红，5.53s）:

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
× sprints/tests/ws1/time.test.js > ... > can GET /api/brain/time against the real Brain app exported from server.js 5004ms
× sprints/tests/ws1/time.test.js > ... > fifty consecutive requests each satisfy strict iso/unix same-second equality

Test Files  1 failed (1)
     Tests  12 failed (12)
```

- 前 9 条失败源于 `Failed to load url ../../../packages/brain/src/routes/time.js`（TDD Red —— 实现尚不存在）
- 第 10 条（server.js 挂载静态解析）失败源于 server.js 中尚无 time 路由的 import 与 `app.use('/api/brain/time', …)`
- 第 11 条（R4 新增）因 server.js 当前没导出命名 `app` 且 DB 副作用顶层 `await` 未收进 VITEST 护栏，动态 `import()` 触发 `runMigrations` / `listenWithRetry` 等顶层链，在无 DB 时 **hang 至 5 秒超时后红**
- 第 12 条（**R5 新增**）失败源于 `createAppOrThrow()` 依赖的 `time.js` 尚不存在，50 次循环第 0 次就在 dynamic import 阶段炸

Generator 必须同时完成：① 新建 `time.js` 单一快照实现（`const now = new Date(); now.toISOString(); now.getTime(); Intl.DateTimeFormat().resolvedOptions().timeZone`，且静态源码里无参 `new Date()` 恰 1 次 + `Date.now(` 0 次）② 导出命名 `app` ③ VITEST 护栏包住 DB/端口副作用 ④ 接上 time router ⑤ 文档 → 12 条才全绿。
