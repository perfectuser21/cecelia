# Sprint Contract Draft (Round 2)

> **被测对象**: Brain `/api/brain/build-info` 只读端点
> **PRD 来源**: `sprints/sprint-prd.md`
> **PROPOSE_ROUND**: 2
> **本轮修订**: 处理上轮 Reviewer 提出的 R-001 / R-002 / R-003（详见 `## Risks & Mitigations`），并保留前轮已落进合同的 R2 / R3 / R4 + Cascade 加固（见末尾"## Reviewer 反馈处理矩阵"）

---

## Feature 1: GET /api/brain/build-info 返回三字段

**行为描述**:
对挂载后的 Brain Express app 发起 `GET /api/brain/build-info`，收到 HTTP 200，响应体是 JSON 对象，且其键集合**严格等于** `{git_sha, package_version, built_at}`。无 `db.js` / pg pool 依赖，端点保持 stateless。

**硬阈值**:
- HTTP 状态码 = 200
- `Object.keys(body).sort()` 恰好等于 `['built_at', 'git_sha', 'package_version']`（3 项，无多余键）
- `Content-Type` 包含 `application/json`

**BEHAVIOR 覆盖**（这些会在 `tests/ws1/build-info.test.js` 里落成真实 it() 块）:
- `it('GET /api/brain/build-info 返回 HTTP 200 + JSON 三字段（键集合严格等于 git_sha/package_version/built_at）')`

**ARTIFACT 覆盖**（这些会写进 `contract-dod-ws1.md`）:
- `packages/brain/src/routes/build-info.js` 文件存在
- 该文件包含 `import express` 与 `export default router`（构造 Express Router 实例）
- `packages/brain/server.js` 含 `import` 该 router + `app.use('/api/brain/build-info', ...)` 挂载语句

---

## Feature 2: built_at 启动时缓存（同进程内常量）

**行为描述**:
进程启动后第一次加载 `build-info.js` 时计算一次 `built_at`（ISO 8601 字符串），后续所有请求复用同一值。客户端可以借此判断"实例是否已重启"。

**硬阈值**:
- 同一进程内连续两次（>= 2 次）调用端点，响应 `body.built_at` 字符串完全相等（`===`）
- `body.built_at` 可被 `new Date(body.built_at).toISOString()` 还原为相同字符串（即合法 ISO 8601）
- "新模块实例 → 新 built_at"语义可被验证：`vi.useFakeTimers()` + `vi.setSystemTime(t1)` 加载一次模块，`vi.resetModules()` + `vi.setSystemTime(t2)` 重新加载，两次端点返回的 `body.built_at` 必须**不相等**且分别等于 `t1.toISOString()` / `t2.toISOString()`，证明 `built_at` 在每次模块加载时真的重算（不是常量、不被 ESM cache 默默复用）

**BEHAVIOR 覆盖**:
- `it('built_at 是合法 ISO 8601（new Date(x).toISOString() === x）')`
- `it('连续两次请求 built_at 字段值完全相等（启动时缓存）')`
- `it('vi.resetModules + 重新 dynamic import 后 built_at 必然变化（覆盖 R-002 ESM cache 假阳性风险）')`

**ARTIFACT 覆盖**:
- `build-info.js` 内含模块级 `new Date().toISOString()` 一次性求值证据（不在 handler 内每次调用都重算）

---

## Feature 3: package_version 来自 packages/brain/package.json（用 readFileSync + JSON.parse）

**行为描述**:
`body.package_version` 严格等于 `packages/brain/package.json` 中 `version` 字段的当前值，绑定到 monorepo 的真实 brain 版本，不是硬编码字符串、不是 `'unknown'`、不是空字符串。

**硬阈值**:
- `body.package_version === JSON.parse(readFileSync('packages/brain/package.json','utf8')).version`
- `body.package_version` 是非空字符串，且匹配 semver 形如 `\d+\.\d+\.\d+`（允许 `-rc1` 等后缀）

**BEHAVIOR 覆盖**:
- `it('package_version 严格等于 packages/brain/package.json 的 version 字段')`

**ARTIFACT 覆盖**（新增 R2 收口）:
- `build-info.js` 含 `readFileSync(...package.json...)` 调用 + `JSON.parse` 解析
- `build-info.js` **不**得使用 `import ... from '...package.json' assert { type: 'json' }`（Node 版本不稳定，CI 容器可能直接抛 SyntaxError）

---

## Feature 4: git_sha 读取失败时回退为 'unknown'（catch 全部 Error 子类，不限 code）

**行为描述**:
当 `child_process.execSync('git rev-parse HEAD')` 抛**任何** Error（含原生 `Error`、`TypeError`、含 `code: 'ENOENT'` 的 Error、`Error.code = 128` 的子类等等），handler 不向客户端泄漏异常，端点仍返回 200，且 `body.git_sha === 'unknown'`。catch 块**不得**根据 `err.code` 分支判断而 re-throw。

**硬阈值**:
- 模拟 `child_process.execSync` 返回 `Buffer.from('abc1234567890abcdef1234567890abcdef12345\n')` → `body.git_sha === 'abc1234567890abcdef1234567890abcdef12345'`（trim 后纯 SHA，不含换行）
- 模拟 `child_process.execSync` 抛 generic `Error('not a git repository')` → HTTP 200 + `body.git_sha === 'unknown'`
- 模拟 `child_process.execSync` 抛带 `code: 'ENOENT'` 的 Error → HTTP 200 + `body.git_sha === 'unknown'`
- 模拟 `child_process.execSync` 抛 `TypeError` 子类 → HTTP 200 + `body.git_sha === 'unknown'`
- 任何 mock 场景下 HTTP 状态码绝不 = 500
- **R-001 路径选择**：handler 调 `execSync('git rev-parse HEAD')` 时**不**显式传 `cwd` 选项，沿用进程 cwd（接受顶层 monorepo SHA 作为 build_info.git_sha）；测试断言传给 execSync 的命令字符串匹配 `/git\s+rev-parse\s+HEAD/`

**BEHAVIOR 覆盖**（R3 收口扩展 + R-001 success 路径）:
- `it('git rev-parse 成功时 body.git_sha 等于 trim 后的 stdout 字符串（覆盖 R-001 cwd/SHA-source 选择路径）')`
- `it('git rev-parse 抛 generic Error 时 git_sha 回退为字符串 unknown 且端点仍返回 200')`
- `it('git rev-parse 抛 ENOENT-coded Error 时 git_sha 回退为 unknown（CI 容器无 .git 场景）')`
- `it('git rev-parse 抛 TypeError 子类时 git_sha 回退为 unknown（catch 不限 Error 子类）')`

**ARTIFACT 覆盖**（R3 收口）:
- `build-info.js` 含 `try { ... } catch (...) { ... = 'unknown' }`
- catch 体内**不**得出现 `throw` / `if (err.code` / `err.code ===` 这类条件分支

---

## Feature 5: 公开只读端点（不受 internalAuth 中间件保护）

**行为描述**:
`/api/brain/build-info` 是无鉴权的公开诊断端点。不带任何鉴权头时也必须返回 200 + 三字段。`packages/brain/server.js` 中的 `app.use('/api/brain/build-info', ...)` 行**不得**包含 `internalAuth` 中间件。

**硬阈值**:
- supertest 不发送任何 `Authorization` / `X-Internal-Token` 头时，HTTP 状态码 = 200（不是 401）
- `app.use('/api/brain/build-info', ...)` 这一行**不**含字符串 `internalAuth`

**BEHAVIOR 覆盖**（R4 收口）:
- `it('端点是公开的：不带任何鉴权头也返回 200（不被 internalAuth 拦截）')`

**ARTIFACT 覆盖**（R4 收口）:
- `packages/brain/server.js` 中 `app.use('/api/brain/build-info', ...)` 这一行**不**含 `internalAuth`

---

## Feature 7: 挂载路径精确锁定（R-003 cascade 定位）

**行为描述**:
router 挂在 `/api/brain/build-info` 上时，`GET /api/brain/build-info` 必返回 200 三字段；但同一 app 上 `GET /api/build-info`（漏 `/brain`）和 `GET /api/brain/build-info/v1`（多余子路径）必返回 404。这条用例同时充当 BEHAVIOR 与 cascade 归因证据：当未来某天 server.js 把挂载路径写错时，此用例直接锁定问题在"挂载路径"而非"router 实现"。

**硬阈值**:
- `app.use('/api/brain/build-info', router)` 时 `GET /api/brain/build-info` HTTP = 200
- 同一 app 上 `GET /api/build-info` HTTP = 404
- 同一 app 上 `GET /api/brain/build-info/v1` HTTP = 404

**BEHAVIOR 覆盖**:
- `it('挂载到 /api/brain/build-info 时返回 200，挂错路径（如漏 /brain 或加多余前缀）时 404（覆盖 R-003 cascade 路径定位）')`

**ARTIFACT 覆盖**（R-003 收口）:
- `packages/brain/server.js` 必须含**严格字面字符串** `app.use('/api/brain/build-info'`（含单引号），用 `grep -F` 精确匹配，宽松正则可能漏过的拼写偏差直接 exit 1

---

## Feature 6: 模块可独立加载（Cascade 烟囱测试）

**行为描述**:
`packages/brain/src/routes/build-info.js` 在不启动整个 server 的情况下，单独 `import()` / `require()` 即可加载成功（不抛 SyntaxError、不依赖 db.js / pg pool / 环境变量）。该约束让 Cascade 失败时能用 `node -e` 隔离 router vs 挂载问题。

**硬阈值**:
- `node --input-type=module -e "import('./packages/brain/src/routes/build-info.js').then(m => process.exit(m.default ? 0 : 1))"` 退出码 = 0
- 加载过程不读环境变量（不引用 `process.env.DATABASE_URL` / `process.env.BRAIN_*`）

**ARTIFACT 覆盖**（Cascade 收口）:
- `build-info.js` 不 `import` 任何 `db.js` / `pg` / `pool` 相关模块
- `build-info.js` 加载时不抛错（用 `node -e import()` 验证退出码 = 0）

---

## Workstreams

workstream_count: 1

### Workstream 1: build-info 路由实现 + server.js 挂载（含 R2/R3/R4 + Cascade 加固）

**范围**:
- 新建 `packages/brain/src/routes/build-info.js`，导出 Express Router，挂 `GET /` handler，返回 `{git_sha, package_version, built_at}` 三字段
- 在 `packages/brain/server.js` `import buildInfoRoutes` 并 `app.use('/api/brain/build-info', buildInfoRoutes)`（**不**包 `internalAuth`）
- handler 不连 db.js / pg pool / internalAuth
- `built_at` 模块加载时一次性算
- `git_sha` 用 `try { ... } catch (...) { ... = 'unknown' }` 包裹 `execSync`，catch 不分支判断 `err.code`，统一回退
- `package_version` 用 `readFileSync` + `JSON.parse` 读取 `packages/brain/package.json`（**禁** `import ... assert { type: 'json' }`）
- 模块独立可加载（不依赖 db / 不读环境变量）

**大小**: S（实现 ~30-50 行 + 挂载 ~2 行 + 测试 ~140-180 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/build-info.test.js`

---

## Risks & Mitigations

> **本轮 Reviewer 反馈**要求至少列 2 条具名风险 + mitigation。本轮列出 3 条，覆盖测试边界、ESM cache 假阳性、cascade 失败定位。每条均有对应 BEHAVIOR/ARTIFACT 落点。

### R-001 — git rev-parse 在 monorepo 子目录执行时返回上层仓库 SHA 而非 brain 子包 SHA

**风险描述**:
PRD 没有显式区分"返回顶层 monorepo SHA"还是"brain 子包 SHA"。`execSync('git rev-parse HEAD')` 默认 cwd 是进程当前工作目录（启动 Brain 的目录），在 monorepo 中通常返回顶层 SHA。如果未来引入 git submodule，行为会漂移；如果实现侧切到 `__dirname` 求 SHA，又会拿到一个语义不同的值，PR review 时分不清是 bug 还是设计意图。

**Mitigation**:
- **明确选择**：本合同采取"接受顶层仓库 SHA 作为 `build_info.git_sha`"，因为 (a) brain 是 monorepo 的一部分，顶层 SHA 已能唯一定位 brain 代码身份；(b) `execSync('git rev-parse HEAD')` 不传 `cwd` 选项，沿用进程 cwd 即可。实现侧**不应**显式 `cwd: __dirname` 切到 brain 子目录。
- **测试保障**：用 `vi.mock('child_process')` 在 success 路径返回固定 `Buffer`，断言 (a) `body.git_sha` 等于该 Buffer trim 后的字符串值（验证 handler 不做额外解析、不走子目录），(b) 传给 `execSync` 的命令字符串匹配 `/git\s+rev-parse\s+HEAD/`。失败路径继续断言 `'unknown'`（已被 Feature 4 多分支测试覆盖）。
- **路径选择记录**：本风险已在 Feature 4 行为描述中"接受 trim 后的 stdout 作为 git_sha"显式锁定，DoD ARTIFACT 不强制写 `cwd`，留给实现侧默认。

### R-002 — built_at 模块级求值在 vitest 多 test file 间被 ESM cache 复用，导致"重启检测"语义在测试中假阳性通过

**风险描述**:
PRD FR-003 要求 `built_at` 在模块加载时一次性算。如果实现错把 `built_at` 写成模块顶部 `const BUILT_AT = '2024-01-01T00:00:00.000Z'` 这类常量字符串，"连续两次请求相等"测试也会通过——因为常量永远相等。同样，如果 vitest 在多次 dynamic import 时复用同一模块实例（ESM module cache），即使实现正确，"新实例 → 新 built_at"也无法检出。两个故障模式都会让测试假阳性绿。

**Mitigation**:
- **测试保障**：新增 `it('vi.resetModules + 重新 dynamic import 后 built_at 必然变化')`。测试用 `vi.useFakeTimers()` + `vi.setSystemTime(t1)` 加载模块拿一次 `built_at`，然后 `vi.resetModules()` + `vi.setSystemTime(t2)`（`t2 - t1 > 1 hour`）重新加载，断言两次 `built_at` 不相等且分别等于 `t1.toISOString()` / `t2.toISOString()`。
- **强保障**：fake timers 让 t1/t2 是确定值，避免"两次加载实测时间差太小、毫秒分辨率不够"的 flake；常量字符串实现会被这个测试直接打红；ESM cache 复用也会被打红（两次 built_at 会相等）。
- **配套清理**：`beforeEach`/`afterEach` 必须 `vi.useRealTimers()` + `vi.resetModules()`，避免 fake timer 漏到其他用例。

### R-003 — Cascade 失败：server.js 挂载路径写错（如漏 `/brain` 写成 `/api/build-info`）但 router 本身全绿，BEHAVIOR 测因 404 全红难以归因

**风险描述**:
ARTIFACT 测试用宽松正则 `app.use\s*\(\s*['"]\/api\/brain\/build-info['"]\s*,/`，正则匹配通过即认可，但实际可能挂错路径（多余空格、加 `/v1` 前缀、漏 `/brain`）。BEHAVIOR 测试如果只 import 单独 router，发现不了挂载错误；如果硬塞 import 整个 `server.js`，会因 server.js 顶部副作用过多（`dotenv/config` + 几十个 routes import + `listenWithRetry` 起 listener）而抢端口、连 db、CI 中红得难定位。

**Mitigation**:
- **ARTIFACT 加严**：在 `contract-dod-ws1.md` 增加一条**严格字面字符串**匹配条目，使用 `grep -F` 精确寻找 `app.use('/api/brain/build-info'`（含单引号），任何拼写偏差直接 exit 1。
- **BEHAVIOR 路径锁定**：保留 router-only 测试（快、归因清晰），同时新增"路径错配 404"用例：在测试内构造 mini-app，**用合同要求的精确字符串挂载** router，断言 `GET /api/brain/build-info` 返回 200，`GET /api/build-info`（漏 `/brain`）和 `GET /api/brain/build-info/v1`（多余前缀）返回 404。这样 router 自身行为与挂载路径双向被夹住。
- **不直接 import server.js**：`grep -F` ARTIFACT + 路径错配 BEHAVIOR 已足以兜住挂载正确性，无需付出 import 整个 server.js 的副作用代价。

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/build-info.test.js` | 三字段键集合 / built_at ISO / built_at 进程内缓存一致 / **R-002 resetModules → 新 built_at** / package_version 对齐 / **R-001 git_sha success 路径 trim** / R3 generic Error / R3 ENOENT / R3 TypeError / R4 端点公开（无 internalAuth） / **R-003 路径错配 404** — 共 11 个 it | `cd /workspace && npx vitest run sprints/tests/ws1/` → 11 failures（模块尚未实现，import `../../../packages/brain/src/routes/build-info.js` 直接抛 ERR_MODULE_NOT_FOUND） |

---

## Reviewer 反馈处理矩阵

> 本轮新增 R-001 / R-002 / R-003（来自当前 prompt 反馈），R2 / R3 / R4 / Cascade 来自前轮已落进合同的反馈，全部保留。

| Reviewer 编号 | 上轮挑战 | 本轮 Mitigation 落点 |
|---|---|---|
| **R-001**（本轮） | git rev-parse 在 monorepo 子目录返回上层仓库 SHA，PRD 未区分 | (a) Feature 4 显式选择"接受顶层 SHA，handler 不传 cwd"；(b) BEHAVIOR 加 success 路径用例：`vi.mock('child_process')` 返回 Buffer，断言 trim 后字符串与命令字符串匹配 `/git rev-parse HEAD/`；(c) `## Risks & Mitigations` 栏 R-001 锁定路径选择 |
| **R-002**（本轮） | built_at 模块级求值在测试中可能被 ESM cache 复用，假阳性绿 | (a) BEHAVIOR 加 `it('vi.resetModules + 重新 dynamic import 后 built_at 必然变化')`，用 fake timers 设 t1/t2 锁定确定值；(b) `## Risks & Mitigations` 栏 R-002 解释假阳性故障模式 |
| **R-003**（本轮） | server.js 挂载路径写错时 router 全绿但 BEHAVIOR 全红，定位难 | (a) DoD ARTIFACT 加 `bash -c "grep -F \"app.use('/api/brain/build-info'\" packages/brain/server.js"` 严格字面匹配；(b) BEHAVIOR 加路径错配 404 用例（`/api/build-info` + `/api/brain/build-info/v1` 两路径都断言 404）；(c) Feature 7 单列 + `## Risks & Mitigations` 栏 R-003 解释取舍 |
| **R2** | `import '../../package.json' assert { type: 'json' }` 在某些 Node 版本不稳定 | DoD ARTIFACT 强制 `readFileSync` + `JSON.parse`，禁 import-assert 形式（dod-ws1 第 5 / 6 条）|
| **R3** | `execSync('git rev-parse HEAD')` 在 CI 容器抛 ENOENT 而非常规 error；catch 可能漏 | (a) BEHAVIOR 拆 3 个 it，分别覆盖 generic Error / ENOENT-coded / TypeError 子类；(b) ARTIFACT 强制 catch 体内**不**含 `throw` / `if (err.code` / `err.code ===`（dod-ws1 第 4 / 8 条）|
| **R4** | 端点被误接 `internalAuth` 中间件导致 401 | (a) ARTIFACT grep `app.use('/api/brain/build-info', ...)` 行不含 `internalAuth`（dod-ws1 第 11 条）；(b) BEHAVIOR 加 it：不带任何鉴权头也返回 200 |
| **Cascade** | WS1 在 CI 红时分不清 router vs 挂载问题 | DoD 加"模块独立可加载" ARTIFACT，跑 `node -e "import('./packages/brain/src/routes/build-info.js').then(m=>process.exit(m.default?0:1))"`（dod-ws1 第 12 条）|
