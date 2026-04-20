# Sprint Contract Draft (Round 3)

> 本合同基于 `sprints/sprint-prd.md`（Brain `/api/brain/time` 端点 — Harness v2 闭环验证）起草。
> Scope = S 任务（总改动 <120 行），但为验证 B_task_loop 多 Task 派发，拆成 2 个独立 workstream。
>
> **Round 3 修订** — 响应 Round 2 Reviewer **P0 否决点**：
> 1. **Risk 1（P0·实时性未锁）**：Round 2 的所有 WS1 断言都可以被**硬编码固定时间戳**的实现蒙过——邪恶实现只要返回恒定的 `{iso: "2026-04-20T12:00:00Z", timezone: "UTC", unix: 1745150400}`，就能命中格式正则、三字段、窗口、iso-unix 一致、幂等所有条件。这对一个声称返回"当前时间"的端点是实质性失守。**本轮新增两条实时性断言**：
>    - `unix` 字段必须贴近测试观察者的 `Date.now() / 1000`（差值 ≤ 10 秒，排除硬编码任意时间戳的作弊）
>    - 两次调用间隔 1500ms 后，第二次的 `unix` **严格大于**第一次（排除"锁死固定时间戳"但还能骗过窗口检查的实现）
> 2. **WS2·邻近性 + format 锁定**（P1·可绕过）：Round 2 的 README 断言允许 `/api/brain/time` 与 `iso/timezone/unix` 在文档里任意分散。本轮升级为"**`/api/brain/time` 字面量出现后 30 行内必须三字段齐全**"，拒绝"三字段在文档上半部偶然出现、端点段落完全无字段描述"的假装文档。同时采纳 Reviewer 建议，要求 Schema 的 `properties.iso.format === 'date-time'`（让 Schema 与 ISO-8601 正则对齐）。
>
> **Round 2 保留修订**（未被挑战，继续有效）：
> - `createApp()` 工厂契约 + supertest 内存调用，禁 fetch 打外部端口，杜绝 ECONNREFUSED 假红。
> - `iso` 使用严格 ISO-8601 正则（`T` 分隔符 + `Z`/带偏移量后缀），裸日期 `YYYY-MM-DD` 不合格。
> - `unix` 锁秒级窗口 `(1_577_836_800, 4_102_444_800)`，防毫秒级误返。

---

## Feature 1: `/api/brain/time` 只读端点返回**当前**时间的稳定三字段 JSON

**行为描述**:

任意调用方以 `GET` 方法请求 `/api/brain/time`，必得到 `200` 响应，`Content-Type` 以 `application/json` 开头，响应体恰好包含 `iso` / `timezone` / `unix` 三字段，不多不少，**且这三个字段共同反映的是调用瞬间的真实 wall-clock 时间**——不是硬编码、不是部署时刻、不是任意一个满足格式的字符串。

- `iso`：严格 ISO-8601 格式字符串（`YYYY-MM-DDTHH:mm:ss[.sss]` + `Z` 或 `±HH:MM`/`±HHMM` 后缀），裸日期 `YYYY-MM-DD` 或缺时区后缀的写法**不合格**
- `timezone`：非空字符串，IANA 时区名（如 `Asia/Shanghai`、`UTC`、`Etc/UTC`），不得为空或 `null`
- `unix`：整数（秒级 Unix 时间戳），Number 类型且 `Number.isInteger(unix) === true`，**必须贴近调用时的系统真实时间**

**硬阈值**:

- HTTP 状态码 `=== 200`
- 响应头 `content-type` 以 `application/json` 开头（允许 `; charset=utf-8` 后缀）
- `Object.keys(body).sort()` 结果严格等于 `['iso', 'timezone', 'unix']`
- `typeof body.iso === 'string'` 且 `body.iso` **必须匹配严格正则** `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/`
- `typeof body.timezone === 'string'` 且 `body.timezone.length > 0`
- `Number.isInteger(body.unix) === true`，且落在秒级合理窗口 `(1_577_836_800, 4_102_444_800)`
- `Math.abs(new Date(body.iso).getTime() / 1000 - body.unix) <= 2`（iso 与 unix 一致）
- **【Round 3 新增】实时性窗口**：`Math.abs(body.unix - Math.floor(Date.now() / 1000)) <= 10`——端点返回的 unix 必须贴近测试观察者的 wall-clock 时间（差值 ≤ 10 秒，留出容器调度与 supertest 开销的容差）。硬编码任意过去/未来时间的实现直接挂掉。
- **【Round 3 新增】时间推进**：两次调用之间间隔至少 1500ms 后，`body_second.unix - body_first.unix >= 1`（严格递增）。锁死固定值的实现命中此断言失败。
- 端点无副作用：连续两次调用均返回 200 且结构一致，`timezone` 字段两次必须相等

**BEHAVIOR 覆盖**（落在 `tests/ws1/time-endpoint.test.ts` 里的真实 `it()`）:

- `it('responds 200 with application/json content-type')`
- `it('returns exactly three keys: iso, timezone, unix')`
- `it('iso field matches strict ISO-8601 regex with T separator and timezone suffix')`
- `it('timezone field is a non-empty string')`
- `it('unix field is an integer seconds timestamp within plausible window')`
- `it('iso and unix timestamps agree within 2 seconds')`
- `it('is idempotent: two sequential calls both return 200 with identical shape and timezone')`
- **【Round 3 新增】** `it('unix value tracks observer wall-clock within 10 seconds (rejects hardcoded timestamp)')`
- **【Round 3 新增】** `it('unix advances: second call after 1500ms sleep is strictly greater than first call')`

**ARTIFACT 覆盖**（落在 `contract-dod-ws1.md`）:

- `packages/brain/src/routes/time.js` 存在，默认导出 Express Router
- `packages/brain/src/app.js` 存在，**具名导出 `createApp` 函数**，纯构造（无 DB 连接、无 listen、无 tick 副作用）
- `packages/brain/server.js` 从 `./src/app.js` 引入并调用 `createApp()` 得到 app 实例
- server.js 里仍能找到 `/api/brain/time` 字面量的路由注册痕迹（app.js 或 server.js 二者取一即可）

---

## Feature 2: 响应结构契约 Schema + 文档说明（端点段落邻近性）

**行为描述**:

仓库里提供一份**可机读**的响应结构契约（JSON Schema 片段），供未来的测试与文档引用；同时 Brain API 文档入口里出现 `/api/brain/time` 的**成段说明**（路径 / 方法 / 响应字段在同一段落/邻近 30 行内），不是散落在全文档的字面量碎片。

**硬阈值**:

- 存在文件 `packages/brain/src/contracts/time-response.schema.json`，是合法 JSON
- Schema 声明 `type === "object"` 且 `required` 数组恰好含 `iso`、`timezone`、`unix` 三项（顺序不论）
- Schema `properties` 下声明 `iso` 为 `string`、`timezone` 为 `string`、`unix` 为 `integer`
- Schema `additionalProperties === false`（禁止多余字段）
- **【Round 3 新增】** Schema `properties.iso.format === 'date-time'`（与端点返回的严格 ISO-8601 正则语义对齐，采纳 Reviewer 建议）
- `docs/current/README.md` 中出现字面量 `/api/brain/time`
- **【Round 3 升级】** `docs/current/README.md` 中 `/api/brain/time` 字面量**首次出现所在行之后的 30 行窗口内**必须同时出现 `iso`、`timezone`、`unix` 三个字段名（杜绝"端点提一嘴、字段散在别处偶然命中"的假装文档）

**BEHAVIOR 覆盖**（落在 `tests/ws2/schema-doc.test.ts` 里的真实 `it()`）:

- `it('schema file is valid JSON with object type and additionalProperties false')`
- `it('schema requires exactly iso, timezone, unix')`
- `it('schema declares correct field types (string/string/integer)')`
- `it('README documents /api/brain/time endpoint with all three fields')`（保留，继续验基线字面量）
- **【Round 3 新增】** `it('schema declares properties.iso.format as date-time')`
- **【Round 3 新增】** `it('README mentions iso/timezone/unix within 30 lines after the /api/brain/time endpoint line')`

**ARTIFACT 覆盖**（落在 `contract-dod-ws2.md`）:

- `packages/brain/src/contracts/time-response.schema.json` 文件存在
- `docs/current/README.md` 含 `/api/brain/time` 字面量
- `docs/current/README.md` 同时含 `iso`、`timezone`、`unix` 三个字段名

---

## Workstreams

workstream_count: 2

### Workstream 1: `/api/brain/time` 路由 + `createApp()` 工厂 + server.js 挂载

**范围**: 新建 `packages/brain/src/routes/time.js`（Express Router）；新建 `packages/brain/src/app.js` 暴露 `createApp()`（纯构造，无副作用），内部 `app.use('/api/brain/time', timeRouter)`；改 `packages/brain/server.js` 用 `createApp()` 获取 app 实例。**不涉及** Schema 文件、**不涉及** 文档改动。

**大小**: S（预计 <80 行代码改动：新增 `routes/time.js` ≈20 行 + 新增 `src/app.js` ≈15-30 行 + server.js 改 2-5 行）

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/time-endpoint.test.ts`

### Workstream 2: 响应 Schema 契约 + Brain API 文档补充（段落邻近性）

**范围**: 新建 `packages/brain/src/contracts/time-response.schema.json`（JSON Schema 片段，描述三字段结构，含 `iso.format: date-time`），在 `docs/current/README.md` 里补充 `/api/brain/time` 端点**成段说明**（路径 / 方法 / 响应字段在同一段落，30 行内三字段齐全）。**不涉及** 路由代码、**不涉及** server.js / app.js。

**大小**: S（预计 <40 行：新建 1 个 schema 文件 + README 追加约 10-20 行说明）

**依赖**: 无（与 WS1 完全并行）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws2/schema-doc.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/time-endpoint.test.ts` | 200 + content-type / 恰好三字段 / iso 严格 ISO-8601 正则 / timezone 非空 / unix 整数且在秒级窗口 / iso-unix 一致 / 幂等 / **unix 贴近 wall-clock** / **unix 随时间严格递增** | `npx vitest run sprints/tests/ws1/` → 9 failures（`packages/brain/src/app.js` 不存在，`createApp` import 解析失败） |
| WS2 | `sprints/tests/ws2/schema-doc.test.ts` | schema JSON 合法 / required 恰好三字段 / types 正确 / README 含端点 / **schema iso.format=date-time** / **README 30 行邻近性** | `npx vitest run sprints/tests/ws2/` → 6 failures（schema 文件不存在 + README 未含 `/api/brain/time`） |

### 测试方式硬约束（Round 2 保留）

- **WS1 测试必须通过 `supertest(app)` 调用 `createApp()` 返回的 Brain Express app 实例**；禁止依赖外部监听端口（例如 `fetch('http://localhost:5221/...')`），避免 CI 无法启动 Brain 时因 ECONNREFUSED 产生"伪红"。
- `createApp()` 必须是**纯构造**：被 `import` 后不得触发 DB 连接、不得 `app.listen()`、不得启动 tick loop 或任何后台调度；所有副作用仍留在 `server.js` 的 `start()` 路径。
- `packages/brain/server.js` 必须从 `./src/app.js` 引入 `createApp` 并在启动流程中调用它获取 app；**严禁**在 server.js 顶层再写 `const app = express()`（同一仓库两处 app 源会让测试与运行态割裂）。
- 测试运行环境：workspace 根目录（`/workspace`）下的 `node_modules` 已装 `vitest` / `supertest` / `express`，Proposer 本地用 `cd /workspace && npx vitest run sprints/tests/wsN/` 跑通 Red；Harness Generator 与 Reviewer 必须使用相同目录与命令，TS 文件走 vitest 内置 esbuild transform，无需额外 `tsconfig` / `vitest.config.ts`。

### 测试强度硬约束（Round 3 强化反 Mutation）

- 每个 `it()` 只做单一行为断言；禁止 `expect(x).toBeTruthy()` / `expect(x).not.toBeNull()` 这类弱断言代替精确值比较。
- iso 字段必须命中严格 ISO-8601 正则 `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/`；不允许把 `new Date(body.iso).getTime()` 的有限性作为唯一判定条件。
- unix 字段必须命中秒级窗口 `(1_577_836_800, 4_102_444_800)`，拦截实现者误返毫秒级时间戳。
- **【Round 3 新增反 Mutation 专项】** **实时性锚点**：`unix` 字段必须在测试执行的 ±10 秒范围内锚定到 `Math.floor(Date.now()/1000)`——任何硬编码（无论编译期还是启动期固定时间戳）都会随着 CI 时钟推进而越飘越远，注定破防。
- **【Round 3 新增反 Mutation 专项】** **时间推进**：两次调用间隔 1500ms，第二次 `unix - 第一次 unix >= 1`——锁死固定值的实现直接命中 `strictly greater` 失败；这条断言要求实现必须在**每次请求处理时**计算时间，而不是在模块加载或启动时计算一次后复用。
