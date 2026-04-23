# Sprint Contract Draft (Round 3)

> **被测对象**: Brain 新增只读时间查询端点 `/api/brain/time/{iso,unix,timezone}`
> **PRD 对齐**: sprints/sprint-prd.md — 为 Harness v6 闭环演练提供"足够小、无歧义、可端到端跑通"的样本业务功能
> **workstream_count**: 1（总改动 <150 行，单模块单测试文件 + 1 个 devgate shell 脚本）

---

## Round 3 修订说明（回应 Reviewer Round 2 反馈）

Round 2 Reviewer 给出 VERDICT = REVISION，4 个风险分两档。Round 3 全部处理：

| # | 风险 | 性质 | Round 3 修订 |
|---|---|---|---|
| 1 | `America/New_York` 断言 `-04:00` 硬编码 + 未冻结系统时间 | **阻断**：CI 在 2026-11-01 DST 结束后会无条件红（应该变 -05:00 EST），是"半年内必爆炸的定时炸弹" | **测试层面冻结系统时间**。`beforeAll` 通过 `vi.useFakeTimers({ now: new Date('2026-04-23T10:00:00.000Z'), toFake: ['Date'] })` 把 `Date.now()` 固定在合同冻结日期。该日期落在 New York DST 窗口（2026-03-08 ~ 2026-11-01）内，`Intl.DateTimeFormat` 对这个时间点进行时区转换必然产出 `-04:00`。`toFake` 只包含 `'Date'`，避免 fake 掉 setTimeout/setInterval 导致 supertest/express 挂住。`afterAll` 恢复真实时钟。 |
| 2 | `?tz=A&tz=B`（duplicated tz）spec 未定义 | **阻断**：express `req.query.tz` 在 query string 出现两次时解析为数组，此时 Round 2 的 spec 对 Generator 无约束，Generator 可选择 200（取首个/末个/用逗号拼）或 500（未捕获异常）均"合法" | **Feature 4 新增硬阈值**：`tz` 被传为数组（query string 中出现 ≥2 次）时 → HTTP 400，`body.error` 必须提到 "tz" 且包含 single/one/string/array/multiple/duplicat 之一（避免与非法 tz error message 无法区分）。对应新增 2 个 BEHAVIOR。 |
| 3 | A7-A10（it 集合等价）的校验手段未规定，Reviewer/CI 无法机械化验证 | 工程：虽然 Round 2 把校验逻辑内嵌到 `node -e` 字符串里已"可执行化"，但 Reviewer 建议在 `scripts/devgate/` 下建独立脚本，方便 CI 单独挂钩 | **Feature 7 新增 ARTIFACT**：要求 Generator 在 `scripts/devgate/check-contract-test-copy.sh` 下实现独立校验脚本，DoD 条目 A11 的 Test 字段改为 `bash scripts/devgate/check-contract-test-copy.sh`。同时保留 Round 2 的内嵌 `node -e` 作为**二重保险主校验**——Generator 即使写错脚本，主校验仍能抓住漂移。 |
| 4 | 次要工程风险 | Reviewer 明确说"建议在 Round 3 或 Generator 阶段留意" | 本轮不强制，Generator 若选择在实现阶段处理可自行决定。 |

**Round 2 → Round 3 合同增量**：
- BEHAVIOR it 数: 24 → 26（+ duplicated tz × 2）
- Feature 数: 6 → 7（+ Feature 7：devgate 脚本）
- ARTIFACT 条目数: 14 → 15（+ devgate 脚本存在 + 可执行；A11 新增一条调用该脚本的 hook；保留 Round 2 的内嵌 `node -e` 主校验）

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
- 测试运行期间 `Date.now()` 被 fake timer 冻结在 `2026-04-23T10:00:00.000Z`——实现必须调用 `new Date()` / `Date.now()` 才能通过 within-10s 断言（防止实现写死字符串或走 `process.hrtime`）

**BEHAVIOR 覆盖**（落在 `tests/ws1/time-routes.test.ts`）:
- `it('GET /iso returns HTTP 200')`
- `it('GET /iso body.iso is a non-empty string')`
- `it('GET /iso body.iso matches strict ISO 8601 UTC format with .sss ms precision')`
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
- `Math.abs(body.unix - Math.floor(Date.now()/1000)) <= 5`（测试期间 `Date.now()` 冻结）

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
- `Math.abs(Date.parse(body.iso) - Date.now())` < 10000（测试期间 `Date.now()` 冻结在 2026-04-23T10:00:00.000Z）

**具体时区硬阈值**（测试时钟冻结在 2026-04-23T10:00:00.000Z → 以下均为该时刻的时区投影）:
- `tz=Asia/Shanghai` → `body.iso` 以 `+08:00` 结尾
- `tz=America/New_York` → `body.iso` 以 `-04:00` 结尾（冻结时刻落在 DST 窗口 2026-03-08 ~ 2026-11-01，DST 永远 active）
- `tz=UTC` → `body.iso` 以 `+00:00` 结尾（**禁止 `Z`**，与其他时区格式一致）
- `tz=Etc/UTC` → `body.iso` 以 `+00:00` 结尾（**禁止 `Z`**）

**BEHAVIOR 覆盖**:
- `it('GET /timezone?tz=Asia/Shanghai returns HTTP 200')`
- `it('GET /timezone?tz=Asia/Shanghai body.tz equals Asia/Shanghai')`
- `it('GET /timezone?tz=Asia/Shanghai body.iso matches strict ISO with +08:00 offset and .sss ms')`
- `it('GET /timezone?tz=Asia/Shanghai body.iso is parseable and within 10 seconds of server time')`
- `it('GET /timezone?tz=America/New_York body.iso ends with -04:00 (DST active on 2026-04-23)')`
- `it('GET /timezone?tz=UTC body.iso ends with +00:00 (not Z)')`
- `it('GET /timezone?tz=UTC body.tz equals UTC')`
- `it('GET /timezone?tz=Etc/UTC body.iso ends with +00:00 (not Z)')`

**ARTIFACT 覆盖**:
- `packages/brain/src/routes/time.js` 含有 `router.get('/timezone', ...)` 注册

---

## Feature 4: 指定时区端点的错误处理

**行为描述**:
调用方传入非法 IANA 时区字符串（如 `Mars/Olympus`）、大小写不符（如 `asia/shanghai`）、不传 `tz`、或**传入重复 `tz` query 导致数组**（如 `?tz=A&tz=B`）时，端点返回 HTTP 400，JSON body 含字段 `error`，Brain 进程不崩溃、不抛未处理异常，后续请求仍能正常响应。

**硬阈值**:
- 非法 `tz`（不存在的时区名） → HTTP 400，`body.error` 为非空字符串
- 缺失 `tz` → HTTP 400，`body.error` 为非空字符串且含 `tz`（大小写不敏感）关键字
- **大小写不符**（如 `asia/shanghai`、`ASIA/SHANGHAI`）→ HTTP 400（时区匹配严格大小写敏感，遵循 IANA 规范）
- **重复 `tz` query**（`req.query.tz` 为数组）→ HTTP 400，`body.error` 为非空字符串，含 `tz` 且必须包含 `single|one|string|array|multiple|duplicat` 之一（error message 必须区别于非法 tz，使客户端能识别"参数形式错"而非"时区值错"）← **Round 3 新增**
- 非法 `tz` 请求返回后，立即再调用 `/api/brain/time/iso` 仍返回 200（验证未崩溃）

**BEHAVIOR 覆盖**:
- `it('GET /timezone?tz=Mars/Olympus returns HTTP 400')`
- `it('GET /timezone?tz=Mars/Olympus body.error is a non-empty string')`
- `it('GET /timezone with no tz query returns HTTP 400')`
- `it('GET /timezone with no tz body.error mentions tz (case-insensitive)')`
- `it('GET /timezone?tz=asia/shanghai (lowercase) returns HTTP 400 — tz match is case-sensitive')`
- `it('GET /timezone?tz=Asia/Shanghai&tz=UTC (duplicated tz) returns HTTP 400 — tz must be a single string')` ← **Round 3 新增**
- `it('GET /timezone duplicated tz body.error explains tz must be a single string value')` ← **Round 3 新增**
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

**ARTIFACT 覆盖**:
- `server.js` 含 `./src/routes/time.js` import
- `server.js` 含 `/api/brain/time` 挂载

---

## Feature 6: 合同测试进 CI 的强约束

**行为描述**:
合同测试 `sprints/tests/ws1/time-routes.test.ts` 是 canonical truth。由于 `packages/brain/vitest.config.js` 的 `include` 只匹配 `src/**/*.test.*` 与 `../../tests/packages/brain/**`，合同位置本身**不会被 `npm test -w packages/brain` 收录**。Generator 必须把合同测试**原样复制**到 `packages/brain/src/__tests__/routes/time-routes.test.ts`（该路径被 brain vitest include 匹配），并且 `it()` 标题集合必须逐项一致——避免"假 copy + 少写/换名"规避 Reviewer 约束。

**硬阈值**:
- `packages/brain/src/__tests__/routes/time-routes.test.ts` 存在
- 该文件的 `it()` 标题集合 == `sprints/tests/ws1/time-routes.test.ts` 的 `it()` 标题集合（集合相等，不允许缺失或额外）
- `it()` 总数 == 26（Round 3 冻结数量）
- 该文件能被 brain vitest 的 `include` 模式 `src/**/*.test.*` 匹配（路径验证即可）

**ARTIFACT 覆盖**:
- 见 contract-dod-ws1.md 条目 A7-A10、A11（见 Feature 7 的 CI hook）

---

## Feature 7: DevGate 集成脚本（Round 3 新增）

**行为描述**:
Reviewer Round 2 指出"测试等价性校验需要可执行的 CI hook"。本 Feature 要求 Generator 在 `scripts/devgate/check-contract-test-copy.sh` 建立独立校验脚本，让 CI / Reviewer 可以通过单一命令（`bash scripts/devgate/check-contract-test-copy.sh`）验证：

1. 合同测试文件 `sprints/tests/ws1/time-routes.test.ts` 存在
2. 实现测试文件 `packages/brain/src/__tests__/routes/time-routes.test.ts` 存在
3. 两份文件的 `it()` 标题**集合严格相等**（脚本用 `grep -oE "\\bit\\(['\"][^'\"]+"` 提取，`sort -u` 后 `diff` 比对，非 0 退出码）
4. `it()` 总数 == 26

**硬阈值**:
- `scripts/devgate/check-contract-test-copy.sh` 文件存在且有执行权限（`test -x`）
- 当合同与实现测试 `it()` 集合不一致时，脚本以非 0 退出码退出
- 当两者一致且数量为 26 时，脚本以 0 退出码退出
- 脚本输出（stdout 或 stderr）在 mismatch 时必须包含 `mismatch` 或 `diff` 关键字，便于 CI 日志可读

**ARTIFACT 覆盖**:
- 见 contract-dod-ws1.md 条目 A12、A13

**二重保险**: 保留 Round 2 的内嵌 `node -e` 主校验（A8），即使 Generator 把 devgate 脚本写错（例如写成 `exit 0`），主校验仍能独立抓漂移。

---

## Workstreams

workstream_count: 1

### Workstream 1: 时间查询路由模块 + Server 挂载 + 集成测试 + DevGate 脚本

**范围**: 新增 `packages/brain/src/routes/time.js`（三端点实现）+ `packages/brain/server.js` 挂载（2 行改动）+ 集成测试 `packages/brain/src/__tests__/routes/time-routes.test.ts`（从合同原样复制）+ `scripts/devgate/check-contract-test-copy.sh`（Round 3 新增）。端点实现零依赖 DB、零依赖外部服务，仅用 Node 原生 `Date` / `Intl.DateTimeFormat`。
**大小**: S（预估 <150 行总改动：time.js ~70-90 行 + 测试复制 ~260 行 + devgate shell ~30 行 + server.js +2 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件（canonical）**: `sprints/tests/ws1/time-routes.test.ts`
**CI 执行位置**: `packages/brain/src/__tests__/routes/time-routes.test.ts`（Generator 原样复制，只允许调整 import 路径）
**CI 校验脚本**: `scripts/devgate/check-contract-test-copy.sh`（Generator 新建）

---

## Test Contract

| Workstream | Test File (canonical) | BEHAVIOR 覆盖（it 数） | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/time-routes.test.ts` | 26 个 it（iso×6 / unix×4 / tz-happy×8 / tz-error×8） | `npx vitest run sprints/tests/ws1/` → 26 failures（模块 `packages/brain/src/routes/time.js` 不存在，getApp() dynamic import 抛出，每个 it 独立 FAIL） |

**Proposer Round 3 本地 Red evidence**:
- 命令: `npx vitest run sprints/tests/ws1/ --reporter=verbose`（从 /workspace root 跑，绕开 brain vitest.config.js 的 include 过滤）
- 结果: `Test Files 1 failed (1) / Tests 26 failed (26) / Duration ~1s`
- 红原因: `Failed to load url ../../../packages/brain/src/routes/time.js (resolved id: ../../../packages/brain/src/routes/time.js) in /workspace/sprints/tests/ws1/time-routes.test.ts. Does the file exist?` — 实现尚未编写，符合 TDD Red 阶段预期；每个 it 独立 `await getApp()` 故独立 fail（非 beforeAll 一次 fail 污染全局）
- 完整日志: `/tmp/ws1-r3-red.log`

---

## 变更统计（Round 3 vs Round 2 vs Round 1）

| 维度 | Round 1 | Round 2 | Round 3 | 增量（R3 vs R2） |
|---|---|---|---|---|
| it 总数 | 19 | 24 | 26 | +2（duplicated tz × 2） |
| Feature 数 | 5 | 6 | 7 | +1（Feature 7：devgate 脚本） |
| ARTIFACT 条目数 | 11 | 14 | 15 | +1（devgate 脚本存在 + hook 二重保险；A11 主校验保留） |
| 硬阈值正则 | 0 | 2（iso UTC / timezone offset） | 2（不变） | 0 |
| 测试时钟策略 | 真实时钟 | 真实时钟 | `vi.useFakeTimers` 冻结到 2026-04-23T10:00:00.000Z（toFake=['Date']） | 阻断性修复 |
| query 数组语义 | 未定义 | 未定义 | 400 + error message 必含 single/one/string/array/multiple/duplicat 之一 | 阻断性修复 |
| CI 校验 hook | node -e 内嵌 | node -e 内嵌（更强） | node -e 内嵌 + scripts/devgate/check-contract-test-copy.sh（二重保险） | 工程强化 |

---

## Round 3 风险自陈（供 Reviewer 挑战）

1. **fake timer 与 supertest 兼容性**：`toFake: ['Date']` 只 fake Date，保留 setTimeout/setInterval，已在本地 `npx vitest run sprints/tests/ws1/` 确认 26 测试能正常跑到 assertion（非挂住）。若 Generator 实现 `time.js` 时引入了类似 `process.hrtime.bigint()` 之类的非 Date 时间源，within-10s 断言会失败——这是**合同要求**（spec 就是要求实现读 `Date.now()`）。
2. **Intl.DateTimeFormat 对 fake 后的 Date 是否产出正确 DST**：`Intl.DateTimeFormat` 不依赖系统当前时间判断 DST，而是对给定 Date 实例做时区查表。只要 `new Date()` 返回的是 2026-04-23 的时刻（即被 fake），DST 就确定。2026 年美国 DST 窗口 = 2026-03-08 至 2026-11-01（根据 IANA tz data），冻结时刻位于窗口内 → `America/New_York` → UTC-4 → `-04:00`。
3. **duplicated tz 的判定语义**：spec 要求"数组 → 400"，但 Generator 可能选择 `Array.isArray(req.query.tz)` 显式判断，也可能用 `typeof req.query.tz !== 'string'` 宽判。合同**不限定实现手段**，只要 query string 中出现 ≥2 个 tz 时测试通过即可。
4. **devgate 脚本的具体实现细节留给 Generator**：Proposer 只写 spec（输入/退出码/mismatch keyword），不写 shell 实现。若 Reviewer 希望连 shell 实现的算法（`diff <(grep) <(grep)`）也写进合同，下轮可细化。
