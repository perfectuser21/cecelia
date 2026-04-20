# Sprint Contract Draft (Round 2)

> 本合同基于 `sprints/sprint-prd.md`（Brain `/api/brain/time` 端点 — Harness v2 闭环验证）起草。
> Scope = S 任务（总改动 <120 行），但为验证 B_task_loop 多 Task 派发，拆成 2 个独立 workstream。
>
> **Round 2 修订** — 响应 Round 1 Reviewer 反馈：
> 1. **风险 3（P1·HTTP 测试方式）**：新增 `createApp()` 工厂契约 + 显式禁用 `fetch` 打外部端口，WS1 测试一律通过 supertest 挂载 Brain 真实 `createApp()` 结果，杜绝 ECONNREFUSED 假红。
> 2. **风险 4（P1·iso 解析过宽）**：iso 硬阈值升级为严格 ISO-8601 正则（`T` 分隔符 + `Z`/带偏移量后缀），`2026-04-20` 这类"可解析但违背 FR-003"的字符串将被拒。
> 3. 补强 WS1 单元的拓扑：**路由挂载独立成 `packages/brain/src/app.js` 的 `createApp()` 工厂，server.js 调用该工厂获取 app**——这既让测试在无副作用前提下持有 Brain 真实 app，也保留 server.js 自身副作用（DB / tick / listen）的集中入口。

---

## Feature 1: `/api/brain/time` 只读端点返回稳定的三字段 JSON

**行为描述**:

任意调用方以 `GET` 方法请求 `/api/brain/time`，必得到 `200` 响应，`Content-Type` 以 `application/json` 开头，响应体是一个对象，**恰好包含 `iso` / `timezone` / `unix` 三个字段**，不多不少。

- `iso`：严格 ISO-8601 格式字符串（`YYYY-MM-DDTHH:mm:ss[.sss]` + `Z` 或 `±HH:MM`/`±HHMM` 后缀），裸日期 `YYYY-MM-DD` 或缺时区后缀的写法**不合格**
- `timezone`：非空字符串，取 IANA 时区名（如 `Asia/Shanghai`、`UTC`、`Etc/UTC`），不得为空或 `null`
- `unix`：整数（秒级 Unix 时间戳），Number 类型且 `Number.isInteger(unix) === true`

**硬阈值**:

- HTTP 状态码 `=== 200`
- 响应头 `content-type` 以 `application/json` 开头（允许 `; charset=utf-8` 后缀）
- `Object.keys(body).sort()` 结果严格等于 `['iso', 'timezone', 'unix']`
- `typeof body.iso === 'string'` 且 `body.iso` **必须匹配严格正则** `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/`（带 `T` 分隔符与时区后缀，仅靠 `new Date(...)` 能解析不够）
- `typeof body.timezone === 'string'` 且 `body.timezone.length > 0`
- `Number.isInteger(body.unix) === true`，且落在秒级合理窗口 `(1_577_836_800, 4_102_444_800)`，防止误把毫秒当秒
- `Math.abs(new Date(body.iso).getTime() / 1000 - body.unix) <= 2`（iso 与 unix 瞬时时间差 ≤ 2 秒）
- 端点无副作用：连续两次调用均返回 200 且结构一致，`timezone` 字段两次必须相等

**BEHAVIOR 覆盖**（落在 `tests/ws1/time-endpoint.test.ts` 里的真实 `it()`）:

- `it('responds 200 with application/json content-type')`
- `it('returns exactly three keys: iso, timezone, unix')`
- `it('iso field matches strict ISO-8601 regex with T separator and timezone suffix')`
- `it('timezone field is a non-empty string')`
- `it('unix field is an integer seconds timestamp within plausible window')`
- `it('iso and unix timestamps agree within 2 seconds')`
- `it('is idempotent: two sequential calls both return 200 with identical shape and timezone')`

**ARTIFACT 覆盖**（落在 `contract-dod-ws1.md`）:

- `packages/brain/src/routes/time.js` 存在，默认导出 Express Router
- `packages/brain/src/app.js` 存在，**具名导出 `createApp` 函数**，函数内构建一个 Express 实例并挂载 `/api/brain/time`，返回该实例（纯构造，无 DB 连接、无 listen、无 tick 副作用）
- `packages/brain/server.js` 从 `./src/app.js` 引入并调用 `createApp()` 得到 app 实例（替代过去在 server.js 顶部直接 `express()` 的写法）
- server.js 里仍能找到 `/api/brain/time` 字面量的路由注册痕迹（可以在 app.js 内，也可以在 server.js 内，二者取一即可）

---

## Feature 2: 响应结构契约 Schema + 文档说明

**行为描述**:

仓库里提供一份**可机读**的响应结构契约（JSON Schema 片段），供未来的测试与文档引用；同时 Brain API 文档入口里出现 `/api/brain/time` 的条目，至少包含路径 / 方法 / 响应字段三项信息。这两项都是静态产物，不涉及运行时行为。

**硬阈值**:

- 存在文件 `packages/brain/src/contracts/time-response.schema.json`，是合法 JSON
- Schema 声明 `type === "object"` 且 `required` 数组恰好含 `iso`、`timezone`、`unix` 三项（顺序不论）
- Schema `properties` 下声明 `iso` 为 `string`、`timezone` 为 `string`、`unix` 为 `integer`
- Schema `additionalProperties === false`（禁止多余字段）
- `docs/current/README.md` 中出现字面量 `/api/brain/time`
- `docs/current/README.md` 中同时出现 `iso`、`timezone`、`unix` 三个字段名（任意位置，不要求同一段落）

**BEHAVIOR 覆盖**（落在 `tests/ws2/schema-doc.test.ts` 里的真实 `it()`）:

- `it('schema file is valid JSON with object type and additionalProperties false')`
- `it('schema requires exactly iso, timezone, unix')`
- `it('schema declares correct field types (string/string/integer)')`
- `it('README documents /api/brain/time endpoint with all three fields')`

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

### Workstream 2: 响应 Schema 契约 + Brain API 文档补充

**范围**: 新建 `packages/brain/src/contracts/time-response.schema.json`（JSON Schema 片段，描述三字段结构），在 `docs/current/README.md` 里补充 `/api/brain/time` 端点说明（路径 / 方法 / 响应字段）。**不涉及** 路由代码、**不涉及** server.js / app.js。

**大小**: S（预计 <40 行：新建 1 个 schema 文件 + README 追加约 10-20 行说明）

**依赖**: 无（与 WS1 完全并行，文档中的端点说明与实际实现可独立撰写）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws2/schema-doc.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/time-endpoint.test.ts` | 200 + content-type / 恰好三字段 / iso 严格 ISO-8601 正则 / timezone 非空 / unix 整数且在秒级合理窗口 / iso-unix 一致 / 幂等 | `npx vitest run sprints/tests/ws1/` → 7 failures（因 `packages/brain/src/app.js` 不存在，`createApp` import 解析失败） |
| WS2 | `sprints/tests/ws2/schema-doc.test.ts` | schema JSON 合法 / required 恰好三字段 / types 正确 / README 含端点说明 | `npx vitest run sprints/tests/ws2/` → 4 failures（因 schema 文件不存在 + README 未含 `/api/brain/time` 字面量） |

### 测试方式硬约束（Round 2 新增，回应 Reviewer 风险 3）

- **WS1 测试必须通过 `supertest(app)` 调用 `createApp()` 返回的 Brain Express app 实例**；禁止依赖外部监听端口（例如 `fetch('http://localhost:5221/...')`），避免 CI 无法启动 Brain 时因 ECONNREFUSED 产生"伪红"。
- `createApp()` 必须是**纯构造**：被 `import` 后不得触发 DB 连接、不得 `app.listen()`、不得启动 tick loop 或任何后台调度；所有副作用仍留在 `server.js` 的 `start()` 路径。
- `packages/brain/server.js` 必须从 `./src/app.js` 引入 `createApp` 并在启动流程中调用它获取 app；**严禁**在 server.js 顶层再写 `const app = express()`（同一仓库两处 app 源会让测试与运行态割裂）。
- 测试运行环境：workspace 根目录（`/workspace`）下的 `node_modules` 已装 `vitest` / `supertest` / `express`，Proposer 本地用 `cd /workspace && npx vitest run sprints/tests/wsN/` 跑通 Red；Harness Generator 与 Reviewer 必须使用相同目录与命令，TS 文件走 vitest 内置 esbuild transform，无需额外 `tsconfig` / `vitest.config.ts`。

### 测试强度硬约束（防弱断言）

- 每个 `it()` 只做单一行为断言；禁止 `expect(x).toBeTruthy()` / `expect(x).not.toBeNull()` 这类弱断言代替精确值比较。
- iso 字段必须命中严格 ISO-8601 正则 `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/`；不允许把 `new Date(body.iso).getTime()` 的有限性作为唯一判定条件。
- unix 字段必须命中秒级窗口 `(1_577_836_800, 4_102_444_800)`，拦截实现者误返毫秒级时间戳。
