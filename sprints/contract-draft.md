# Sprint Contract Draft (Round 1)

> **被测对象**: Brain `/api/brain/build-info` 只读端点
> **PRD 来源**: `sprints/sprint-prd.md`
> **PROPOSE_ROUND**: 1

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
- `build-info.js` 内含 `new Date().toISOString()` 模块级一次性求值证据（不在 handler 内每次调用都重算）

---

## Feature 3: package_version 来自 packages/brain/package.json

**行为描述**:
`body.package_version` 严格等于 `packages/brain/package.json` 中 `version` 字段的当前值，绑定到 monorepo 的真实 brain 版本，不是硬编码字符串、不是 `'unknown'`、不是空字符串。

**硬阈值**:
- `body.package_version === require('packages/brain/package.json').version`
- `body.package_version` 是非空字符串，且匹配 semver 形如 `\d+\.\d+\.\d+`（允许 `-rc1` 等后缀）

**BEHAVIOR 覆盖**:
- `it('package_version 严格等于 packages/brain/package.json 的 version 字段')`

**ARTIFACT 覆盖**:
- `build-info.js` 含从 `package.json` 读取 version 的代码（`readFileSync` 解析 JSON 或 `import` 断言 JSON）

---

## Feature 4: git_sha 读取失败时回退为 'unknown'（不抛异常）

**行为描述**:
当 `child_process.execSync('git rev-parse HEAD')` 抛异常（例如运行环境不在 git working tree 内、`.git` 缺失），handler 不向客户端泄漏异常，端点仍返回 200，且 `body.git_sha === 'unknown'`。

**硬阈值**:
- 模拟 `child_process.execSync` 抛错的场景下，HTTP 状态码 = 200（**不**是 500）
- `body.git_sha === 'unknown'`（字符串字面量，不是 `null`、不是空串）

**BEHAVIOR 覆盖**:
- `it('git rev-parse 抛异常时 git_sha 回退为字符串 unknown 且端点仍返回 200')`

**ARTIFACT 覆盖**:
- `build-info.js` 含 `try { ... } catch` 包裹 git SHA 读取，catch 分支显式赋值 `'unknown'`

---

## Workstreams

workstream_count: 1

### Workstream 1: build-info 路由实现 + server.js 挂载

**范围**:
- 新建 `packages/brain/src/routes/build-info.js`，导出 Express Router，挂 `GET /` handler，返回 `{git_sha, package_version, built_at}` 三字段
- 在 `packages/brain/server.js` `import buildInfoRoutes` 并 `app.use('/api/brain/build-info', buildInfoRoutes)`
- handler 不连 db.js / pg pool / internalAuth；`built_at` 模块加载时一次性算；`git_sha` 用 try/catch 包裹 `execSync`，失败回退 `'unknown'`；`package_version` 从 `packages/brain/package.json` 读取

**大小**: S（实现 ~30-50 行 + 挂载 ~2 行 + 测试 ~80-100 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/build-info.test.js`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/build-info.test.js` | 三字段 / built_at ISO / built_at 缓存一致 / package_version 对齐 / git_sha fallback（共 5 个 it） | `cd packages/brain && npx vitest run /workspace/sprints/tests/ws1/` → 5 failures（模块尚未实现） |
