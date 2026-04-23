# Sprint Contract Draft (Round 2)

**Task ID**: 2303a935-3082-41d9-895e-42551b1c5cc4
**Initiative ID**: 2303a935-3082-41d9-895e-42551b1c5cc4
**Sprint Dir**: sprints
**Round**: 2
**生成时间**: 2026-04-23

## Round 1 反馈落实（逐条）

Round 1 Reviewer 指出三处 spec 漏洞，本轮逐条收敛：

1. **ARTIFACT 锁死内部 router API** —
   Round 1 把 `router.get('/time'` 和 `export default router` 写成 ARTIFACT 硬阈值，等于强制 Generator 用 express Router + 子路径挂载方式。若 Generator 选择 `app.get('/api/brain/time', ...)` 直接挂在主 app 上（PRD 未禁止），实现合规但 ARTIFACT 误判失败。
   **本轮修正**：ARTIFACT 只保留 PRD 显式指定的**文件路径存在性**和**文档条目存在性**（外部可观测产物），删除所有内部 API 形状硬阈值。运行时行为（"端点可达 + 返回合法 JSON"）全部下沉到 `tests/ws1/time.test.ts` 用真实 HTTP 断言。

2. **测试栈/路径与 PRD 双重错位** —
   Round 1 在 `sprints/tests/ws1/time.test.ts` 里 `import timeRoutes from '../../../packages/brain/src/routes/time.js'` 然后手工 `app.use('/api/brain', timeRoutes)`，既锁死 Router 导出形状，又与 PRD FR-004 指定的"在 `packages/brain/src/__tests__/time.test.js` 写单元测试"两条路径互不覆盖。
   **本轮修正**：
   - Harness BEHAVIOR 测试（`sprints/tests/ws1/time.test.ts`）改用 **外部 HTTP fetch** 方式，面向真机 Brain 端点 `http://127.0.0.1:5221/api/brain/time` 做真实断言，不 import 任何内部路由模块。
   - 增加一条 ARTIFACT：要求 Generator 按 PRD FR-004 在 `packages/brain/src/__tests__/time.test.js`（repo 现有 vitest 技术栈）新增单元测试文件。只断言文件存在，不锁具体断言形状，交由 Generator 自由落地。

3. **Red 证据失真** —
   Round 1 的红证据依赖"目标模块不存在 → import 失败 → 文件级 FAIL"，而非真实 it() 级断言失败。这种红在 Harness v6 语义下不算真红：实现后如果 Generator 的 route 写错了（例如 404 或 JSON shape 错），同样的 import 路径也能解析，测试还是"不红不真绿"。
   **本轮修正**：测试去掉对内部模块的 `import`，改为 `fetch(BRAIN_BASE_URL + '/api/brain/time')` 形式。
   - 实现前：Brain 进程已存在但无此路由 → `res.status === 404` → `expect(res.status).toBe(200)` 抛 AssertionError → 真 Red。
   - 实现后（三字段正确）：`res.status === 200` 且 body 字段齐全一致 → 全 Green。
   红证据来源从"import 解析失败"变成"真实 HTTP 响应断言失败"，符合 v6 Reviewer 哲学强调的"外部可观测行为"。

## 哲学对齐（Harness v6 Reviewer）

本合同是 Harness v6 在"Reviewer 哲学对齐"改造后的**首次真机闭环**载体。
Proposer 在写 criteria 和测试时遵守：
- **spec 对齐用户真需求**：criteria 描述 **外部可观测行为**（HTTP 状态码 / JSON shape / 字段合法性 / 跨调用一致性），不引用内部函数名、变量名或 express API 形状。
- **可量化无歧义**：硬阈值全部给出具体值（HTTP 200、顶层 key 集合严格等于 `["iso","timezone","unix"]`、`unix` 为正整数秒、跨调用 `unix` 差值 ≥ 0、`iso` 与 `unix` 相差 ≤ 1 秒）。
- **happy + error + 边界全覆盖**：虽然端点只是简单 GET，仍覆盖 happy path（200 + 三字段）、**一致性**（`iso` 与 `unix` 相差 ≤ 1 秒）、**边界**（时区字段始终非空、并发两次调用的单调性 / 时区稳定性）。

---

## Feature 1: GET /api/brain/time 返回时间三元组

**行为描述**:
调用方对 Brain 进程发起 `GET /api/brain/time`（无鉴权、无 query、无 body），Brain 必须以 HTTP 200、`Content-Type` 含 `application/json` 返回一个 JSON 对象，对象恰好包含三个顶层字段：`iso`（当前时刻 ISO 8601 字符串）、`timezone`（非空 IANA 时区标识）、`unix`（当前时刻正整数秒）。端点无状态、幂等、可重复调用。

**硬阈值**（只描述外部可观测结果，不引用实现路径）:
- HTTP 状态码 === `200`
- 响应头 `Content-Type` 包含子串 `application/json`
- 响应 body 可被 `JSON.parse` 成功解析为对象
- `Object.keys(body).sort()` 严格等于 `["iso","timezone","unix"]`（无任何多余字段、无字段缺失）
- `body.iso` 为字符串；`new Date(body.iso).getTime()` 得到有限正整数
- `body.iso` 匹配 ISO 8601 形状正则 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$`
- `body.timezone` 为非空字符串（长度 ≥ 1）
- `body.unix` 满足 `Number.isInteger(body.unix) && body.unix > 0 && body.unix > 1577836800`（>= 2020-01-01）
- 同一次响应内 `Math.abs(Math.floor(new Date(body.iso).getTime()/1000) - body.unix) <= 1`
- 连续两次调用：`response_A.body.timezone === response_B.body.timezone`
- 连续两次调用：`response_B.body.unix - response_A.body.unix >= 0`

**BEHAVIOR 覆盖**（落在 `sprints/tests/ws1/time.test.ts`，用真实 HTTP fetch 断言）:
- `it('GET /api/brain/time 返回 HTTP 200 且 Content-Type 含 application/json')`
- `it('响应 body 顶层 key 严格等于 [iso, timezone, unix]')`
- `it('iso 是合法 ISO 8601 字符串且可被 Date 解析')`
- `it('timezone 是非空字符串')`
- `it('unix 是合理范围内的正整数秒')`
- `it('iso 与 unix 指向同一时刻（差值 ≤ 1 秒）')`
- `it('连续两次调用 timezone 完全一致')`
- `it('连续两次调用 unix 单调不减')`

**ARTIFACT 覆盖**（落在 `sprints/contract-dod-ws1.md`，只含 PRD 显式指定的文件/文档产物）:
- `packages/brain/src/routes/time.js` 文件存在（PRD FR-001 + 预期受影响文件列表 mandate 此路径）
- `packages/brain/src/__tests__/time.test.js` 文件存在（PRD FR-004 + 预期受影响文件列表 mandate 此路径；只断言文件存在，不锁断言形状/测试框架，交由 Generator 按 repo 现状选择）
- `docs/current/SYSTEM_MAP.md` **或** `packages/brain/README.md` 含 `/api/brain/time` 条目（PRD FR-005 明确给出主路径 + fallback，ARTIFACT 对两个路径任一命中即通过）

---

## Workstreams

workstream_count: 1

### Workstream 1: GET /api/brain/time 路由 + 注册 + 文档 + 单元测试

**范围**:
- 新增 `packages/brain/src/routes/time.js`：实现 `/api/brain/time` 的 GET handler。具体挂载形式（express Router + `app.use('/api/brain', timeRoutes)` / 主 app 直挂 / 其它等价 express 机制）由 Generator 自主选择，只要最终 Brain 进程在 `/api/brain/time` 上提供符合硬阈值的响应即可。
- 修改 `packages/brain/server.js`（或 `packages/brain/src/server.js`，如 PRD ASSUMPTION 所述）：使 `/api/brain/time` 成为 Brain HTTP 服务的活跃路由。
- 新增 `packages/brain/src/__tests__/time.test.js`：按 PRD FR-004 覆盖三字段 shape 与 iso/unix 一致性的单元测试（技术栈按 repo 现状选择，既有 `packages/brain/src/__tests__/**/*.test.js` 以 vitest 为主）。
- 修改 `docs/current/SYSTEM_MAP.md`（或在不存在时 fallback 到 `packages/brain/README.md`）：在 Brain API 路由清单的合适小节追加一行 `/api/brain/time → {iso, timezone, unix}`。

**大小**: S（全部改动 <100 行）
**依赖**: 无（单 workstream，独立完成）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/time.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/time.test.ts` | 200+JSON / key 严格 / iso 合法 / timezone 非空 / unix 合理正整数 / iso-unix 一致性 / timezone 跨调用稳定 / unix 单调 | **Proposer 本地 Round 2 实跑确认**（`./node_modules/.bin/vitest run sprints/tests/ws1/time.test.ts --reporter=verbose`）：Brain 进程未起时，`fetch('http://127.0.0.1:5221/api/brain/time')` 抛 `TypeError: fetch failed / code: ECONNREFUSED`；8 个 `it()` 全部进入执行并在 `fetch(...)` / 随后 `expect(res.status).toBe(200)` 上失败 → vitest 输出 `Test Files 1 failed (1)` / `Tests 8 failed (8)`。在 Harness Final E2E 环境中 Brain 常驻运行，实现前路由未注册则失败模式变为 `res.status === 404` → `expect(res.status).toBe(200)` 抛 AssertionError，同样 8 红。实现后（三字段正确、挂载正确），同样 8 个 `it()` 全部通过 → `Test Files 1 passed (1)` / `Tests 8 passed (8)`。Round 1 依赖"import 解析失败"的 pseudo-red 已被替换为真实 `it()` 级运行时断言失败。|

---

## 范围确认（防止越界）

合同外的事物**一字不加**：
- **不做** 鉴权 / 限流 / 缓存中间件
- **不做** query 参数、时区切换、历史时间查询、用户偏好
- **不做** 前端消费方改造 / dashboard 接入
- **不做** 其它 Brain 路由重构或依赖升级
- **不做** Harness 框架本身的改动（rubric / MAX_ROUNDS 已在 #2547 合入，本 Initiative 是被调度的 payload）

## 实现形态自由度（本轮新增声明）

为避免再次犯 Round 1 "ARTIFACT 锁死内部实现" 的错误，本合同**显式开放**以下实现细节由 Generator 自由选择：

- 是否使用 `express.Router()` 还是直接在主 `app` 上挂 `app.get('/api/brain/time', ...)` —— 两者均合规
- route handler 模块的导出形状（`export default router` / 命名导出 handler / 导出注册函数 `(app) => app.get(...)` 等）—— 均合规
- `server.js` 注册子路由的具体语法（`app.use('/api/brain', timeRoutes)` / `app.use(timeRoutes)` / 直接 `app.get(...)` 等）—— 均合规
- `timezone` 字段来源（`process.env.TZ` / `Intl.DateTimeFormat().resolvedOptions().timeZone` / 任何能保证非空的方式）—— 均合规
- 文档落点优先 `docs/current/SYSTEM_MAP.md`，若该文件/小节不存在则 fallback 到 `packages/brain/README.md` —— 两者命中其一即可

**判断合规的唯一标尺**：`tests/ws1/time.test.ts` 的 8 个 it 全绿 + `contract-dod-ws1.md` 的 3 条 ARTIFACT 全绿。内部实现如何组织、函数叫什么名、文件内部结构如何，合同一律不管。
