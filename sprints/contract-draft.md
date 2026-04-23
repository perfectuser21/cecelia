# Sprint Contract Draft (Round 2)

> **PRD 来源**：`sprints/sprint-prd.md`（Initiative：Brain 时间端点 — 单一 `GET /api/brain/time` 返回 iso/timezone/unix 三字段）
>
> **Round 1 → Round 2 变更（基于 Reviewer REVISION 反馈）**：
> - **Risk 1（iso 假格式 mutation 绕过）**：`it(3)` 仅做 typeof + `new Date()` 可解析 + 2s 偏差校验，`new Date().toString()` 或 `"2024-01-01T00:00:00"`（无时区后缀）均能混过。→ 新增 `it(4)` 严格 ISO 8601 正则断言
> - **Risk 2（timezone 假 IANA mutation 绕过）**：`it(5)` 仅校验非空字符串，`"hello"` 能混过。→ 新增 `it(7)` 用 `new Intl.DateTimeFormat('en-US', { timeZone: value })` 不抛错验证 IANA 有效性
> - **Risk 3（timezone fallback 假路径 mutation 绕过）**：`it(10)`（原 `it(8)`）只 mock Intl 返回空，若实现硬编码 `timezone: 'UTC'`（不查 Intl）也能 pass。→ 新增 `it(11)` 反向验证（mock Intl 返回 `'Asia/Tokyo'` 时 response 必须等于 `'Asia/Tokyo'`）
> - **Risk 5（SC-003 E2E 合同断裂）**：PRD 列出的 `tests/brain-time-e2e.*` 在 Round 1 合同中无对应 ARTIFACT，若 harness-final-e2e 只跑 `jq -e '.iso and .timezone'` 会假阳性。→ 新增 `tests/e2e/brain-time.sh` + 7 条 ARTIFACT grep 校验脚本含字段白名单 / unix type / length ≤ 10 / iso↔unix 2000ms / ISO 8601 正则 / query 免疫等关键断言
>
> **设计原则**：功能小且无副作用（无 DB、无外部调用），GAN 对抗焦点集中在"BEHAVIOR 测试是否能抓出 iso 假格式 / 假 IANA / 假 fallback / 假白名单 / 假一致性 / 假 query 免疫"这六类假实现 + "E2E 脚本断言强度与 BEHAVIOR 等价"。

---

## Feature 1: `GET /api/brain/time` 返回单一聚合 JSON（iso + timezone + unix）

**行为描述**:

对该 URL 发出 GET 请求时，服务以 HTTP 200 返回 Content-Type 为 JSON 的响应体，对象**恰好**含三个字段 `iso`、`timezone`、`unix`，不混入其它字段。`iso` 是代表当前服务器时刻的**严格 ISO 8601 instant 字符串**（必须含时区后缀 `Z` 或 `±HH:MM`，不允许 `new Date().toString()` / 无后缀 naive 字符串）；`timezone` 是**有效 IANA 名字字符串**（`new Intl.DateTimeFormat('en-US', { timeZone })` 不得抛 `RangeError`），正常环境下反映 `Intl.DateTimeFormat().resolvedOptions().timeZone` 实际解析值（不得硬编码为 `'UTC'`），仅当 Intl 返回空/undefined 时才回落 `'UTC'`；`unix` 是**整数秒**（非毫秒、非字符串、非浮点），即 `Math.floor(Date.now()/1000)`。端点不依赖 DB、不依赖鉴权、不依赖外部服务。query 参数与 request body 一律被**忽略**（客户端即使传 `?iso=evil&unix=1&timezone=Fake%2FZone` 也不能污染输出）。三个字段取自**同一次** `Date.now()`（同次请求内，`new Date(iso).getTime()` 与 `unix * 1000` 之间差值 ≤ 2000ms）。

**硬阈值**:

- HTTP status = `200`
- `Content-Type` 头含 `application/json`
- `Object.keys(body).sort()` 严格等于 `['iso', 'timezone', 'unix']`
- `body.iso` 必须匹配正则 `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/` **（Round 2 新增 — Risk 1）**
- `new Date(body.iso).getTime()` 为有限数且与请求时刻偏差 ≤ 2000ms
- `Number.isInteger(body.unix)` 为真；`body.unix > 0`；`String(body.unix).length <= 10`（秒，不是毫秒）
- `body.timezone` 为非空字符串，且 `new Intl.DateTimeFormat('en-US', { timeZone: body.timezone })` 不抛错 **（Round 2 新增 — Risk 2）**
- `Math.abs(new Date(body.iso).getTime() - body.unix * 1000) <= 2000`
- 当 `Intl.DateTimeFormat().resolvedOptions().timeZone` 返回空字符串/undefined 时，`body.timezone === 'UTC'`（PRD 边界情况）
- 当 `Intl.DateTimeFormat().resolvedOptions().timeZone` 返回 `'Asia/Tokyo'` 时，`body.timezone === 'Asia/Tokyo'` **（Round 2 新增 — Risk 3，反向 mutation detection）**
- 传 `?iso=evil&unix=1&timezone=Fake%2FZone` 不改变 body 中三字段的类型约束且值仍为"当前服务器时间"

**BEHAVIOR 覆盖**（落入 `tests/ws1/time.test.ts`，11 条）:

1. `it('GET /api/brain/time responds with HTTP 200 and application/json content type')`
2. `it('response body contains exactly the three keys iso, timezone, unix — no others')`
3. `it('iso is a string parseable as a Date within 2 seconds of request time')`
4. `it('iso matches strict ISO 8601 instant format with Z or ±HH:MM timezone suffix')` **（新增 — Risk 1）**
5. `it('unix is a positive integer in seconds (at most 10 digits), not milliseconds')`
6. `it('timezone is a non-empty string')`
7. `it('timezone is a valid IANA zone name (accepted by Intl.DateTimeFormat constructor)')` **（新增 — Risk 2）**
8. `it('new Date(iso).getTime() and unix * 1000 agree within 2000ms')`
9. `it('ignores query parameters and returns server-side current time (cannot be poisoned by ?iso=evil etc.)')`
10. `it('timezone falls back to "UTC" when Intl.DateTimeFormat resolves timeZone to empty/undefined')`
11. `it('timezone reflects Intl-resolved value (is NOT hardcoded to "UTC")')` **（新增 — Risk 3）**

**ARTIFACT 覆盖**（落入 `contract-dod-ws1.md`）:

源码类：
- `packages/brain/src/routes/time.js` 文件存在
- `routes/time.js` 定义 `router.get('/time', ...)` 路由
- `routes/time.js` 默认导出 Express Router 实例（`export default router`）
- `routes/time.js` 使用 `Intl.DateTimeFormat` 且含 `'UTC'` fallback 字面量
- `routes/time.js` 文件长度 < 60 行
- `routes/time.js` 不 `import` 任何 DB 或外部服务模块
- `packages/brain/src/routes.js` 导入 time router（含 `from './routes/time.js'`）
- `packages/brain/src/routes.js` 将 `timeRouter` 加入 for-of 合并数组

E2E 脚本类（Round 2 新增 — Risk 5）：
- `tests/e2e/brain-time.sh` 文件存在且可执行
- 脚本调用 `/api/brain/time` 端点
- 脚本含字段白名单断言（`Object.keys` 等价 + `jq keys | sort`）
- 脚本含 `.unix | type == "number"` 断言
- 脚本含 unix 字符串 `length <= 10` 断言
- 脚本含 `iso↔unix 差值 <= 2000ms` 断言
- 脚本含严格 ISO 8601 正则断言
- 脚本含 query 污染免疫断言（`iso=evil` + `Fake`）

---

## Workstreams

workstream_count: 1

### Workstream 1: `/api/brain/time` 路由模块 + 聚合器挂接 + 真机 E2E 脚本

**范围**:
- 新增 `packages/brain/src/routes/time.js`（约 20 行）：Express Router，定义 `GET /time` 返回 `{ iso, timezone, unix }`，含 timezone fallback 到 `UTC`
- 修改 `packages/brain/src/routes.js`：新增 `import timeRouter from './routes/time.js'`，将 `timeRouter` 加入现有 `for (const subRouter of [...])` 合并数组末尾
- 新增 `tests/e2e/brain-time.sh`（已在 Round 2 提交，Generator 阶段**不需要**再创建，仅需跑通）
- **不**改 `server.js`、**不**改 DB、**不**新增依赖、**不**动 middleware

**大小**: S（Brain 源码预计 <30 行净新增 + 1 行 import + 1 个数组成员追加；E2E 脚本 ~80 行 bash 已 Proposer 侧交付）

**依赖**: 无（Brain 已有 express + Router 聚合架构；E2E 脚本只依赖 bash + curl + jq，环境已具备）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/time.test.ts`（11 条 `it()`）
**真机 E2E 脚本**: `tests/e2e/brain-time.sh`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖（it 描述） | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/time.test.ts` | 11 条：1) 200+JSON / 2) 恰好三字段 / 3) iso 2s-of-now / 4) **iso 严格 ISO 8601 正则** / 5) unix 整数秒 / 6) timezone 非空 / 7) **timezone 是有效 IANA** / 8) iso↔unix 一致 / 9) query 忽略 / 10) UTC fallback / 11) **timezone 非硬编码（反向 Asia/Tokyo mock）** | 模块 `packages/brain/src/routes/time.js` 尚不存在 → vitest import 解析即失败（suite-level 加载错），11 条 it 均 FAIL（`Tests no tests ran`）；Generator 按 `contract-dod-ws1.md` 实现后重跑应得 `Tests  11 passed (11)` |
| WS1-E2E | `tests/e2e/brain-time.sh` | 7 步断言（HTTP 200+JSON / 字段白名单 / unix type number / unix length ≤ 10 / ISO 8601 正则 / iso↔unix 2s / timezone 非空+IANA 有效 / query 免疫） | 脚本存在且可执行（Round 2 Proposer 侧已交付）；Generator 实现路由后真机跑应 `exit 0`，未实现或实现错误应 exit 1..7（各 FAIL 步骤明确 exit code） |

---

## GAN 对抗要点（供 Reviewer 聚焦 Round 2 修订是否充分）

**Round 1 遗留的 mutation 族是否已被 Round 2 堵上**：

| # | Mutation 族 | Round 1 漏洞 | Round 2 堵法 |
|---|---|---|---|
| 1 | **假 iso 格式**：返回 `new Date().toString()` 形如 `"Wed Apr 23 2026 05:00:00 GMT+0800"` | `it(3)` 只检查 `new Date()` 可解析 + 2s 偏差，能混过 | `it(4)` 严格正则 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$` 直接拒绝 |
| 2 | **假 iso 格式**：返回 `"2024-01-01T00:00:00"`（无时区后缀） | `it(3)` 能混过（`new Date()` 按本地时区解析成功） | `it(4)` 正则要求必须有 `Z` 或 `±HH:MM` 后缀 |
| 3 | **假 unix（毫秒）**：实现 `unix: Date.now()` → 13 位 | 已被 `it(5)` 的 `String().length <= 10` 抓住 | 保留 + E2E `length <= 10` 双重校验 |
| 4 | **假 timezone（任意非空字符串）**：实现 `timezone: 'hello'` | `it(6)` 仅校验 `length > 0`，能混过 | `it(7)` 用 `new Intl.DateTimeFormat('en-US', { timeZone })` 不抛错验证 IANA |
| 5 | **字段白名单破坏**：多加 `offset`/`version` 字段 | 已被 `it(2)` 的严格 keys 相等抓住 | 保留 + E2E `keys \| sort` 双重校验 |
| 6 | **iso 与 unix 不同源**：两次 `Date.now()` 调用相差大 | 已被 `it(8)` 的 2000ms 阈值抓住 | 保留 + E2E 脚本 `fromdateiso8601 \| fabs <= 2` 双重校验 |
| 7 | **被 query 污染**：实现 `res.json({ iso: req.query.iso \|\| ..., unix: Number(req.query.unix) \|\| ..., ... })` | 已被 `it(9)` 抓住 | 保留 + E2E 脚本 step 7 真机 query 注入 |
| 8 | **timezone 未 fallback**：实现 `timezone: Intl.DateTimeFormat().resolvedOptions().timeZone`（未加 `\|\| 'UTC'`） | 已被 `it(10)` spy mock 返回空抓住 | 保留 |
| 9 | **timezone 永远硬编码 UTC**：实现 `timezone: 'UTC'`（不调 Intl） | `it(10)` 反而 pass（因为 body.timezone === 'UTC'）；`it(6)` 也 pass | `it(11)` 反向 mock Intl 返回 `'Asia/Tokyo'`，response 必须等于 `'Asia/Tokyo'` |
| 10 | **只挂在单独路径而非聚合器（破坏 FR-004）**：`router.use('/time', timeRouter)` 单挂 | 已被 ARTIFACT 检查 `timeRouter` 入合并数组抓住 | 保留 |
| 11 | **SC-003 E2E 弱断言假阳性**：harness-final-e2e 只跑 `jq -e '.iso and .timezone'` | Round 1 无 E2E 脚本 ARTIFACT，无法约束 | Round 2 追加 `tests/e2e/brain-time.sh` + 7 条 ARTIFACT grep 校验 6 个关键表达式 |

## PRD 追溯性

| PRD 条目 | 覆盖位置 |
|---|---|
| FR-001（GET /api/brain/time，无鉴权无 DB） | WS1 route 实现 + ARTIFACT "不 import DB/LLM" |
| FR-002（响应体只含 iso/timezone/unix） | BEHAVIOR `it(2)` 字段白名单 + E2E step 1 |
| FR-003（iso=严格 ISO 8601） | BEHAVIOR `it(3)(4)` + E2E step 4 |
| FR-003（unix=整数秒） | BEHAVIOR `it(5)` + E2E step 2+3 |
| FR-003（timezone=非空且有效 IANA） | BEHAVIOR `it(6)(7)` + E2E step 6 |
| FR-004（挂接到现有聚合器） | ARTIFACT "routes.js 含 timeRouter 且加入合并数组" |
| SC-001（≥3 条单测） | 本合同含 11 条 it() |
| SC-002（Supertest HTTP 集成） | `tests/ws1/time.test.ts` 全程使用 supertest |
| SC-003（真机 curl + jq） | **Round 2 新增 `tests/e2e/brain-time.sh` + 7 条 ARTIFACT 强制脚本内置 6 个关键断言表达式**，脚本本身作为合同产物；harness-final-e2e 执行此脚本等价于 BEHAVIOR `it(2)(4)(5)(7)(8)(9)` 的真机复现 |
| SC-004（brain-ci 全绿） | 由 CI 保证；合同测试位于 `sprints/tests/` 不进 brain-ci include |
| 边界: timezone Intl 回落 UTC | BEHAVIOR `it(10)` |
| 边界: timezone 非硬编码 | BEHAVIOR `it(11)` |
| 边界: 忽略客户端输入 | BEHAVIOR `it(9)` + E2E step 7 |
