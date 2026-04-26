# Sprint Contract Draft (Round 1)

> **被测对象**: Brain `/api/brain/build-info` 端点（PRD: sprints/sprint-prd.md）
> **PRD 事实修正**：PRD SC-002 写"`packages/brain/src/server.js`"，但仓库实际 server.js 位于 `packages/brain/server.js`（Brain 的入口约定，对照 `packages/brain/package.json` 的 `"main": "server.js"`）。本合同按真实路径 `packages/brain/server.js` 验证 mount。这是事实层修正，不改 PRD 行为意图。

---

## Feature 1: GET /api/brain/build-info 返回构建身份三元组

**行为描述**:
当 Brain HTTP 服务挂载 build-info 路由后，外部以 HTTP GET 访问 `/api/brain/build-info` 时，端点必须返回 200 状态码、`application/json` Content-Type、且响应体是一个**仅含**三个字段的 JSON 对象：`git_sha`（字符串）、`package_version`（字符串）、`built_at`（字符串）。三个字段必须都是字符串，不允许 null/undefined/数字/对象。

**硬阈值**:
- HTTP status === 200
- response.headers['content-type'] 匹配 `/application\/json/`
- `Object.keys(body).sort()` 严格等于 `['built_at','git_sha','package_version']`（多一个字段或少一个字段都判负）
- 三个字段 `typeof` 都必须是 `'string'`，且长度 > 0

**BEHAVIOR 覆盖**（落到 tests/ws1/build-info.test.ts）:
- `it('returns 200 with application/json content-type')`
- `it('body contains exactly the three keys git_sha / package_version / built_at')`
- `it('all three fields are non-empty strings')`

**ARTIFACT 覆盖**（落到 contract-dod-ws1.md）:
- `packages/brain/src/routes/build-info.js` 存在且 default-export 一个 Express Router

---

## Feature 2: built_at 在进程启动时一次性确定且后续稳定

**行为描述**:
模块第一次被加载时，端点必须把当前时刻 `new Date().toISOString()` 缓存到模块作用域；后续所有请求都返回同一个字符串（用于外部检测进程是否被重启 —— 如果 built_at 变了，说明进程重启了）。

**硬阈值**:
- 同一进程内连续两次 `GET /api/brain/build-info`，`response.body.built_at` 字符串严格相等（`r1.body.built_at === r2.body.built_at`）
- `built_at` 必须能 round-trip 通过 `new Date(v).toISOString()` 校验，即合法 ISO 8601 时间戳（如 `2026-04-26T11:05:33.000Z`）

**BEHAVIOR 覆盖**（落到 tests/ws1/build-info.test.ts）:
- `it('built_at is a valid ISO 8601 string (round-trip equal)')`
- `it('built_at is identical across two requests within the same process')`

**ARTIFACT 覆盖**: 无（纯运行时行为）

---

## Feature 3: package_version 与 packages/brain/package.json 的 version 字段一致

**行为描述**:
`response.body.package_version` 必须等于 `packages/brain/package.json` 文件的 `version` 字段。这意味着实现不能写死版本号，必须从 package.json 读取（任何 bump 都自动跟随）。

**硬阈值**:
- `body.package_version === JSON.parse(readFileSync('packages/brain/package.json')).version`

**BEHAVIOR 覆盖**（落到 tests/ws1/build-info.test.ts）:
- `it('body.package_version equals packages/brain/package.json version field')`

**ARTIFACT 覆盖**: 无

---

## Feature 4: git_sha 是 40 位 hex 或字符串 "unknown"

**行为描述**:
正常情况下，`git_sha` 是一个 40 位小写十六进制字符串（`git rev-parse HEAD` 的输出）。当 git 命令不可用 / 当前不在 git 仓库时，端点不能崩溃也不能返回 500，必须把 `git_sha` 字段填成字面量字符串 `"unknown"`，HTTP 仍返回 200。

**硬阈值**:
- `git_sha` 字段值要么匹配 `/^[0-9a-f]{40}$/`，要么严格等于字符串 `"unknown"`（其他任何字符串都判负，特别防止"实现写了 'TBD' 或空串蒙混过关"）
- 当 `child_process.execSync` 被 mock 抛错时，HTTP status 仍是 200，且 `git_sha === 'unknown'`

**BEHAVIOR 覆盖**（落到 tests/ws1/build-info-git-fallback.test.ts）:
- `it('git_sha is either 40-char lowercase hex or the literal string "unknown"')`（在主测试文件，覆盖正常情况）
- `it('returns 200 and git_sha="unknown" when git command throws')`（在 fallback 测试文件，mock child_process）

**ARTIFACT 覆盖**: 无

---

## Feature 5: server.js 在 /api/brain/build-info 路径挂载该 Router

**行为描述**:
`packages/brain/server.js`（注：仓库实际入口路径，PRD SC-002 描述的 `src/server.js` 与代码事实不符）必须 import build-info 路由模块，并通过 `app.use('/api/brain/build-info', ...)` 挂载到 Express app 上。挂载缺失会导致端点 404。

**硬阈值**:
- `packages/brain/server.js` 文件包含一行 `app.use('/api/brain/build-info', ...)`（带前缀 path 的精确字面量）
- `packages/brain/server.js` 包含 `from './src/routes/build-info.js'` 的 ESM import 语句

**BEHAVIOR 覆盖**: 无（mount 是装配产出物，BEHAVIOR 由 Feature 1-4 通过 supertest 端到端覆盖）

**ARTIFACT 覆盖**（落到 contract-dod-ws1.md）:
- `packages/brain/server.js` 通过 `app.use('/api/brain/build-info', ...)` 挂载该路由
- `packages/brain/server.js` 含 `import ... from './src/routes/build-info.js'` 行

---

## Workstreams

workstream_count: 1

### Workstream 1: build-info Router + server.js mount

**范围**:
- 新建 `packages/brain/src/routes/build-info.js`，使用 `express.Router()`，注册 `GET /` handler，返回 `{git_sha, package_version, built_at}` 三元组；`built_at` 在模块顶层用 `const BUILT_AT = new Date().toISOString();` 缓存；`git_sha` 在模块顶层用 `try { execSync('git rev-parse HEAD', { stdio: ['ignore','pipe','ignore'] }).toString().trim() } catch { 'unknown' }` 解析；`package_version` 通过 `readFileSync(resolve(__dirname,'../../package.json'))` 读出。
- 修改 `packages/brain/server.js`：加 `import buildInfoRoutes from './src/routes/build-info.js';` 与 `app.use('/api/brain/build-info', buildInfoRoutes);`。

**大小**: S（总改动 < 80 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**:
- `tests/ws1/build-info.test.ts`（5 个 it：覆盖 Feature 1/2/3 + Feature 4 正常 git 分支）
- `tests/ws1/build-info-git-fallback.test.ts`（1 个 it：覆盖 Feature 4 git 不可用回退）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/build-info.test.ts` | 200+JSON / 三键 exact / 三字段非空 string / built_at ISO round-trip / 两次相等 / pkg.version 一致 / git_sha 形态 | 7 个 it 全 FAIL（每个 it 内 dynamic import 抛 ERR_MODULE_NOT_FOUND） |
| WS1 | `tests/ws1/build-info-git-fallback.test.ts` | git execSync 抛错时 200+unknown | 1 个 it FAIL（同上） |

预期红总数：**8 failing tests**（来自 2 个 .test.ts 文件，每个 it 内做 `await import(...)` 因 build-info.js 缺失各自抛错，得到 it 级 FAIL）。

实跑验证（Proposer 在 worktree 本地执行）：

```
$ npx vitest run sprints/tests/ws1/ --reporter=verbose --no-color
 ...
 × build-info-git-fallback.test.ts > ... > returns 200 and git_sha="unknown" when git execSync throws
 × build-info.test.ts > ... > returns 200 with application/json content-type
 × build-info.test.ts > ... > body contains exactly the three keys git_sha / package_version / built_at
 × build-info.test.ts > ... > all three fields are non-empty strings
 × build-info.test.ts > ... > body.package_version equals packages/brain/package.json version field
 × build-info.test.ts > ... > body.built_at is a valid ISO 8601 string (round-trip equal)
 × build-info.test.ts > ... > built_at is identical across two requests within the same process
 × build-info.test.ts > ... > git_sha is either 40-char lowercase hex or the literal string "unknown"

 Test Files  2 failed (2)
      Tests  8 failed (8)
```

模块缺失是 v5/v6 GAN 范式下"测试真红"的合法证据 —— Generator commit 1 必须先把测试原样搬进 brain 包并跑出 8 个 it 级别的 FAIL，然后 commit 2 写实现转 Green。详见 contract-dod-ws1.md 与 tests/ws1/。
