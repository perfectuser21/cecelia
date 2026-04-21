# Sprint Contract Draft (Round 4)

本合同由 Proposer 针对 `sprints/sprint-prd.md`（Brain `/api/brain/time` 端点）起草，
进入 GAN 对抗。合同外一字不加，Generator 须严格按本合同实现。

> **Round 4 修订说明**（响应 Round 3 Reviewer 阻断反馈）：
> **阻断点**：Round 3 里 10 条 BEHAVIOR 全部跑在 `createAppOrThrow()` 合成的迷你 Express 上，
> 唯一"接触真实 server.js"的第 10 条是**静态文本解析**（grep import/app.use 字面量），
> 与 PRD US-001 / SC-002「跑起来的 Brain 能被外部 GET 到」之间存在可被绕过的缝隙。
> 构造合法 `time.js` + 合法文本挂载、但实际 app 实例不接 router 的 bug，仍能通过 R3 全部断言。
>
> **Round 4 修复**（核心）：
> 1. **新增 BEHAVIOR it#11**「can GET /api/brain/time against the real Brain app exported from server.js」——
>    直接 `import { app } from '../../../../packages/brain/server.js'`，用 supertest 对**真实 Express 应用**
>    打 `GET /api/brain/time`，断言 `status === 200`、`Content-Type` 开头为 `application/json`、
>    `res.body.iso / timezone / unix` 均存在且非空、`Math.floor(Date.parse(iso)/1000) === unix`。
>    这一条同时闭合了"import 变量名 + app.use 字面量 + 真实 app 实例"三者的一致性，是 PRD 意图的唯一终局证据。
> 2. **新增 ARTIFACT #11**：`packages/brain/server.js` 必须以命名导出形式暴露 `app`（`export const app = …`
>    或等价的 `export { app }`）。若不导出，it#11 的 `mod.app` 为 undefined，supertest 会立即炸——
>    这是对 Generator "最小重构 server.js"的硬契约。
> 3. **新增 ARTIFACT #12**：`packages/brain/server.js` 中会触发数据库/WS/外部端口副作用的顶层 `await`
>    调用链（`runMigrations` / `runSelfCheck` / `initConsciousnessGuard` / `loadActiveProfile` /
>    `loadSpendingCapsFromDB` / `loadAuthFailuresFromDB` / `listenWithRetry` / `initWebSocketServer` /
>    `initTickLoop` / `startFleetRefresh` / `initNarrativeTimer` / `startCeceliaBridge`）**必须收进
>    `if (!process.env.VITEST)` 护栏块**（或等价护栏，但必须以字符串 `process.env.VITEST` 作为判定锚点），
>    使得在 `VITEST=true` 下 `import { app } from server.js` 只建 app + 挂 router，不连 DB、不开端口、不起定时器。
>    这是让 it#11 能在无 DB、无网络的 CI 环境里跑起来的基础设施契约。
>
> **次要观察（Reviewer 留痕，本轮暂不调整）**：
> - ARTIFACT "含 `toISOString` / `getTime` / `resolvedOptions` 三个调用" 是**实现锁**而非缺陷检测——
>   被 "日志里打印 `getTime()` 返回值" 等合规写法命中也允许；真正兜住"单一快照"语义的是 it#7
>   `Math.floor(Date.parse(iso)/1000) === unix` 的严格相等。保留现状。
> - `timezone` 合法性依赖 Node/ICU 完整 tzdata。标准 `node:18+` 官方镜像满足；裁剪镜像（small-icu）
>   属 PRD 假设之外的运维面，不在本合同打击范围，留言不处理。
>
> **Round 3 修订说明**（保留）：
> 1. 测试文件由 `.ts` 改为 `.js`，与 Brain workspace 同语言（`type: module` ESM JS），消除 TS 解析链疑虑。
> 2. 删除 ARTIFACT "`new Date(` 文本恰好 1 次"约束（避免 Generator 写注释/示例时被字符匹配误伤）。
>    "单一快照"语义改由行为断言强等兜底。
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
  `Math.floor(Date.parse(iso) / 1000) === unix`（不允许任何秒级偏差——这是"单一 `new Date()` 快照"语义的真正兜底）
- 连续两次调用均返回 200，每次响应内部仍满足上述所有阈值（无状态污染）
- **（R4 新增）** 从 `packages/brain/server.js` 的**命名导出 `app`** 以 supertest 打 `GET /api/brain/time`，
  必须返回 200、`Content-Type` 以 `application/json` 开头，且 body 含 `iso / timezone / unix` 三字段；
  `Math.floor(Date.parse(iso) / 1000) === unix` 仍成立。这一条是 PRD US-001 / SC-002 的终局兜底，
  确保 time router 不只是挂载在合成 app，而是挂载在生产 Brain 的真实 app 实例上

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
- `it('can GET /api/brain/time against the real Brain app exported from server.js')`（**R4 新增 #11**）

**ARTIFACT 覆盖**（落入 `contract-dod-ws1.md`）:
- `packages/brain/src/routes/time.js` 存在，使用 `express.Router()` 并 `export default` 一个 Router 实例
- 路由文件含 `toISOString`、`getTime`、`resolvedOptions` 三个调用（实现锁，非缺陷检测；真正兜住"单一快照"的是行为断言 it#7）
- `packages/brain/server.js` 用 ESM import 引入该路由，指向 `./src/routes/time.js`
- `packages/brain/server.js` 的 `app.use('/api/brain/time', <varname>)` 挂载变量与 import 变量**同名**（避免错挂）
- 单元测试文件 `packages/brain/src/__tests__/routes-time.test.js` 存在，使用 `supertest` 发 `GET /api/brain/time`，含至少 4 个 `it(` 块
- `docs/current/README.md` 含 `/api/brain/time` 条目、三字段名、响应示例
- **（R4 新增）** `packages/brain/server.js` 以命名导出暴露 `app`（`export const app = …` 或等价的 `export { app }`），这是 it#11 能导入真实 app 的基础
- **（R4 新增）** `packages/brain/server.js` 的 DB / WS / 外部端口副作用顶层 await 必须被 `process.env.VITEST` 护栏块包住，使 `VITEST=true` 下 `import { app }` 不连 DB、不开端口

---

## Workstreams

workstream_count: 1

### Workstream 1: Brain /api/brain/time 只读时间端点

**范围**:
- 新增 `packages/brain/src/routes/time.js`（Express Router，仅一个 `GET /` 处理函数；挂载前缀 `/api/brain/time`）
- 在 `packages/brain/server.js` 顶部 import 该路由，并在主中间件区挂载到 `/api/brain/time`（挂载变量名与 import 变量名一致）
- **（R4 新增）** 将 `packages/brain/server.js` 中的 `const app = express()` 改为 `export const app = express()`（或在文件末尾追加 `export { app }`）
- **（R4 新增）** 将 `packages/brain/server.js` 中会触发 DB / WS / 端口监听的顶层 `await` 调用链
  （`runMigrations` / `runSelfCheck` / `initConsciousnessGuard` / `loadActiveProfile` /
  `loadSpendingCapsFromDB` / `loadAuthFailuresFromDB` / `initWebSocketServer` / `initTickLoop` /
  `startFleetRefresh` / `initNarrativeTimer` / `startCeceliaBridge` / `listenWithRetry`）
  收进 `if (!process.env.VITEST)` 护栏块；中间件 + route 挂载 + error handler 保持顶层同步执行
- 新增单元测试 `packages/brain/src/__tests__/routes-time.test.js`（supertest，无 DB 依赖）
- 在 `docs/current/README.md` 中新增 `/api/brain/time` 条目（方法、路径、字段示例）

**大小**: S（新增 <100 行 + server.js 2 处最小改动：1 行导出 + 1 层 VITEST 护栏包围）
**依赖**: 无（本 sprint 仅此一个 workstream）

**BEHAVIOR 覆盖测试文件**: `tests/ws1/time.test.js`（共 11 条 `it` 块；其中 9 条走合成 Express 合约断言，
1 条静态解析 server.js 验证挂载字面量，1 条（**R4 新增**）直接导入 server.js 命名导出的 `app` 用 supertest 打真实端点）

**实现约束**（由合同强制，Generator 不可偏离）:
- 三字段 **必须来自同一个 `Date` 快照**——即 `const now = new Date()` 只调用一次，
  `iso` 来自 `now.toISOString()`，`unix` 来自 `Math.floor(now.getTime() / 1000)`，
  `timezone` 来自 `Intl.DateTimeFormat().resolvedOptions().timeZone`
- 因单一快照约束，`Math.floor(Date.parse(iso) / 1000)` 与 `unix` 必然严格相等（同秒），测试按此严格断言
- 不得引入新的 npm 依赖；只能使用已存在的 `express`
- 不得添加鉴权中间件、不得添加限流中间件、不得写 DB
- 在 `packages/brain/server.js` 中，import 变量名必须为 `timeRoutes`，且 `app.use('/api/brain/time', timeRoutes)` 严格字面量（消歧，避免挂载/import 错位）
- **（R4 新增）** `packages/brain/server.js` 中 `const app = express()` 必须改写为 `export const app = express()`
  （或等价的文件末尾 `export { app }`），使 it#11 可通过 `import { app } from '.../server.js'` 拿到真实实例
- **（R4 新增）** `packages/brain/server.js` 中所有会导致 DB 连接 / 端口监听 / 子进程启动的顶层 `await`
  必须收进 `if (!process.env.VITEST) { ... }` 护栏块；顶层同步代码只允许构造 `app` + 安装中间件 +
  挂 router + 定义 error handler。test 文件是否自行设置 `process.env.VITEST` 无关紧要（vitest 1.6.1
  运行时自动注入 `VITEST='true'`），护栏必须字面量命中 `process.env.VITEST`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据（Proposer 本地实跑） |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/time.test.js` | 11 条 `it`：200/JSON、三字段存在、iso 合规、timezone 非空、timezone IANA 合法、unix 秒级正整数（含 1e9 下限）、iso↔unix 同秒严格相等、连续两次调用同秒一致、无需鉴权、server.js 挂载可达、**（R4 新增）真实 app 命名导出 + supertest 端到端** | `npx vitest run sprints/tests/ws1/time.test.js` → **11 failed**（Proposer 已实跑，见下方证据） |

**R4 本地 Red evidence**（Proposer 本地运行记录，11 条 it 全红）:

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
× sprints/tests/ws1/time.test.js > ... > can GET /api/brain/time against the real Brain app exported from server.js

Test Files  1 failed (1)
     Tests  11 failed (11)
```

前 9 条失败源于 `Failed to load url ../../../packages/brain/src/routes/time.js`（TDD Red —— 实现尚不存在）；
第 10 条（server.js 挂载静态解析）失败源于 server.js 中尚无 time 路由的 import 与 `app.use('/api/brain/time', …)`；
第 11 条（**R4 新增**）失败源于 server.js 当前既没导出 `app`（`const app = express()` 是模块私有），也没把 DB 副作用收进 VITEST 护栏（动态导入会触发 `runMigrations` 等顶层 `await` 链，无 DB 时抛错）——
Generator 必须同时完成"导出 app + 护栏包住副作用 + 接上 time router"三件事，第 11 条才能 Green。
