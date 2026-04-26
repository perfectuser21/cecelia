# Sprint Contract Draft (Round 1)

源 PRD：`sprints/sprint-prd.md`（commit `a757f4b`）— Brain build-info 端点

---

## Feature 1: GET /api/brain/build-info HTTP 端点

**行为描述**:
Brain 进程启动后，对 `GET /api/brain/build-info` 的请求返回 200 状态码与 `application/json` 响应体；JSON 对象**恰好**包含 `git_sha`、`package_version`、`built_at` 三个 own enumerable key（不允许多余字段污染契约）。`package_version` 严格等于 `packages/brain/package.json` 中 `version` 字段在 runtime 读出的值（禁止硬编码）。`built_at` 是 ISO 8601 规范化字符串：`new Date(body.built_at).toISOString() === body.built_at`，挡住 `"2026-01-01"` 这类合法但非规范化输入。`git_sha` 在仓库元信息缺失（非 git 仓库 / shallow / 容器无 `.git` / 常见 SHA 注入环境变量被清空）时回落到非空字符串（如 `"unknown"`），从不为 `undefined` 或空串。挂载新端点后 `server.js` 现有路由（如 `/api/brain/manifest`）依然可用。

**硬阈值**:
- HTTP 响应状态码 = `200`
- `Content-Type` 包含 `application/json`
- `Object.keys(body).sort()` 严格等于 `['built_at', 'git_sha', 'package_version']`（三键集合 exact match，挡 mutation 加多余字段）
- `typeof body.git_sha === 'string'` 且 `body.git_sha.length > 0`，**即使**清空 `GIT_SHA / GIT_COMMIT / COMMIT_SHA / SOURCE_COMMIT / VERCEL_GIT_COMMIT_SHA` 等常见注入变量
- `body.package_version` 字符串 === `JSON.parse(readFileSync('packages/brain/package.json')).version`（runtime 读取，禁止硬编码 `"1.223.0"`）
- `new Date(body.built_at).toISOString() === body.built_at`（合法 ISO 8601 且为规范化格式）
- 端点路径前缀必须挂在 `/api/brain/build-info`

**BEHAVIOR 覆盖**（这些会在 `tests/ws1/` 里落成真实 it() 块）:
- `it('GET /api/brain/build-info returns 200 with content-type application/json')`
- `it('responds with exactly three own keys: git_sha / package_version / built_at (no extras)')`
- `it('package_version exactly equals the version field in packages/brain/package.json')`
- `it('built_at is a stable ISO 8601 string (round-trip via new Date().toISOString() is identity)')`
- `it('git_sha is a non-empty string even when common SHA env vars are unset')`

**ARTIFACT 覆盖**（这些会写进 `contract-dod-ws1.md`）:
- `packages/brain/src/routes/build-info.js` 文件存在
- 该文件使用 `import { Router } from 'express'` 并以 `export default router` 形式导出（与 `brain-manifest.js` 风格一致）
- 该文件注册了 `router.get('/')` 处理器
- 该文件引用 `package.json` 作为 `package_version` 来源（不允许出现硬编码的 `"1.223.0"` 字面量）
- `packages/brain/server.js` 顶部 `import buildInfoRoutes from './src/routes/build-info.js'`
- `packages/brain/server.js` 含 `app.use('/api/brain/build-info', buildInfoRoutes)` 挂载行
- 现有 `app.use('/api/brain/manifest', brainManifestRoutes)` 行未被删除（回归保护）

---

## Workstreams

workstream_count: 1

### Workstream 1: 新增 build-info Router 并挂载到 server.js

**范围**:
- 新建 `packages/brain/src/routes/build-info.js`：Express Router，GET `/` 返回 `{ git_sha, package_version, built_at }`；`package_version` 在模块加载时从 `packages/brain/package.json` 读取；`built_at` 在模块加载时一次性确定，所有请求返回相同值；`git_sha` 优先从环境变量取（`GIT_SHA / GIT_COMMIT / COMMIT_SHA / ...`），取不到时回落 `'unknown'`（绝不抛错、绝不为空）。
- 修改 `packages/brain/server.js`：在文件顶部 import 区追加 `import buildInfoRoutes from './src/routes/build-info.js';`，在第 240 行附近 `app.use('/api/brain/manifest', ...)` 紧邻位置追加 `app.use('/api/brain/build-info', buildInfoRoutes);`。
- 不修改 `package.json`、不动其他 router、不引入新的 npm 依赖。

**大小**: S（预计实现侧 < 60 行新增 + ~ 2 行 server.js 改动）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/build-info.test.js`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/build-info.test.js` | 200 + content-type / 严格三键集合 / package_version 严格相等 / built_at ISO round-trip / git_sha 非空 fallback（清空 env vars） | 共 7 个 `it()`，全部 FAIL（实现文件 `packages/brain/src/routes/build-info.js` 不存在，per-it 内 dynamic import 抛 `Failed to load url ../../../packages/brain/src/routes/build-info.js`）。本地实跑命令：`cd sprints && npx vitest run --config ./vitest.config.js`；本地实测结果：`Test Files 1 failed (1) / Tests 7 failed (7)` |

## Red Evidence（Proposer 本地实跑摘要）

```
RUN  v1.6.1 /workspace/sprints
 × tests/ws1/build-info.test.js > [BEHAVIOR] > GET /api/brain/build-info returns 200 with content-type application/json
 × tests/ws1/build-info.test.js > [BEHAVIOR] > response body has own property git_sha
 × tests/ws1/build-info.test.js > [BEHAVIOR] > response body has own property package_version
 × tests/ws1/build-info.test.js > [BEHAVIOR] > response body has own property built_at
 × tests/ws1/build-info.test.js > [BEHAVIOR] > responds with exactly three own keys: git_sha / package_version / built_at (no extras)
 × tests/ws1/build-info.test.js > [BEHAVIOR] > package_version exactly equals the version field in packages/brain/package.json
 × tests/ws1/build-info.test.js > [BEHAVIOR] > built_at is a stable ISO 8601 string (round-trip via new Date().toISOString() is identity)
 × tests/ws1/build-info.test.js > [BEHAVIOR] > git_sha is a non-empty string even when common SHA env vars are unset
Failed Tests 8
Test Files  1 failed (1)
Tests  8 failed (8)
```

## 备注

- 测试扩展名使用 `.js`：项目 brain 包是 ESM JS、无 TypeScript 配置；vitest include 模式 `*.{test,spec}.?(c|m)[jt]s?(x)` 同时接受 `.test.js` 与 `.test.ts`。选 `.js` 让测试更稳地直接 runtime 加载，无 esbuild 类型转译副作用。
- `sprints/vitest.config.js` 是合同测试专属最小配置：只 include `tests/ws*/**/*.{test,spec}.?(c|m)[jt]s?(x)`，不继承 brain 包的 mock / 大量 exclude，避免 cross-package 副作用污染合同对抗。Generator 阶段实现完成后用同一命令转绿。
- 每个 `it()` 内部用 `await import('../../../packages/brain/src/routes/build-info.js')` 动态加载被测对象。实现缺失时每个 it 各自抛 `ERR_MODULE_NOT_FOUND` 并独立 FAIL，避免 suite 顶层 import 折叠成单条错误。
