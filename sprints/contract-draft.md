# Sprint Contract Draft (Round 1)

**Task ID**: 2303a935-3082-41d9-895e-42551b1c5cc4
**Initiative ID**: 2303a935-3082-41d9-895e-42551b1c5cc4
**Sprint Dir**: sprints
**Round**: 1
**生成时间**: 2026-04-23

## 哲学对齐（Harness v6 Reviewer）

本合同是 Harness v6 在"Reviewer 哲学对齐"改造后的**首次真机闭环**载体。
Proposer 在写 criteria 和测试时遵守：
- **spec 对齐用户真需求**：criteria 描述 **外部可观测行为**（响应状态 / JSON shape / 字段合法性 / 跨调用一致性），不引用内部函数名或实现路径。
- **可量化无歧义**：硬阈值全部给出具体值（HTTP 200、顶层 key 集合严格等于 `["iso","timezone","unix"]`、`unix` 为正整数秒、跨调用 `unix` 差值 ≥ 0）。
- **happy + error + 边界全覆盖**：虽然端点只是简单 GET，仍覆盖 happy path（200 + 三字段）、**一致性**（`iso` 与 `unix` 相差 ≤ 1 秒）、**边界**（时区未配置时的 Intl 兜底、并发两次调用的单调性 / 时区稳定性）。

---

## Feature 1: GET /api/brain/time 返回时间三元组

**行为描述**:
调用方对 Brain 进程发起 `GET /api/brain/time`（无鉴权、无 query、无 body），Brain 必须以 HTTP 200、`Content-Type: application/json` 返回一个 JSON 对象，对象恰好包含三个顶层字段：`iso`（当前时刻 ISO 8601 字符串）、`timezone`（非空 IANA 时区标识）、`unix`（当前时刻正整数秒）。端点无状态、幂等、可重复调用。

**硬阈值**:
- HTTP 状态码 === `200`
- `Content-Type` 包含子串 `application/json`
- 响应 body 可被 `JSON.parse` 成功解析为对象
- `Object.keys(body).sort()` 严格等于 `["iso","timezone","unix"]`（无任何多余字段、无字段缺失）
- `body.iso` 为字符串；`new Date(body.iso).getTime()` 得到有限正整数（即 `Number.isFinite(t) && t > 0`）
- `body.timezone` 为非空字符串（长度 ≥ 1）
- `body.unix` 满足 `Number.isInteger(body.unix) && body.unix > 0`
- 同一次响应内 `Math.abs(Math.floor(new Date(body.iso).getTime()/1000) - body.unix) <= 1`
- 连续两次调用：`response_A.body.timezone === response_B.body.timezone`
- 连续两次调用：`response_B.body.unix - response_A.body.unix >= 0`

**BEHAVIOR 覆盖**（落在 `sprints/tests/ws1/time.test.ts`）:
- `it('GET /api/brain/time 返回 HTTP 200 且 Content-Type 为 application/json')`
- `it('响应 body 顶层 key 严格等于 [iso, timezone, unix]')`
- `it('iso 是合法 ISO 8601 字符串且可被 Date 解析')`
- `it('timezone 是非空字符串')`
- `it('unix 是正整数秒')`
- `it('iso 与 unix 指向同一时刻（差值 ≤ 1 秒）')`
- `it('连续两次调用 timezone 完全一致')`
- `it('连续两次调用 unix 单调不减')`

**ARTIFACT 覆盖**（落在 `sprints/contract-dod-ws1.md`）:
- `packages/brain/src/routes/time.js` 文件存在
- `packages/brain/src/routes/time.js` 含 `router.get('/time'` handler
- `packages/brain/src/routes/time.js` 含 `export default router`
- `packages/brain/server.js` 含 `import timeRoutes from './src/routes/time.js'`
- `packages/brain/server.js` 含 `app.use('/api/brain', timeRoutes)`（或等价挂载使 `/api/brain/time` 可达）
- `docs/current/SYSTEM_MAP.md` 含 `/api/brain/time` 路由条目

---

## Workstreams

workstream_count: 1

### Workstream 1: GET /api/brain/time 路由 + 注册 + 文档

**范围**:
- 新增 `packages/brain/src/routes/time.js`：express Router，导出默认 router，含 `router.get('/time', handler)` 一个处理器。
- 修改 `packages/brain/server.js`：新增一行 `import timeRoutes from './src/routes/time.js'`，在现有路由注册区新增一行 `app.use('/api/brain', timeRoutes)`（与 PRD ASSUMPTION 一致）。
- 修改 `docs/current/SYSTEM_MAP.md`：在 Brain API 路由清单的合适小节追加一行 `/api/brain/time → {iso, timezone, unix}`。

**大小**: S（全部改动 <100 行）
**依赖**: 无（单 workstream，独立完成）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/time.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/time.test.ts` | 200+JSON / key 严格 / iso 合法 / timezone 非空 / unix 正整数 / iso-unix 一致性 / timezone 跨调用稳定 / unix 单调 | Proposer 本地跑 `npx vitest run sprints/tests/ws1/time.test.ts`：vitest 报 `FAIL sprints/tests/ws1/time.test.ts` + `Test Files 1 failed (1)`，原因是 `import timeRoutes from '../../../packages/brain/src/routes/time.js'` 无法解析（目标文件尚未创建）；所有 8 个 `it()` 均无法进入运行阶段 → 在 TDD 语义下等价 8 红。Generator 实现后（Green），在 `packages/brain` 内执行 `npm ci && npx vitest run ../../sprints/tests/ws1/time.test.ts` 预期全部 8 个 `it()` 通过。 |

---

## 范围确认（防止越界）

合同外的事物**一字不加**：
- **不做** 鉴权 / 限流 / 缓存中间件
- **不做** query 参数、时区切换、历史时间查询、用户偏好
- **不做** 前端消费方改造 / dashboard 接入
- **不做** 其它 Brain 路由重构或依赖升级
- **不做** Harness 框架本身的改动（rubric / MAX_ROUNDS 已在 #2547 合入，本 Initiative 是被调度的 payload）
