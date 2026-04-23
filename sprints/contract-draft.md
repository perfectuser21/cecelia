# Sprint Contract Draft (Round 2)

> **被测对象**: Brain 新增只读时间查询端点 `/api/brain/time/{iso,unix,timezone}`
> **PRD 对齐**: sprints/sprint-prd.md — 为 Harness v6 闭环演练提供"足够小、无歧义、可端到端跑通"的样本业务功能
> **workstream_count**: 1（总改动 <100 行，单模块单测试文件）

---

## Round 2 修订说明（回应 Reviewer Round 1 反馈）

Round 1 已 Red evidence 通过，但 Reviewer 指出 5 个风险点，Round 2 逐条处理：

| 风险 | 性质 | Round 2 修订 |
|---|---|---|
| 1. 测试根本不被执行 | 工程：合同测试放在 `sprints/tests/ws1/`，不在 `packages/brain/vitest.config.js` 的 `include`（`src/**/*.test.*` 与 `../../tests/packages/brain/**`）匹配范围内 → `npm test` 收不到 → CI 不会跑 | **新增 ARTIFACT**：Generator 必须把合同测试**原样复制**到 `packages/brain/src/__tests__/routes/time-routes.test.ts`（vitest include 能匹配）；并强约束两份文件的 `it()` 标题集合一致 |
| 2. ARTIFACT 检查无效 | 工程：Round 1 的 `grep -c "it("` ≥ 15 只约束了数量，Generator 可写 15 个假 it 通过 | **新增 ARTIFACT**：比对合同测试与实现测试的 `it()` 标题集合逐项一致（见 DoD 条目 A8） |
| 3. `/timezone?tz=UTC` 偏移格式歧义 | spec：UTC 时合法实现可输出 `Z` 或 `+00:00`，与其他时区格式不一致 | **Feature 3 新增硬阈值**：`tz ∈ {UTC, Etc/UTC}` 时 `body.iso` 必须以 `+00:00` 结尾，**禁止 `Z`**；对应新增 2 个 BEHAVIOR |
| 4. 时区匹配大小写敏感未定义 | spec：`tz=asia/shanghai`（小写）合法实现可 200（自行 canonicalize）或 400，造成 spec 歧义 | **Feature 4 新增硬阈值**：时区匹配**严格大小写敏感**（遵循 IANA 规范），`tz=asia/shanghai` → 400；对应新增 1 个 BEHAVIOR |
| 5. 毫秒段精度未定义 | spec：示例 `2026-04-23T10:00:00.000Z` 含 `.mmm`，但硬阈值只要求 `endsWith('Z')`，合法实现可返回 `2026-04-23T10:00:00Z`（无毫秒），日志对齐场景不可用 | **Feature 1 / Feature 3 新增硬阈值**：`body.iso` 必须匹配严格正则 `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}:\d{2})$/`（毫秒必选、24-27 固定字符长度）；对应新增 2 个 BEHAVIOR |

**额外收紧（Round 2 主动加）**：`America/New_York` 在 2026-04-23 这一合同冻结日期处于 DST 窗口（3 月第二周日至 11 月第一周日），`body.iso` 必须严格以 `-04:00` 结尾，**不接受 `-05:00`**（Round 1 的"-04:00 或 -05:00" DST-aware 弱断言被本轮加严——测试冻结日期确定、不存在两可）。

---

## Feature 1: ISO 8601 时间端点

**行为描述**:
调用方通过 `GET /api/brain/time/iso` 拿到服务器当前时刻的 ISO 8601 UTC 字符串。响应体为 JSON，字段 `iso` 必须能被 `Date.parse` 解析为有限数值，且与服务器真实当前时刻相差不超过 10 秒。字符串必须带固定毫秒段精度（`.mmm`），以 `Z` 结尾。

**硬阈值**:
- HTTP 状态码 = 200
- `body.iso` 为 string 类型
- `body.iso` 严格匹配正则 `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/`（毫秒必选、以 Z 结尾、固定 24 字符长度）
- `Date.parse(body.iso)` 结果满足 `Number.isFinite(...) === true`
- `Math.abs(Date.parse(body.iso) - Date.now())` < 10000（毫秒）

**BEHAVIOR 覆盖**（落在 `tests/ws1/time-routes.test.ts`）:
- `it('GET /iso returns HTTP 200')`
- `it('GET /iso body.iso is a non-empty string')`
- `it('GET /iso body.iso matches strict ISO 8601 UTC format with .sss ms precision')` ← Round 2 新增
- `it('GET /iso body.iso is parseable by Date.parse to a finite number')`
- `it('GET /iso body.iso is within 10 seconds of current server time')`
- `it('GET /iso body.iso ends with Z (UTC marker)')`

**ARTIFACT 覆盖**（落在 `contract-dod-ws1.md`）:
- `packages/brain/src/routes/time.js` 存在，`export default` 为 express Router 实例
- 该文件含有 `router.get('/iso', ...)` 注册

---

## Feature 2: Unix 时间戳端点

**行为描述**:
调用方通过 `GET /api/brain/time/unix` 拿到服务器当前时刻的整数秒级 Unix 时间戳。响应体字段 `unix` 必须为 JavaScript 整数（`Number.isInteger` 为真），且与 `Math.floor(Date.now()/1000)` 相差不超过 5 秒。

**硬阈值**:
- HTTP 状态码 = 200
- `typeof body.unix === 'number'`
- `Number.isInteger(body.unix) === true`
- `Math.abs(body.unix - Math.floor(Date.now()/1000)) <= 5`

**BEHAVIOR 覆盖**:
- `it('GET /unix returns HTTP 200')`
- `it('GET /unix body.unix is a number')`
- `it('GET /unix body.unix is an integer (Number.isInteger true)')`
- `it('GET /unix body.unix is within 5 seconds of current server Unix time')`

**ARTIFACT 覆盖**:
- `packages/brain/src/routes/time.js` 含有 `router.get('/unix', ...)` 注册

---

## Feature 3: 指定时区查询端点（合法输入）

**行为描述**:
调用方通过 `GET /api/brain/time/timezone?tz={IANA}` 拿到该时区下当前时刻的 ISO 8601 字符串，带正确的时区偏移量后缀（如 `+08:00`、`-04:00`、`+00:00`）。响应字段 `tz` 原样回显请求的时区字符串（不做 canonicalize），`iso` 必须带固定毫秒段精度且以对应偏移量结尾。

**硬阈值**（所有合法 IANA tz 通用）:
- HTTP 状态码 = 200
- `body.tz === req.query.tz`（原样回显，不做 canonicalize、不映射 `UTC` 到 `Etc/UTC`）
- `typeof body.iso === 'string'`
- `body.iso` 严格匹配正则 `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/`（毫秒必选、以 ±HH:MM 偏移结尾、**禁止 `Z`**）
- `Number.isFinite(Date.parse(body.iso)) === true`
- `Math.abs(Date.parse(body.iso) - Date.now())` < 10000

**具体时区硬阈值**:
- `tz=Asia/Shanghai` → `body.iso` 以 `+08:00` 结尾
- `tz=America/New_York`（在 2026-04-23 DST 窗口内） → `body.iso` 以 `-04:00` 结尾（**不接受 `-05:00`**）
- `tz=UTC` → `body.iso` 以 `+00:00` 结尾（**禁止 `Z`**，与其他时区格式一致）
- `tz=Etc/UTC` → `body.iso` 以 `+00:00` 结尾（**禁止 `Z`**）

**BEHAVIOR 覆盖**:
- `it('GET /timezone?tz=Asia/Shanghai returns HTTP 200')`
- `it('GET /timezone?tz=Asia/Shanghai body.tz equals Asia/Shanghai')`
- `it('GET /timezone?tz=Asia/Shanghai body.iso matches strict ISO with +08:00 offset and .sss ms')` ← Round 2 改写（原"ends with +08:00"升级为严格正则）
- `it('GET /timezone?tz=Asia/Shanghai body.iso is parseable and within 10 seconds of server time')`
- `it('GET /timezone?tz=America/New_York body.iso ends with -04:00 (DST active on 2026-04-23)')` ← Round 2 收紧（删除 `-05:00` 两可）
- `it('GET /timezone?tz=UTC body.iso ends with +00:00 (not Z)')` ← Round 2 新增
- `it('GET /timezone?tz=UTC body.tz equals UTC')` ← Round 2 新增
- `it('GET /timezone?tz=Etc/UTC body.iso ends with +00:00 (not Z)')` ← Round 2 新增

**ARTIFACT 覆盖**:
- `packages/brain/src/routes/time.js` 含有 `router.get('/timezone', ...)` 注册

---

## Feature 4: 指定时区端点的错误处理

**行为描述**:
调用方传入非法 IANA 时区字符串（如 `Mars/Olympus`）、大小写不符（如 `asia/shanghai`）或不传 `tz` query 时，端点返回 HTTP 400，JSON body 含字段 `error`，Brain 进程不崩溃、不抛未处理异常，后续请求仍能正常响应。

**硬阈值**:
- 非法 `tz`（不存在的时区名） → HTTP 400，`body.error` 为非空字符串
- 缺失 `tz` → HTTP 400，`body.error` 为非空字符串且含 `tz`（大小写不敏感）关键字
- **大小写不符**（如 `asia/shanghai`、`ASIA/SHANGHAI`）→ HTTP 400（时区匹配严格大小写敏感，遵循 IANA 规范）
- 非法 `tz` 请求返回后，立即再调用 `/api/brain/time/iso` 仍返回 200（验证未崩溃）

**BEHAVIOR 覆盖**:
- `it('GET /timezone?tz=Mars/Olympus returns HTTP 400')`
- `it('GET /timezone?tz=Mars/Olympus body.error is a non-empty string')`
- `it('GET /timezone with no tz query returns HTTP 400')`
- `it('GET /timezone with no tz body.error mentions tz (case-insensitive)')`
- `it('GET /timezone?tz=asia/shanghai (lowercase) returns HTTP 400 — tz match is case-sensitive')` ← Round 2 新增
- `it('invalid tz request does not crash server — subsequent /iso still returns 200')`

**ARTIFACT 覆盖**:
- `packages/brain/src/routes/time.js` 的 `/timezone` handler 含 try/catch 或等价显式错误分支（代码文本匹配 `try` + `catch` 或 `400`）

---

## Feature 5: 路由挂载

**行为描述**:
`packages/brain/server.js` 导入 `./src/routes/time.js` 并在 `/api/brain/time` 前缀下挂载。这保证真实 Brain 进程启动后，上述端点通过 `localhost:5221/api/brain/time/*` 可达。

**硬阈值**:
- `server.js` 文件中出现 `from './src/routes/time.js'` 形式的 import 语句
- `server.js` 文件中出现 `app.use('/api/brain/time', ...)` 形式的挂载语句

**BEHAVIOR 覆盖**（通过集成测试间接验证）:
- 集成测试通过 supertest 挂载同一 router，验证路由注册正确；真实启动层由 ARTIFACT 保证

**ARTIFACT 覆盖**:
- `server.js` 含 `./src/routes/time.js` import
- `server.js` 含 `/api/brain/time` 挂载

---

## Feature 6: 合同测试进 CI 的强约束（Round 2 新增）

**行为描述**:
合同测试 `sprints/tests/ws1/time-routes.test.ts` 是 canonical truth。由于 `packages/brain/vitest.config.js` 的 `include` 只匹配 `src/**/*.test.*` 与 `../../tests/packages/brain/**`，合同位置本身**不会被 `npm test -w packages/brain` 收录**。Generator 必须把合同测试**原样复制**到 `packages/brain/src/__tests__/routes/time-routes.test.ts`（该路径被 brain vitest include 匹配），并且 `it()` 标题集合必须逐项一致——避免"假 copy + 少写/换名"规避 Reviewer 约束。

**硬阈值**:
- `packages/brain/src/__tests__/routes/time-routes.test.ts` 存在
- 该文件的 `it()` 标题集合 == `sprints/tests/ws1/time-routes.test.ts` 的 `it()` 标题集合（集合相等，不允许缺失或额外）
- 该文件能被 brain vitest 的 `include` 模式 `src/**/*.test.*` 匹配（路径验证即可，实际执行由 CI 保证）

**BEHAVIOR 覆盖**（无 — 这是 ARTIFACT 层约束）:

**ARTIFACT 覆盖**:
- 见 contract-dod-ws1.md 条目 A7-A10

---

## Workstreams

workstream_count: 1

### Workstream 1: 时间查询路由模块 + Server 挂载 + 集成测试

**范围**: 新增 `packages/brain/src/routes/time.js`（三端点实现）+ `packages/brain/server.js` 挂载（2 行改动）+ 集成测试 `packages/brain/src/__tests__/routes/time-routes.test.ts`（从合同原样复制）。端点实现零依赖 DB、零依赖外部服务，仅用 Node 原生 `Date` / `Intl.DateTimeFormat`。
**大小**: S（预估 <120 行总改动，Round 2 因 UTC/毫秒/大小写断言增加，略高于 Round 1 但仍 <150）
**依赖**: 无

**BEHAVIOR 覆盖测试文件（canonical）**: `sprints/tests/ws1/time-routes.test.ts`
**CI 执行位置**: `packages/brain/src/__tests__/routes/time-routes.test.ts`（Generator 原样复制，只允许调整 import 路径）

---

## Test Contract

| Workstream | Test File (canonical) | BEHAVIOR 覆盖（it 数） | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/time-routes.test.ts` | 24 个 it（iso×6 / unix×4 / tz-happy×8 / tz-error×6） | `npx vitest run sprints/tests/ws1/` → 24 failures（模块 `packages/brain/src/routes/time.js` 不存在，getApp() dynamic import 抛出，每个 it 独立 FAIL） |

**Proposer Round 2 本地 Red evidence**:
- 命令: `npx vitest run sprints/tests/ws1/ --reporter=verbose`（从 /workspace root 跑，绕开 brain vitest.config.js 的 include 过滤）
- 结果: 24 failed / 0 passed（详见 commit 消息与 /tmp/ws1-r2-red.log）
- 红原因: `Cannot find module '../../../packages/brain/src/routes/time.js'` — 实现尚未编写，符合 TDD Red 阶段预期；每个 it 独立 `await getApp()` 故独立 fail（非 beforeAll 一次 fail 污染全局）

---

## 变更统计（Round 2 vs Round 1）

| 维度 | Round 1 | Round 2 | 增量 |
|---|---|---|---|
| it 总数 | 19 | 24 | +5（毫秒严格正则 ×2、UTC 偏移 ×2、UTC tz 回显 ×1、Etc/UTC ×1、大小写敏感 ×1；合并 `America/New_York` 从两可改为单一 -04:00 同数） |
| Feature 数 | 5 | 6 | +1（Feature 6：合同测试进 CI 的强约束） |
| ARTIFACT 条目数 | 11 | 14 | +3（复制目标文件存在、it 集合等价、vitest include 位置验证） |
| 硬阈值正则 | 0 | 2（iso UTC 严格、timezone 偏移严格） | +2 |
