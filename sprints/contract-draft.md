# Sprint Contract Draft (Round 1)

> 本合同基于 `sprints/sprint-prd.md`（Brain `/api/brain/time` 端点 — Harness v2 闭环验证）起草。
> Scope = S 任务（总改动 <100 行），但为验证 B_task_loop 多 Task 派发，拆成 2 个独立 workstream。

---

## Feature 1: `/api/brain/time` 只读端点返回稳定的三字段 JSON

**行为描述**:

任意调用方以 `GET` 方法请求 `/api/brain/time`，必得到 `200` 响应，`Content-Type` 以 `application/json` 开头，响应体是一个对象，**恰好包含 `iso` / `timezone` / `unix` 三个字段**，不多不少。

- `iso`：ISO-8601 格式字符串（`YYYY-MM-DDTHH:mm:ss[.sss]Z` 或带偏移量的等价形式）
- `timezone`：非空字符串，取 IANA 时区名（如 `Asia/Shanghai`、`UTC`、`Etc/UTC`），不得为空或 `null`
- `unix`：整数（秒级 Unix 时间戳），Number 类型且 `Number.isInteger(unix) === true`

**硬阈值**:

- HTTP 状态码 `=== 200`
- 响应头 `content-type` 以 `application/json` 开头（允许 `; charset=utf-8` 后缀）
- `Object.keys(body).sort()` 结果严格等于 `['iso', 'timezone', 'unix']`
- `typeof body.iso === 'string'` 且 `body.iso` 能被 `new Date(body.iso).getTime()` 正确解析为有限数字
- `typeof body.timezone === 'string'` 且 `body.timezone.length > 0`
- `Number.isInteger(body.unix) === true`
- `Math.abs(new Date(body.iso).getTime() / 1000 - body.unix) <= 2`（iso 与 unix 瞬时时间差 ≤ 2 秒）
- 端点无副作用：连续两次调用均返回 200 且结构一致

**BEHAVIOR 覆盖**（落在 `tests/ws1/time-endpoint.test.ts` 里的真实 `it()`）:

- `it('responds 200 with application/json content-type')`
- `it('returns exactly three keys: iso, timezone, unix')`
- `it('iso field is a parseable ISO-8601 string')`
- `it('timezone field is a non-empty string')`
- `it('unix field is an integer seconds timestamp')`
- `it('iso and unix timestamps agree within 2 seconds')`
- `it('is idempotent: two sequential calls both return 200 with same shape')`

**ARTIFACT 覆盖**（落在 `contract-dod-ws1.md`）:

- `packages/brain/src/routes/time.js` 存在，默认导出 Express Router
- `packages/brain/server.js` 里通过 `app.use('/api/brain/time', ...)` 或 `app.use('/api/brain', ...)`（含 time 子路由）挂载新路由
- `packages/brain/server.js` 里含 `import ... from './src/routes/time.js'`

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
- `docs/current/README.md` 中包含 `iso`、`timezone`、`unix` 三个字段名的文档描述（任意位置，不要求在同一段落）

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

### Workstream 1: 新增 `/api/brain/time` 路由与挂载

**范围**: 新建 `packages/brain/src/routes/time.js`（Express Router，导出默认路由），在 `packages/brain/server.js` 用 `app.use('/api/brain/time', ...)` 挂载。**不涉及** Schema 文件、**不涉及** 文档改动。

**大小**: S（预计 <30 行代码改动：新增 1 个路由文件 + server.js 2 行 import/use）

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/time-endpoint.test.ts`

### Workstream 2: 响应 Schema 契约 + Brain API 文档补充

**范围**: 新建 `packages/brain/src/contracts/time-response.schema.json`（JSON Schema 片段，描述三字段结构），在 `docs/current/README.md` 里补充 `/api/brain/time` 端点说明（路径 / 方法 / 响应字段）。**不涉及** 路由代码、**不涉及** server.js。

**大小**: S（预计 <40 行：新建 1 个 schema 文件 + README 追加约 10-20 行说明）

**依赖**: 无（与 WS1 完全并行，文档中的端点说明与实际实现可独立撰写）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws2/schema-doc.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/time-endpoint.test.ts` | 200 + content-type / 恰好三字段 / iso 可解析 / timezone 非空 / unix 整数 / iso-unix 一致 / 幂等 | `npx vitest run sprints/tests/ws1/` → 7 failures（因 `packages/brain/src/routes/time.js` 不存在） |
| WS2 | `sprints/tests/ws2/schema-doc.test.ts` | schema JSON 合法 / required 恰好三字段 / types 正确 / README 含端点说明 | `npx vitest run sprints/tests/ws2/` → 4 failures（因 schema 文件不存在 + README 未含 `/api/brain/time` 字面量） |
