# Sprint Contract Draft (Round 1)

## Feature 1: GET /api/brain/build-info 构建探查端点

**行为描述**:
对外暴露一个零依赖、零鉴权的 HTTP GET 端点，返回当前 Brain 实例的构建身份三件套：`git_sha`、`package_version`、`built_at`。三个字段均在模块加载时一次性求值并缓存，所以同一进程任意次请求返回值完全一致。`git_sha` 按 (env `GIT_SHA` → 仓库 `.git` 解析 → 字符串 `"unknown"`) 顺序回退，任何一步异常都不向调用方抛错。

**硬阈值**:
- HTTP 状态码 = 200
- 响应 body 是合法 JSON
- `Object.keys(body).sort()` **严格等于** `["built_at", "git_sha", "package_version"]`（多键少键都失败）
- `body.package_version` 严格等于 `packages/brain/package.json` 的 `version` 字段
- `body.built_at` 满足 `new Date(body.built_at).toISOString() === body.built_at`（合法 ISO 8601 UTC）
- 同一进程两次请求返回的 `body.built_at` 完全相同（字符串等于）
- `body.git_sha` 是非空字符串；当 env `GIT_SHA="cafebabe123"` 在模块加载时设置，则返回 `"cafebabe123"`；当 env 为空字符串时返回 `"unknown"`
- 路由模块源码不包含 `from "../db.js"` / `from "pg"` / `from "ioredis"` / `from "bullmq"` 任意一个 import（零外部依赖）

**BEHAVIOR 覆盖**（落在 `tests/ws1/build-info.test.ts`）:
- `it('returns HTTP 200 on GET /api/brain/build-info')`
- `it('returns JSON body with exactly three keys: built_at, git_sha, package_version')`
- `it('returns package_version equal to packages/brain/package.json.version')`
- `it('returns identical built_at across two consecutive requests (cached at module load)')`
- `it('returns built_at as a valid ISO 8601 UTC timestamp')`
- `it('returns git_sha equal to GIT_SHA env value when set at module load')`
- `it('returns git_sha equal to "unknown" when GIT_SHA env is empty string at module load')`
- `it('returns 200 with non-empty git_sha string when GIT_SHA env is unset (no throw)')`

**ARTIFACT 覆盖**（落在 `contract-dod-ws1.md`）:
- `packages/brain/src/routes/build-info.js` 文件存在
- `packages/brain/src/routes/build-info.js` 内含 `Router` 引用且有 default export
- `packages/brain/server.js` 含 `app.use('/api/brain/build-info', ...)` 挂载
- `packages/brain/Dockerfile` 含 `ARG GIT_SHA` 行
- `packages/brain/Dockerfile` 含 `ENV GIT_SHA=$GIT_SHA` 行
- `packages/brain/src/__tests__/build-info.test.js` 存在且 import supertest（PRD SC-004 强制）
- `packages/brain/src/routes/build-info.js` 不 import db.js / pg / ioredis / bullmq

---

## Workstreams

workstream_count: 1

### Workstream 1: build-info endpoint（端点 + 挂载 + 容器注入 + 测试）

**范围**: 完整实现 `/api/brain/build-info` 端点。包含 4 个文件的改动：
- 新增 `packages/brain/src/routes/build-info.js`（路由模块本体，含 git_sha/package_version/built_at 解析与缓存）
- 修改 `packages/brain/server.js`（增加 `app.use('/api/brain/build-info', buildInfoRoutes)` 一行）
- 修改 `packages/brain/Dockerfile`（增加 `ARG GIT_SHA` + `ENV GIT_SHA=$GIT_SHA` 两行）
- 新增 `packages/brain/src/__tests__/build-info.test.js`（PRD SC-004 要求的 brain 内部 supertest 测试）

强内聚：四个文件都服务于"暴露 build-info 端点"这一个目标，相互独立编辑但共同验证。

**大小**: S（< 150 行净增）

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/build-info.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/build-info.test.ts` | HTTP 200 / 三键且仅三键 / package_version 一致 / built_at 缓存稳定 / built_at 合法 ISO / git_sha 取自 env / git_sha 空串走 unknown / 未设 GIT_SHA 不抛 | `npx vitest run sprints/tests/ws1/` → 8 failures（routes/build-info.js 不存在） |

---

## 拆分理由

PRD 总改动量 < 150 行，所有改动都围绕同一个端点的实现，无内部独立子系统可拆。强行拆成"路由文件 / server 挂载 / Dockerfile / brain 内测试"4 个 workstream 会：
- 制造伪依赖（server.js 挂载 import 一个还不存在的模块 → 立即语法/启动报错）
- 让 8 条 BEHAVIOR 测试无法独立运行（必须等路由文件就位）
- 增加 GAN 协调成本，不带来任何独立性收益

唯一可独立的是 Dockerfile（不依赖 JS 模块），但 PRD 自己把它列为 [ARTIFACT]，无 BEHAVIOR 测试需求，单独拆 workstream 无意义。

故定 1 个 workstream，承载完整实现。
