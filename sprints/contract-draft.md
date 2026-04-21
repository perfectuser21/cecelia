# Sprint Contract Draft (Round 1)

PRD: `sprints/sprint-prd.md`（不改）
Planner 分支: `cp-04211712-harness-prd`
Propose 轮次: 1
Proposer 分支: `cp-harness-propose-r1-04211712`

---

## Feature 1: Time formatting utilities（纯函数层）

**行为描述**: 提供两个纯函数供后续 HTTP 层复用，避免路由层与时区库直接耦合。
- `isValidTimeZone(tz)` 判断给定字符串是否为运行时承认的 IANA 时区名。
- `formatIsoAtTz(date, tz)` 把一个绝对时间（`Date` 实例）按指定 IANA 时区的 UTC 偏移格式化为 ISO-8601 字符串。

**硬阈值**:
- `isValidTimeZone('UTC')` 返回 `true`
- `isValidTimeZone('Asia/Shanghai')` 返回 `true`
- `isValidTimeZone('Foo/Bar')` 返回 `false`（非法 IANA 名）
- `isValidTimeZone('')` 返回 `false`（空串视为无效输入，由调用方决定是否走默认分支）
- `isValidTimeZone(undefined)` 返回 `false`
- `formatIsoAtTz(date, tz)` 返回字符串匹配 `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/`
- `new Date(formatIsoAtTz(input, tz)).getTime() === input.getTime()`（解析回原始绝对瞬间）
- `formatIsoAtTz(date, 'Asia/Shanghai')` 返回以 `+08:00` 结尾
- `formatIsoAtTz(date, 'UTC')` 返回以 `Z` 或 `+00:00` 结尾

**BEHAVIOR 覆盖**（落在 `tests/ws1/time-format.test.ts`）:
- `it('isValidTimeZone returns true for UTC')`
- `it('isValidTimeZone returns true for Asia/Shanghai')`
- `it('isValidTimeZone returns false for invalid IANA name Foo/Bar')`
- `it('isValidTimeZone returns false for empty string')`
- `it('isValidTimeZone returns false for undefined')`
- `it('formatIsoAtTz outputs ISO-8601 with offset suffix')`
- `it('formatIsoAtTz roundtrips to the same instant')`
- `it('formatIsoAtTz applies +08:00 offset for Asia/Shanghai')`
- `it('formatIsoAtTz applies zero offset for UTC')`

**ARTIFACT 覆盖**（落在 `contract-dod-ws1.md`）:
- `packages/brain/src/utils/time-format.js` 文件存在
- 模块导出 `isValidTimeZone` 命名导出
- 模块导出 `formatIsoAtTz` 命名导出
- `packages/brain/package.json` `dependencies` 未新增条目（PRD 假设成立）

---

## Feature 2: GET /api/time HTTP 端点

**行为描述**: 在 Brain Express 应用注册新路由，按 PRD 场景 1-4 返回当前时间三元组；路由层只做参数解析与响应组装，时区合法性判断与 ISO 格式化委托给 Feature 1。

**硬阈值**:
- `GET /api/time` 返回 HTTP 200，JSON body 同时包含 `iso`（string）/`timezone`（string）/`unix`（number）三个字段
- `iso` 匹配 `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/`
- `Number.isInteger(unix) === true`
- `Math.abs(Math.floor(new Date(iso).getTime() / 1000) - unix) <= 2`
- `GET /api/time?tz=Asia/Shanghai`：HTTP 200；`timezone === 'Asia/Shanghai'`；`iso` 以 `+08:00` 结尾
- `GET /api/time?tz=UTC`：HTTP 200；`timezone === 'UTC'`；`iso` 以 `Z` 或 `+00:00` 结尾
- `GET /api/time?tz=Foo/Bar`：HTTP 400；body JSON 含 `error` 字段且 `/tz|timezone/i` 匹配
- `GET /api/time?tz=`（空串）：HTTP 200，走默认分支，`timezone` 字段长度 > 0
- 相邻两次 `GET /api/time` 请求：`|unix₂ - unix₁| ≤ 1`；`timezone₂ === timezone₁`

**BEHAVIOR 覆盖**（落在 `tests/ws2/time-endpoint.test.ts`）:
- `it('GET /api/time returns 200 with iso, timezone, unix fields')`
- `it('iso field matches ISO-8601 with offset')`
- `it('unix field is an integer')`
- `it('iso parses back to within 2 seconds of unix')`
- `it('GET /api/time?tz=Asia/Shanghai echoes timezone and uses +08:00 offset')`
- `it('GET /api/time?tz=UTC echoes timezone with zero offset')`
- `it('GET /api/time?tz=Foo/Bar returns 400 with error message mentioning tz')`
- `it('GET /api/time?tz= (empty string) falls back to default and returns 200')`
- `it('two adjacent requests return unix within 1 second of each other')`

**ARTIFACT 覆盖**（落在 `contract-dod-ws2.md`）:
- `packages/brain/src/routes/time.js` 文件存在
- 该模块 default export 一个 Express Router
- 该模块从 `../utils/time-format.js` 导入（不重复实现时区判断/格式化）
- `packages/brain/server.js` 含 `app.use('/api/time', ...)` 注册行
- `packages/brain/server.js` 含对 `./src/routes/time.js` 的 import 行

---

## Workstreams

workstream_count: 2

### Workstream 1: Time formatting utilities

**范围**: 新增 `packages/brain/src/utils/time-format.js`，导出 `isValidTimeZone(tz)` 与 `formatIsoAtTz(date, tz)` 两个纯函数。**不**接触 Express、`server.js`、`routes/`、数据库。
**大小**: S（<100 行含注释）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/time-format.test.ts`

### Workstream 2: GET /api/time endpoint

**范围**: 新增 `packages/brain/src/routes/time.js`（Express Router），实现三个分支（默认 / 指定时区 / 非法时区 / 空串回落默认）；在 `packages/brain/server.js` 新增 import 与 `app.use('/api/time', timeRouter)` 注册。路由**必须**从 `../utils/time-format.js` 导入 Feature 1 的两个函数，不在路由文件里重新实现时区逻辑。
**大小**: M（100-200 行，含路由实现 + server.js 接线）
**依赖**: Workstream 1 完成并合并

**BEHAVIOR 覆盖测试文件**: `tests/ws2/time-endpoint.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/time-format.test.ts` | 5 × isValidTimeZone + 4 × formatIsoAtTz = 9 `it()` | `npx vitest run sprints/tests/ws1/` → 9 failures（模块不存在，import 级 `ERR_MODULE_NOT_FOUND`，文件内所有 `it()` 级联 FAIL） |
| WS2 | `sprints/tests/ws2/time-endpoint.test.ts` | 9 `it()` 覆盖 PRD 场景 1-4 全部分支 | `npx vitest run sprints/tests/ws2/` → 9 failures（模块不存在，import 级 `ERR_MODULE_NOT_FOUND`，文件内所有 `it()` 级联 FAIL） |

**Red evidence 来源说明**: 本仓库 `node_modules` 未预装，Proposer 本地不具备 `npx vitest` 运行条件。改以 Node.js ESM loader 直接 `import()` 两个测试 import 的目标模块路径，确认均抛 `ERR_MODULE_NOT_FOUND`——vitest 在 collection 阶段会走相同的 ESM 解析路径，任何 import 失败都会把该文件的全部 `it()` 标为 FAIL。完整命令与输出见本分支 commit message。

---

## 与 PRD 的映射

| PRD 项 | 合同载体 |
|---|---|
| US-001（默认调用） | WS2 `it('GET /api/time returns 200 with iso, timezone, unix fields')` + `iso matches ISO-8601` + `unix is integer` + `iso parses back within 2s` |
| US-002（指定时区） | WS2 `it('...tz=Asia/Shanghai echoes timezone and uses +08:00 offset')` + `...tz=UTC echoes timezone with zero offset` |
| US-003（非法时区 → 400） | WS2 `it('...tz=Foo/Bar returns 400 with error message mentioning tz')` |
| 场景 4（一致性） | WS2 `it('two adjacent requests return unix within 1 second of each other')` |
| 边界：空字符串回落默认 | WS2 `it('...tz= (empty string) falls back to default and returns 200')` |
| 边界：unix 整数秒 | WS2 `it('unix field is an integer')` |
| 边界：iso 与 unix 同一瞬间 | WS2 `it('iso parses back to within 2 seconds of unix')` |
| FR-003 委托委派纯函数 | WS1 全部 `it()` + WS2 ARTIFACT（`from '../utils/time-format.js'` 正则匹配） |
| FR-005 接入现有中间件 | 合同不新增中间件断言（交由 server.js 注册完成后的整体 CI 兜底） |

---

## 非目标

- 不实现历史时间查询（PRD 范围外）
- 不实现毫秒/纳秒精度
- 不加鉴权 / 速率限制 / 缓存
- 不改前端 / Dashboard
- 不扩展至多端点

## 关键约束（给 Generator 读）

1. **WS1 纯函数优先**：时区判断 + ISO 格式化必须在 `utils/time-format.js` 里实现，路由文件只消费结果
2. **WS2 必须从 WS1 导入**：合同 ARTIFACT 强制 `packages/brain/src/routes/time.js` 含 `from '../utils/time-format.js'` 字符串匹配
3. **无新增 npm 依赖**：PRD 假设 Node 运行时 `Intl.DateTimeFormat` + 内置 IANA 数据库已足够
4. **不登记 DEFINITION.md**：PRD 假设 3 明确此端点为测试载体，不进入核心 Brain 能力清单
