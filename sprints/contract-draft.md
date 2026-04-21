# Sprint Contract Draft (Round 3)

PRD: `sprints/sprint-prd.md`（不改）
Planner 分支: `cp-04211712-harness-prd`
Propose 轮次: 3
Proposer 分支: `cp-harness-propose-r3-04211712`

**本轮相对 Round 2 的修订**（处理 Reviewer 的唯一 REVISION 反馈）:

**Risk（Roundtrip 严格相等诱导"挑零毫秒输入"）**: Round 2 的 WS1 `formatIsoAtTz` 硬阈值要求 `new Date(formatIsoAtTz(input, tz)).getTime() === input.getTime()`（严格 `toBe` 相等），配合 `ISO_WITH_OFFSET` 正则里 `(?:\.\d+)?` 毫秒段可选，会诱导 Generator 做三选一作弊路径中最省力的那条：**挑零毫秒输入（`new Date('...Z')` 字面量）让测试过，生产代码在非零毫秒输入上默默坏掉**。此条款比 PRD 场景 4（"`iso` 解析回的时间戳与 `unix` 差值 ≤ 2 秒"）更严，反而造成假绿。

修订（采用 Reviewer 建议的方案 1：与 PRD "≤ 2 秒"对齐放宽 roundtrip 到 1 秒容差；同时新增一条用 `new Date()` 实时输入的测试堵死"挑输入"路径）:

1. **合同硬阈值**: `new Date(formatIsoAtTz(input, tz)).getTime() === input.getTime()` → `Math.abs(new Date(formatIsoAtTz(input, tz)).getTime() - input.getTime()) < 1000`
2. **测试修改（`packages/brain/src/__tests__/utils/time-format.test.js`）**:
   - 原 `it('formatIsoAtTz roundtrips to the same instant')` 重命名为 `it('formatIsoAtTz roundtrips within 1 second for a fixed instant')`，把 `expect(parsed.getTime()).toBe(input.getTime())` 改为 `expect(Math.abs(parsed.getTime() - input.getTime())).toBeLessThan(1000)`
   - **新增** `it('formatIsoAtTz roundtrips within 1 second for a live non-zero-millisecond instant')`：输入 `new Date()`（真实运行时时间戳，99% 带非零毫秒），断言同样的 1 秒容差——让 Generator 无论是否截断毫秒，都必须保证 1 秒内可 roundtrip
3. **正则保持**: `ISO_WITH_OFFSET` 继续允许可选毫秒段 `(?:\.\d+)?`——PRD 不要求毫秒精度，不在合同里加"强制 3 位毫秒"这种超出 PRD 范围的要求。一致性由 1 秒容差 roundtrip 兜底

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
- 对任意合法 `Date` 输入（包括 `new Date()` 的运行时实时值，通常毫秒段非零）：`Math.abs(new Date(formatIsoAtTz(input, tz)).getTime() - input.getTime()) < 1000`（1 秒容差 roundtrip，与 PRD "≤ 2 秒"对齐且更严一档以抓出 Generator 完全丢弃秒数的假实现）
- `formatIsoAtTz(date, 'Asia/Shanghai')` 返回以 `+08:00` 结尾
- `formatIsoAtTz(date, 'UTC')` 返回以 `Z` 或 `+00:00` 结尾

**BEHAVIOR 覆盖**（落在 `packages/brain/src/__tests__/utils/time-format.test.js`）:
- `it('isValidTimeZone returns true for UTC')`
- `it('isValidTimeZone returns true for Asia/Shanghai')`
- `it('isValidTimeZone returns false for invalid IANA name Foo/Bar')`
- `it('isValidTimeZone returns false for empty string')`
- `it('isValidTimeZone returns false for undefined')`
- `it('formatIsoAtTz outputs ISO-8601 with offset suffix')`
- `it('formatIsoAtTz roundtrips within 1 second for a fixed instant')`
- `it('formatIsoAtTz roundtrips within 1 second for a live non-zero-millisecond instant')`
- `it('formatIsoAtTz applies +08:00 offset for Asia/Shanghai')`
- `it('formatIsoAtTz applies zero offset for UTC')`

**ARTIFACT 覆盖**（落在 `contract-dod-ws1.md`）:
- `packages/brain/src/utils/time-format.js` 文件存在
- 模块导出 `isValidTimeZone` 命名导出
- 模块导出 `formatIsoAtTz` 命名导出
- `packages/brain/package.json` `dependencies` 未新增条目（PRD 假设成立）
- `time-format.js` 不 import 任何 npm 依赖（只允许相对路径或 `node:` 内置）

---

## Feature 2: GET /api/time HTTP 端点

**行为描述**: 在 Brain Express 应用注册新路由，按 PRD 场景 1-4 返回当前时间三元组；路由层只做参数解析与响应组装，时区合法性判断与 ISO 格式化委托给 Feature 1。错误路径必须使用 Express 内建机制（`next(err)` 或 `res.status(4xx).json(...)`），不允许自建日志栈。

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
- `packages/brain/src/routes/time.js` 文件不含独立日志栈调用（`console.log(` / `console.error(` / `winston` / `new Logger(`）

**BEHAVIOR 覆盖**（落在 `packages/brain/src/__tests__/routes/time-endpoint.test.js`）:
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
- `packages/brain/src/routes/time.js` 不含 `console.log(` / `console.error(` / `winston` / `new Logger(` 等独立日志栈字面量（FR-005 硬兜底）

---

## Workstreams

workstream_count: 2

### Workstream 1: Time formatting utilities

**范围**: 新增 `packages/brain/src/utils/time-format.js`，导出 `isValidTimeZone(tz)` 与 `formatIsoAtTz(date, tz)` 两个纯函数。**不**接触 Express、`server.js`、`routes/`、数据库。
**大小**: S（<100 行含注释）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `packages/brain/src/__tests__/utils/time-format.test.js`

### Workstream 2: GET /api/time endpoint

**范围**: 新增 `packages/brain/src/routes/time.js`（Express Router），实现三个分支（默认 / 指定时区 / 非法时区 / 空串回落默认）；在 `packages/brain/server.js` 新增 import 与 `app.use('/api/time', timeRouter)` 注册。路由**必须**从 `../utils/time-format.js` 导入 Feature 1 的两个函数，不在路由文件里重新实现时区逻辑。错误路径通过 `next(err)` 或 `res.status(4xx).json(...)` 返回，不自建日志栈（FR-005 硬兜底，见 ARTIFACT）。
**大小**: M（100-200 行，含路由实现 + server.js 接线）
**依赖**: Workstream 1 完成并合并

**BEHAVIOR 覆盖测试文件**: `packages/brain/src/__tests__/routes/time-endpoint.test.js`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `packages/brain/src/__tests__/utils/time-format.test.js` | 5 × isValidTimeZone + 5 × formatIsoAtTz = 10 `it()` | `cd packages/brain && npx vitest run src/__tests__/utils/time-format.test.js` → 10 failures（`import { isValidTimeZone, formatIsoAtTz } from '../../utils/time-format.js'` 目标缺失，vitest collection 阶段 `ERR_MODULE_NOT_FOUND`，文件内所有 `it()` 级联 FAIL） |
| WS2 | `packages/brain/src/__tests__/routes/time-endpoint.test.js` | 9 `it()` 覆盖 PRD 场景 1-4 全部分支 | `cd packages/brain && npx vitest run src/__tests__/routes/time-endpoint.test.js` → 9 failures（`import timeRouter from '../../routes/time.js'` 目标缺失，vitest collection 阶段 `ERR_MODULE_NOT_FOUND`，文件内所有 `it()` 级联 FAIL） |

**Red evidence 来源说明**: 本仓库 `node_modules` 未预装，Proposer 本地无法直接跑 `npx vitest`。改以 Node.js ESM loader 直接 `import()` 目标模块验证解析失败——vitest 在 collection 阶段走相同的 ESM 解析路径，任何 import 失败都会把该文件的全部 `it()` 标为 FAIL。本地执行结果：

```
$ node --input-type=module -e "await import('./packages/brain/src/utils/time-format.js')"
WS1 RED: ERR_MODULE_NOT_FOUND
$ node --input-type=module -e "await import('./packages/brain/src/routes/time.js')"
WS2 RED: ERR_MODULE_NOT_FOUND
```

对比 Round 1：测试文件现在落在 Brain CI `npx vitest run` 的 include 路径（`src/**/*.{test,spec}.?(c|m)[jt]s?(x)`），vitest 会实际执行；Round 1 的 `sprints/tests/...` 不在 include 里，即便本地能 Red，CI 也不会跑——Reviewer 的 Risk 1 正是此处。

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
| 内部工具对齐 PRD 场景 4（roundtrip 容差） | WS1 `it('formatIsoAtTz roundtrips within 1 second for a fixed instant')` + `it('formatIsoAtTz roundtrips within 1 second for a live non-zero-millisecond instant')`——1 秒容差比 PRD "≤ 2 秒"严一档，同时覆盖零毫秒与非零毫秒两种输入，防止 Generator 挑输入作弊 |
| FR-005 接入现有中间件 | WS2 ARTIFACT 反向约束：`routes/time.js` 不得出现 `console.log(` / `console.error(` / `winston` / `new Logger(` 字面量。错误走 `next(err)` 或 `res.status(4xx).json(...)`，等价于落在 Express 内建错误处理链，不新增独立日志栈。 |

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
5. **FR-005 反向约束**：`routes/time.js` 禁止独立日志栈字面量（`console.*` / `winston` / `new Logger(`），错误走 Express 内建机制
6. **测试文件落位**：必须落在 `packages/brain/src/__tests__/utils/` 与 `packages/brain/src/__tests__/routes/`，确保 Brain CI `npx vitest run` 能扫到
