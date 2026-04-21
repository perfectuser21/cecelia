# Sprint Contract Draft (Round 3)

对应 PRD: `sprints/sprint-prd.md` — Brain GET /api/brain/time 端点

## Round 2 Reviewer 反馈回应（VERDICT: REVISION）

| 来源 | Reviewer 指出 | Round 3 回应 |
|---|---|---|
| Risk 3（静态正则脆弱） | Round 2 新增的 `readFileSync(server.js)` 静态四 it 对合法多行写法、分号变化、IIFE 内部注册等风格敏感，会误杀 Generator 的合法实现；建议"放松正则"或"放弃静态检查走 supertest 主路线" | 采用 Reviewer 推荐路径 ②（收敛）：**删除 BEHAVIOR-STATIC describe**（`sprints/tests/ws1/time.test.js` 原 96–131 行 4 个 it 全部移除），挂载点完整性由 DoD ARTIFACT 负责静态兜底，"从 server.js 入口真实可达"由 DoD 强制的 `packages/brain/tests/time.test.js` import server.js default export + supertest 锁死 |
| 非阻塞观察（CI 开销） | `sleep 1.1 秒` 给每次 CI 加 ~1.1s 固定开销 | 调整为 `1050ms` — 足以跨越一个 Date.now() 秒边界（unix 秒取整必递增），同时省下 50ms CI 固定开销；不牺牲检测能力 |
| 非阻塞观察（PRD 用词） | PRD "预期受影响文件" 说 `新增一行 require`，与实际 ESM `import` 不一致；合同已自行修正 | 本轮在此显式说明：PRD 的 "require" 是 CommonJS 术语惯性，**合同以 ESM `import` 为准**（见 DoD `packages/brain/server.js` 顶部 `import timeRoutes from './src/routes/time.js'` 一条）；若 PRD 更新窗口允许，建议 Planner 在下一次刷新 PRD 时把 "require" 改成 "import"，避免"合同跑偏"的误读 |

## Round 1 Reviewer 反馈回应（Round 2 已处理，保留索引）

| 风险 | Reviewer 指出 | Round 2 回应 |
|---|---|---|
| 风险 2（timezone 硬阈值弱） | `typeof === 'string' && length > 0` 放行 `"abc"` / `"1"` / `""`（trim 前） | 新增硬阈值：timezone 必须匹配 IANA 正则 `^(UTC\|[A-Za-z_]+/[A-Za-z_]+(/[A-Za-z_]+)?)$`；新增 `timezone round-trips through Intl.DateTimeFormat` 测试（非法 IANA 会抛 RangeError）|
| 风险 3（BEHAVIOR 从未触碰 server.js） | 7 个 it 全挂私有 `express()`，笔误 `/api/brain/times` 或条件分支注册都能过 | Round 2 采用双管齐下（新增 BEHAVIOR-STATIC 4 it + DoD 强制生产侧 supertest）；**Round 3 按 Reviewer 反馈收敛为后一半**，静态 4 it 移除，保留 DoD 兜底 |

---

## Feature 1: GET /api/brain/time 时间探针端点

**行为描述**:
Brain 暴露一个无鉴权、无副作用的只读 HTTP 端点，调用方通过 `GET /api/brain/time` 拿到 Brain 进程当前的标准化时间信息。每次调用独立计算当前时间，不缓存，字段严格为 `iso` / `timezone` / `unix` 三项。三个字段同源同一时刻，`iso` 与 `unix` 之间必须自洽。路由必须从 `packages/brain/server.js` 顶层入口挂载到 `/api/brain/time`，且必须通过"生产侧测试 import server.js default export 并 supertest GET"这一真实端到端路径可达。

**硬阈值**:

- HTTP 状态码严格 `200`
- 响应 `Content-Type` 以 `application/json` 开头
- 响应体顶层字段名排序后等于 `['iso', 'timezone', 'unix']`（不多不少）
- `iso` 匹配正则 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`（UTC 毫秒 ISO-8601）
- `timezone` 满足：
  - `typeof === 'string'` 且 `length > 0`
  - 匹配 IANA 正则 `^(UTC|[A-Za-z_]+/[A-Za-z_]+(/[A-Za-z_]+)?)$`
  - 能被 `new Intl.DateTimeFormat('en-US', { timeZone })` 接受（非法值会抛 RangeError）
- `unix` 满足 `Number.isInteger === true`，且落在调用前后 1 秒窗口内
- `|Math.floor(new Date(iso).getTime()/1000) - unix| <= 1`
- 两次调用之间 sleep **1.05 秒**（Round 3 CI 省 50ms），`unix` 严格递增（禁止缓存/静态值）
- **server.js 挂载完整性**（由 DoD ARTIFACT 强制，Round 3 放宽正则 — 容忍分号/空白/换行变化，但字面量、零缩进、防笔误核心不变）：
  - 顶部出现行级精确 `import timeRoutes from './src/routes/time.js'`（分号可选）
  - 出现 `app.use('/api/brain/time', timeRoutes)` 调用（路径字面量精确；`\s*` 允许任意空白/换行；`;?` 允许分号可选）
  - 该 `app.use(...)` 必须至少出现一行以 `app.use(` **零缩进起始**（顶层注册，不允许在 `if`/`try`/`else`/函数体内）
  - 禁止 `/api/brain/times` / `/api/brain/timer` 等笔误（负向前瞻 `(?![A-Za-z0-9_])`）
- **从 server.js 入口真实可达**：`packages/brain/tests/time.test.js` 必须 import `packages/brain/server.js` default export 并用 supertest 发起 `GET /api/brain/time` 返回 200（这是 Reviewer 风险 3 的真正端到端锁，替代 Round 2 的静态四 it）

**BEHAVIOR 覆盖**（落在 `sprints/tests/ws1/time.test.js` — Round 3 共 **8 个 it**，均走私有 express + supertest）:

- `it('responds with HTTP 200 and application/json on GET /api/brain/time')`
- `it('response body has exactly three keys: iso, timezone, unix')`
- `it('iso is an ISO-8601 UTC millisecond string')`
- `it('timezone is a valid IANA zone matching UTC or Area/Location(/Sub)')`
- `it('timezone round-trips through Intl.DateTimeFormat without throwing')`
- `it('unix is an integer within 1 second of current wall clock')`
- `it('iso and unix represent the same moment within 1 second tolerance')`
- `it('two consecutive calls spaced 1.05 seconds return different unix values')`

（Round 2 的 4 个 BEHAVIOR-STATIC it 在 Round 3 已**全部移除**，对应验证由 DoD 承接。）

**ARTIFACT 覆盖**（写进 `contract-dod-ws1.md` — Round 3 正则放宽，核心不变）:

- `packages/brain/src/routes/time.js` 存在且 `export default` 是 Express Router
- 路由文件注册 `GET /` 处理器
- `packages/brain/server.js` 顶部 `import timeRoutes from './src/routes/time.js'`（行首精确，分号可选）
- `packages/brain/server.js` 注册 `app.use('/api/brain/time', timeRoutes)`（路径字面量精确 + `\s*` 允许换行/空白 + `;?` 允许分号可选 + 行尾 `$` with /m 标志，禁 `/api/brain/times` 形变）
- `packages/brain/server.js` 至少有一处 `app.use(` **零缩进顶层注册**，不在任何块内 — Reviewer 风险 3 的 DoD 侧兜底
- `packages/brain/tests/time.test.js` 存在
- `packages/brain/tests/time.test.js` import 真实 route 模块 `../src/routes/time.js`
- **`packages/brain/tests/time.test.js` 既 import `../server.js` default export，也 from `supertest`，且调用 `.get('/api/brain/time')`** —— 把"从 server.js 入口真实可达"锁到 Green commit（Reviewer 风险 3 的真正替代锁）
- `CLAUDE.md` 第 7 节 "Brain 知识查询工具" 区块包含字面量 `/api/brain/time`

---

## Workstreams

workstream_count: 1

### Workstream 1: GET /api/brain/time 端点 + 路由注册 + 文档同步

**范围**:

1. 新增 `packages/brain/src/routes/time.js`（Express Router，`GET /` 返回 `{iso, timezone, unix}`）
2. 在 `packages/brain/server.js` 顶部 `import timeRoutes from './src/routes/time.js'` + 在路由注册区（**顶层零缩进**）增加 `app.use('/api/brain/time', timeRoutes)`
3. 新增 `packages/brain/tests/time.test.js`（必须既 import `../src/routes/time.js` 做私有 supertest，**又 import `../server.js` default export 做真实 supertest**）
4. `CLAUDE.md` 第 7 节 "Brain 知识查询工具" 追加一行说明此端点

**大小**: S（总改动预计 <100 行）

**依赖**: 无（纯增量，不依赖其他 workstream）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/time.test.js`（8 个 it）

**时区取值策略**（对应 PRD ASSUMPTION）:

1. 优先 `process.env.TZ`（必须先用 `Intl.DateTimeFormat` 校验 IANA 合法性，不合法降级）
2. 次选 `Intl.DateTimeFormat().resolvedOptions().timeZone`
3. 仍缺或非 IANA → `'UTC'`

每次响应都重新计算，禁止模块级缓存。

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/time.test.js` | **8 个功能 it**（Round 2 的 4 个 BEHAVIOR-STATIC 已按 Reviewer 建议删除） | `npx vitest run --config ./vitest.sprint.config.mjs` → **8 tests failed (8)**（动态 import `packages/brain/src/routes/time.js` 不存在 → 每个 it 独立红）|

**运行命令**:

```bash
npx vitest run --config ./vitest.sprint.config.mjs --reporter=verbose
```

---

## Red 证据说明（Round 3 本地实跑）

```
 Test Files  1 failed (1)
      Tests  8 failed (8)
```

根因：`packages/brain/src/routes/time.js` 在 Red 阶段不存在，`getApp()` 内 `await import('../../../packages/brain/src/routes/time.js')` 抛 `Failed to load url ... Does the file exist?`，每个 it 独立红。

Generator commit 2 的职责：
1. 创建 `packages/brain/src/routes/time.js`（Express Router，`GET /` 返回 `{iso, timezone, unix}` 并走"`process.env.TZ` → Intl → UTC"三级时区策略）
2. 在 `packages/brain/server.js` 顶部加 `import timeRoutes from './src/routes/time.js'`，并在顶层零缩进处 `app.use('/api/brain/time', timeRoutes)`
3. 新增 `packages/brain/tests/time.test.js`：import `../src/routes/time.js` 做私有 supertest（覆盖基础行为）**且** import `../server.js` default export 做真实 supertest（锁"入口可达"）
4. `CLAUDE.md` 第 7 节追加 `GET /api/brain/time` 一行

届时 `sprints/tests/ws1/time.test.js` 的 8 个 it 全部转 Green，DoD 10 条 ARTIFACT 命令全部 exit 0。
