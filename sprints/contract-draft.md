# Sprint Contract Draft (Round 2)

> **被测对象**: Brain `/api/brain/build-info` 只读端点
> **PRD 来源**: `sprints/sprint-prd.md`
> **PROPOSE_ROUND**: 2
> **本轮修订**: 处理上轮 Reviewer 提出的 R2 / R3 / R4 + Cascade 对策（详见末尾"## Reviewer 反馈处理矩阵"）

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

**BEHAVIOR 覆盖**:
- `it('built_at 是合法 ISO 8601（new Date(x).toISOString() === x）')`
- `it('连续两次请求 built_at 字段值完全相等（启动时缓存）')`

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
- 模拟 `child_process.execSync` 抛 generic `Error('not a git repository')` → HTTP 200 + `body.git_sha === 'unknown'`
- 模拟 `child_process.execSync` 抛带 `code: 'ENOENT'` 的 Error → HTTP 200 + `body.git_sha === 'unknown'`
- 模拟 `child_process.execSync` 抛 `TypeError` 子类 → HTTP 200 + `body.git_sha === 'unknown'`
- 任何 mock 场景下 HTTP 状态码绝不 = 500

**BEHAVIOR 覆盖**（R3 收口扩展）:
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

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/build-info.test.js` | 三字段 / built_at ISO / built_at 缓存一致 / package_version 对齐 / git_sha 三种 Error 全 fallback / 端点公开（无 internalAuth） — 共 8 个 it | `cd packages/brain && npx vitest run /workspace/sprints/tests/ws1/` → 8 failures（模块尚未实现） |

---

## Reviewer 反馈处理矩阵（R2 / R3 / R4 + Cascade）

| Reviewer 编号 | 上轮挑战 | 本轮 Mitigation 落点 |
|---|---|---|
| **R2** | `import '../../package.json' assert { type: 'json' }` 在某些 Node 版本不稳定 | DoD ARTIFACT 强制 `readFileSync` + `JSON.parse`，禁 import-assert 形式（dod-ws1 第 5 / 6 条）|
| **R3** | `execSync('git rev-parse HEAD')` 在 CI 容器抛 ENOENT 而非常规 error；catch 可能漏 | (a) BEHAVIOR 拆 3 个 it，分别覆盖 generic Error / ENOENT-coded / TypeError 子类；(b) ARTIFACT 强制 catch 体内**不**含 `throw` / `if (err.code` / `err.code ===`（dod-ws1 第 4 / 8 条）|
| **R4** | 端点被误接 `internalAuth` 中间件导致 401 | (a) ARTIFACT grep `app.use('/api/brain/build-info', ...)` 行不含 `internalAuth`（dod-ws1 第 11 条）；(b) BEHAVIOR 加 it：不带任何鉴权头也返回 200（test 第 8 个 it）|
| **Cascade** | WS1 在 CI 红时分不清 router vs 挂载问题 | DoD 加"模块独立可加载" ARTIFACT，跑 `node -e "import('./packages/brain/src/routes/build-info.js').then(m=>process.exit(m.default?0:1))"`（dod-ws1 第 12 条）|
