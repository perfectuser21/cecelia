# Sprint Contract Draft (Round 1)

## Feature 1: GET /api/brain/build-info 端点

**行为描述**:
Brain 进程启动后，客户端对路径 `/api/brain/build-info` 发起 HTTP GET 请求时，端点同步返回 JSON 响应。响应体只包含三个键：`git_sha`（当前 commit 的 40 位十六进制 SHA，无法获取时为字符串 `"unknown"`）、`package_version`（与 `packages/brain/package.json` 的 `version` 字段字节级一致）、`built_at`（进程启动时一次性确定的 ISO 8601 时间戳，对同一进程内的所有后续请求保持完全相等）。响应 status=200，Content-Type 包含 `application/json`。

**硬阈值**:
- 响应 `status === 200`
- 响应头 `Content-Type` 字符串包含子串 `application/json`
- 响应 body 是一个 plain JSON object，`Object.keys(body).sort()` 严格等于 `['built_at', 'git_sha', 'package_version']`（即"含且仅含三键"，无第四键）
- `body.git_sha` 类型为 string，且匹配正则 `/^([0-9a-f]{40}|unknown)$/`
- `body.package_version` 字符串严格等于 `JSON.parse(readFileSync('packages/brain/package.json')).version`
- `body.built_at` 字符串满足 `new Date(body.built_at).toISOString() === body.built_at`（ISO 8601 round-trip 严格相等，不容许任何 string 形变）
- 同一进程实例下，连续 N≥3 次请求得到的 `body.built_at` 字符串两两严格相等（防止"模 N 刷新型"mutation）

**BEHAVIOR 覆盖**（落成 `sprints/tests/ws1/build-info.test.js` 真实 it() 块）:
- `it('GET /api/brain/build-info returns status 200 with application/json content-type')`
- `it('response body has exactly three keys: built_at, git_sha, package_version')`
- `it('package_version equals packages/brain/package.json version field')`
- `it('built_at is a valid ISO 8601 timestamp (round-trip identical)')`
- `it('returns identical built_at across three consecutive requests within the same process')`
- `it('git_sha matches /^([0-9a-f]{40}|unknown)$/')`
- `it('git_sha falls back to "unknown" when git rev-parse HEAD fails')`

**ARTIFACT 覆盖**（写入 `contract-dod-ws1.md`）:
- 文件 `packages/brain/src/routes/build-info.js` 存在
- 该文件 default-export 一个 Express Router 实例（含 `.use` / `.get` 等 Router 方法，与 `express.Router()` 实例同形）
- 该文件含模块顶层常量 `const BUILT_AT = new Date().toISOString()`（防"每次请求重新生成"型 mutation；built_at 缓存语义在静态层锁定）
- `packages/brain/server.js` 含 `import buildInfoRouter from './src/routes/build-info.js'` 静态 import 语句
- `packages/brain/server.js` 含 `app.use('/api/brain/build-info', buildInfoRouter)` 挂载语句
- 测试文件 `sprints/tests/ws1/build-info.test.js` 存在且含 ≥7 个 `it(` 调用
- `sprints/vitest.config.js` 存在，使 Reviewer 可在 repo 根直接运行 `npx vitest run -c sprints/vitest.config.js`

---

## Workstreams

workstream_count: 1

### Workstream 1: build-info Express Router + server.js mount + supertest 集成测试

**范围**: 单一 Express Router 模块（`packages/brain/src/routes/build-info.js`，约 30 行）+ server.js 加 1 行 import + 1 行 `app.use` 挂载 + supertest 集成测试。无外部依赖，无 db 触碰，无并发逻辑。
**大小**: S（<100 行总改动，新代码 ~40 行 + 2 行 server.js mod + 测试 ~140 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/build-info.test.js`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/build-info.test.js` | status+content-type / 三键 only / package_version match / ISO 8601 round-trip / built_at idempotent N=3 / git_sha pattern / git_sha unknown fallback | `npx vitest run -c sprints/vitest.config.js` → Test Files 1 failed (1), Tests 7 failed (7)，每条 fail 原因均为 `Failed to load url ../../../packages/brain/src/routes/build-info.js`（实现尚不存在），证明测试真实 import 实现路径，未 mock 被测对象本身 |
