# Sprint Contract Draft (Round 4)

对应 PRD: `sprints/sprint-prd.md` — Brain GET /api/brain/time 端点

## Round 3 Reviewer 反馈回应（VERDICT: REVISION）

| # | Reviewer 指出 | 级别 | Round 4 回应 |
|---|---|---|---|
| 1 | IANA 正则 `[A-Za-z_]+/[A-Za-z_]+(/[A-Za-z_]+)?` 与 round-trip 测试 / PRD FR-003 三方冲突 — 会误杀 `Etc/GMT+0` / `Etc/GMT-1`（含 `+-` 和数字）、`GMT` / `CET` / `EST` 等单节点 IANA 别名 | 阻塞 | 采纳"删正则"路径：`sprints/tests/ws1/time.test.js` 移除 `IANA_TZ_RE` 常量及其使用，IANA 合法性完全由 `round-trip through Intl.DateTimeFormat`（原生 RangeError）承担。合同硬阈值区删除 IANA 正则条目，改为"非空 string + round-trip 不抛"双锁。`it('timezone is a valid IANA zone matching UTC or Area/Location(/Sub)')` 重命名为 `it('timezone is a non-empty string')`，承担 typeof + length 检查，round-trip it 不变 |
| 2 | DoD 10 条形式未指定运行时验证，纯 `node -e`/`grep` 静态检查留下"假挂载"后门（`if(false) app.use(...)`、IIFE 内注册、静态字符串存在但从未生效都能过），风险 3 未真正闭环 | 阻塞 | 采纳"追加 vitest 运行时 DoD 条目"：`sprints/contract-dod-ws1.md` 新增 **第 11 条 ARTIFACT** — `bash -c "cd packages/brain && npx vitest run tests/time.test.js --no-coverage --reporter=basic"`。vitest exit 0 要求"server.js 挂载 + 路由行为 + 字段 schema"三者在运行时同时满足，字符串静态后门无法欺骗。DoD Test 字段白名单允许 `bash`，合规 |
| 3 | sleep 1050ms 跨秒边界在 CI 容器 timer throttling 极端情况下概率 <1% 提前返回，可选升 1100ms | 观察（非阻塞） | 采纳为保险：`sprints/tests/ws1/time.test.js` 第 81 行 `setTimeout(r, 1050)` → `setTimeout(r, 1100)`，同步更新 it 标题 `spaced 1.05 seconds` → `spaced 1.1 seconds`。CI 固定开销 +50ms 可接受，换取 timer 抖动风险归零 |

## Round 2 Reviewer 反馈回应（Round 3 已处理，保留索引）

| 来源 | Reviewer 指出 | Round 3 回应 |
|---|---|---|
| Risk 3（静态正则脆弱） | Round 2 新增的 `readFileSync(server.js)` 静态四 it 对合法多行写法、分号变化、IIFE 内部注册等风格敏感，会误杀 Generator 的合法实现 | 采用 Reviewer 推荐路径 ②（收敛）：**删除 BEHAVIOR-STATIC describe**，挂载点完整性由 DoD ARTIFACT 负责静态兜底，"从 server.js 入口真实可达"由 DoD 强制生产侧 supertest import 锁死 |
| 非阻塞观察（CI 开销） | `sleep 1.1 秒` 给每次 CI 加 ~1.1s 固定开销 | Round 3 调整为 `1050ms`（Round 4 已回退到 1100ms，见上表风险 3） |
| 非阻塞观察（PRD 用词） | PRD "新增一行 require" 与 ESM `import` 不一致 | 合同以 ESM `import` 为准 |

## Round 1 Reviewer 反馈回应（Round 2 已处理，保留索引）

| 风险 | Reviewer 指出 | Round 2 回应 |
|---|---|---|
| 风险 2（timezone 硬阈值弱） | `typeof === 'string' && length > 0` 放行 `"abc"` / `"1"` / `""`（trim 前） | Round 2 新增 IANA 正则 + round-trip。**Round 4 按 Reviewer Round 3 反馈删除 IANA 正则**，round-trip 独立承担权威校验（Intl.DateTimeFormat 对 "abc"/"1" 均抛 RangeError，语义等价于原 IANA 校验但无误杀） |
| 风险 3（BEHAVIOR 从未触碰 server.js） | 7 个 it 全挂私有 `express()` | Round 2 双管齐下（BEHAVIOR-STATIC + DoD supertest），Round 3 收敛保留 DoD supertest 一环，**Round 4 追加 DoD vitest 运行时锁作为真正闭环**（Reviewer Round 3 风险 2） |

---

## Feature 1: GET /api/brain/time 时间探针端点

**行为描述**:
Brain 暴露一个无鉴权、无副作用的只读 HTTP 端点，调用方通过 `GET /api/brain/time` 拿到 Brain 进程当前的标准化时间信息。每次调用独立计算当前时间，不缓存，字段严格为 `iso` / `timezone` / `unix` 三项。三个字段同源同一时刻，`iso` 与 `unix` 之间必须自洽。路由必须从 `packages/brain/server.js` 顶层入口挂载到 `/api/brain/time`，且必须通过"生产侧测试 import server.js default export 并 supertest GET"这一真实端到端路径可达，并且该测试在 vitest 下真实跑通（Round 4 新增闭环锁）。

**硬阈值**:

- HTTP 状态码严格 `200`
- 响应 `Content-Type` 以 `application/json` 开头
- 响应体顶层字段名排序后等于 `['iso', 'timezone', 'unix']`（不多不少）
- `iso` 匹配正则 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`（UTC 毫秒 ISO-8601）
- `timezone` 满足（Round 4：删除 IANA 字符集严格正则，避免误杀 `Etc/GMT+0` / `GMT` / `CET` 等合法别名）：
  - `typeof === 'string'` 且 `length > 0`
  - **能被 `new Intl.DateTimeFormat('en-US', { timeZone })` 接受不抛 RangeError**（IANA 权威校验，独立承担原 IANA 正则的拦截职责：`"abc"` / `"1"` / `""` 均会被 Intl 拒绝）
- `unix` 满足 `Number.isInteger === true`，且落在调用前后 1 秒窗口内
- `|Math.floor(new Date(iso).getTime()/1000) - unix| <= 1`
- 两次调用之间 sleep **1.1 秒**（Round 4：从 Round 3 的 1.05s 升回 1.1s，消除 CI timer throttling 风险），`unix` 严格递增（禁止缓存/静态值）
- **server.js 挂载完整性**（由 DoD ARTIFACT 强制，Round 3 放宽正则 — 容忍分号/空白/换行变化，但字面量、零缩进、防笔误核心不变）：
  - 顶部出现行级精确 `import timeRoutes from './src/routes/time.js'`（分号可选）
  - 出现 `app.use('/api/brain/time', timeRoutes)` 调用（路径字面量精确；`\s*` 允许任意空白/换行；`;?` 允许分号可选）
  - 该 `app.use(...)` 必须至少出现一行以 `app.use(` **零缩进起始**（顶层注册，不允许在 `if`/`try`/`else`/函数体内）
  - 禁止 `/api/brain/times` / `/api/brain/timer` 等笔误（负向前瞻 `(?![A-Za-z0-9_])`）
- **从 server.js 入口真实可达**（Round 4 双层锁）：
  - 静态锁：`packages/brain/tests/time.test.js` 必须 import `packages/brain/server.js` default export 并用 supertest 发起 `GET /api/brain/time`（DoD ARTIFACT 第 9 条，检查测试代码字符串）
  - **运行时锁**（Round 4 新增，Reviewer Round 3 风险 2 真正闭环）：**该生产侧测试在 vitest 下必须 exit 0 通过**（DoD ARTIFACT 第 11 条）—— 任何假挂载（`if(false)`、IIFE、路径笔误、import 但未注册）都会在运行时被 supertest 打回 404/500，vitest exit 非 0，DoD 失败

**BEHAVIOR 覆盖**（落在 `sprints/tests/ws1/time.test.js` — Round 4 共 **8 个 it**，均走私有 express + supertest）:

- `it('responds with HTTP 200 and application/json on GET /api/brain/time')`
- `it('response body has exactly three keys: iso, timezone, unix')`
- `it('iso is an ISO-8601 UTC millisecond string')`
- `it('timezone is a non-empty string')` — Round 4 从 `'valid IANA zone'` 改名；typeof + length 检查独立
- `it('timezone round-trips through Intl.DateTimeFormat without throwing')` — IANA 权威校验承担者
- `it('unix is an integer within 1 second of current wall clock')`
- `it('iso and unix represent the same moment within 1 second tolerance')`
- `it('two consecutive calls spaced 1.1 seconds return different unix values')` — Round 4 从 1.05s 升回 1.1s

（Round 2 的 4 个 BEHAVIOR-STATIC it 在 Round 3 已全部移除，对应验证由 DoD 承接；Round 4 在 DoD 追加运行时锁。）

**ARTIFACT 覆盖**（写进 `contract-dod-ws1.md` — Round 4 共 **11 条**，新增第 11 条为 vitest 运行时锁）:

1. `packages/brain/src/routes/time.js` 存在且 `export default` 是 Express Router
2. 路由文件注册 `GET /` 处理器
3. `packages/brain/server.js` 顶部 `import timeRoutes from './src/routes/time.js'`（行首精确，分号可选）
4. `packages/brain/server.js` 注册 `app.use('/api/brain/time', timeRoutes)`（路径字面量精确 + `\s*` 允许换行/空白 + `;?` 允许分号可选 + 行尾 `$` with /m 标志，禁 `/api/brain/times` 形变）
5. `packages/brain/server.js` 至少有一处 `app.use(` **零缩进顶层注册**，不在任何块内 — Reviewer 风险 3 的 DoD 侧兜底
6. `packages/brain/tests/time.test.js` 存在
7. `packages/brain/tests/time.test.js` import 真实 route 模块 `../src/routes/time.js`
8. **`packages/brain/tests/time.test.js` 既 import `../server.js` default export，也 from `supertest`，且调用 `.get('/api/brain/time')`** —— 把"从 server.js 入口真实可达"锁到 Green commit（字符串静态层）
9. `CLAUDE.md` 第 7 节 "Brain 知识查询工具" 区块包含字面量 `/api/brain/time`
10. **Round 4 新增** — `bash -c "cd packages/brain && npx vitest run tests/time.test.js --no-coverage --reporter=basic"` **exit 0** —— 把"入口真实可达"从"字符串存在"升级到"运行时通过"，封堵 grep 静态后门（Reviewer Round 3 风险 2 真正闭环）

（上面列 1-10，加 Round 4 新增共 11 条，DoD 文件里对应 ARTIFACT 条目顺序一致，10 条前置静态检查 + 1 条末条运行时锁。）

---

## Workstreams

workstream_count: 1

### Workstream 1: GET /api/brain/time 端点 + 路由注册 + 文档同步

**范围**:

1. 新增 `packages/brain/src/routes/time.js`（Express Router，`GET /` 返回 `{iso, timezone, unix}`）
2. 在 `packages/brain/server.js` 顶部 `import timeRoutes from './src/routes/time.js'` + 在路由注册区（**顶层零缩进**）增加 `app.use('/api/brain/time', timeRoutes)`
3. 新增 `packages/brain/tests/time.test.js`（必须既 import `../src/routes/time.js` 做私有 supertest，**又 import `../server.js` default export 做真实 supertest**）—— Round 4 DoD 追加要求该文件在 vitest 下真实 exit 0 通过
4. `CLAUDE.md` 第 7 节 "Brain 知识查询工具" 追加一行说明此端点

**大小**: S（总改动预计 <100 行）

**依赖**: 无（纯增量，不依赖其他 workstream）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/time.test.js`（8 个 it）

**时区取值策略**（对应 PRD ASSUMPTION）:

1. 优先 `process.env.TZ`（必须先用 `Intl.DateTimeFormat` 校验 IANA 合法性，不合法降级；Round 4 删除正则层后，Intl 校验是唯一合法性闸门）
2. 次选 `Intl.DateTimeFormat().resolvedOptions().timeZone`
3. 仍缺或非 IANA → `'UTC'`

每次响应都重新计算，禁止模块级缓存。

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/time.test.js` | **8 个功能 it**（Round 4：IANA 正则 it 重命名为非空 string + round-trip 独立承担；sleep 1.05s→1.1s） | `npx vitest run --config ./vitest.sprint.config.mjs` → **8 tests failed (8)**（动态 import `packages/brain/src/routes/time.js` 不存在 → 每个 it 独立红）|

**运行命令**:

```bash
npx vitest run --config ./vitest.sprint.config.mjs --reporter=verbose
```

**DoD 运行时锁附加运行命令**（Round 4 新增，Green 阶段验证）:

```bash
cd packages/brain && npx vitest run tests/time.test.js --no-coverage --reporter=basic
```

此命令在 Red 阶段也会失败（`packages/brain/tests/time.test.js` 尚不存在），在 Green commit 完成后必须 exit 0。

---

## Red 证据说明（Round 4 本地实跑）

```
 Test Files  1 failed (1)
      Tests  8 failed (8)
```

根因：`packages/brain/src/routes/time.js` 在 Red 阶段不存在，`getApp()` 内 `await import('../../../packages/brain/src/routes/time.js')` 抛 `Failed to load url ... Does the file exist?`，每个 it 独立红。

DoD 第 11 条（vitest 运行时锁）在 Red 阶段也为红（`packages/brain/tests/time.test.js` 尚不存在 → vitest exit 非 0），等待 Green commit 后转绿。

Generator commit 2 的职责：
1. 创建 `packages/brain/src/routes/time.js`（Express Router，`GET /` 返回 `{iso, timezone, unix}` 并走"`process.env.TZ` → Intl → UTC"三级时区策略；TZ 合法性用 `new Intl.DateTimeFormat('en-US', { timeZone })` 判断，不用正则）
2. 在 `packages/brain/server.js` 顶部加 `import timeRoutes from './src/routes/time.js'`，并在顶层零缩进处 `app.use('/api/brain/time', timeRoutes)`
3. 新增 `packages/brain/tests/time.test.js`：import `../src/routes/time.js` 做私有 supertest（覆盖基础行为）**且** import `../server.js` default export 做真实 supertest（锁"入口可达"）—— Round 4 DoD 第 11 条强制此测试本身必须 vitest exit 0
4. `CLAUDE.md` 第 7 节追加 `GET /api/brain/time` 一行

届时 `sprints/tests/ws1/time.test.js` 的 8 个 it 全部转 Green，DoD 11 条 ARTIFACT 命令全部 exit 0（含第 11 条 vitest 运行时通过）。
