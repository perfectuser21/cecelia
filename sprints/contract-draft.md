# Sprint Contract Draft (Round 1)

> Task: `1eb6f168-c3ec-4754-a538-778fd8a11f1b`
> Planner branch: `main`
> Propose round: 1
> Sprint dir: `sprints/`

---

## Feature 1: GET /api/brain/build-info 返回构建身份三元组

**行为描述**:

Brain HTTP 服务在 `/api/brain/build-info` 路径暴露一个 GET 端点。客户端发起请求后，服务返回 status=200、`Content-Type: application/json`，响应体是一个 JSON 对象，**有且仅有** 三个键：`git_sha`、`package_version`、`built_at`。

- `git_sha` 是字符串，值要么是当前 HEAD 提交的十六进制 SHA（7-40 位 `[0-9a-f]`），要么在 `git` 子进程失败 / 不可用时严格等于字面量 `"unknown"`，**禁止 null / undefined / 空串**。
- `package_version` 是字符串，**严格等于** `packages/brain/package.json` 的 `version` 字段。
- `built_at` 是字符串，且 `new Date(built_at).toISOString() === built_at`（即合法 ISO 8601 with millis & Z）。
- `built_at` 在模块首次加载时确定一次，**同进程内任意两次请求返回值字符串严格相等**。

**硬阈值**:

- HTTP status === `200`
- Response header `Content-Type` 匹配 `/application\/json/`
- `Object.keys(body).sort()` 严格等于 `['built_at', 'git_sha', 'package_version']`（即"含且仅含"三键）
- `body.git_sha` 是 string，且满足 `body.git_sha === 'unknown' || /^[0-9a-f]{7,40}$/.test(body.git_sha)`
- `body.package_version === require('packages/brain/package.json').version`
- `new Date(body.built_at).toISOString() === body.built_at`
- 模块加载时 `child_process.execSync('git rev-parse HEAD', ...)` 抛错的情况下 → `body.git_sha === 'unknown'`
- 同一 Express app 实例上连续两次请求 → `res1.body.built_at === res2.body.built_at`

**BEHAVIOR 覆盖**（落成 `tests/ws1/build-info.test.js` 的 `it()` 块）:

- `it('responds 200 with Content-Type application/json')`
- `it('responds with body containing exactly the three keys git_sha, package_version, built_at')`
- `it('returns package_version equal to packages/brain/package.json version')`
- `it('returns built_at as a valid ISO 8601 string that round-trips through Date')`
- `it('returns identical built_at across two requests in the same process')`
- `it('returns git_sha matching either /^[0-9a-f]{7,40}$/ or the literal "unknown"')`
- `it('returns git_sha === "unknown" when child_process.execSync throws at module load')`

**ARTIFACT 覆盖**（落成 `contract-dod-ws1.md` 的 `- [ ] [ARTIFACT]` 条目）:

- 文件 `packages/brain/src/routes/build-info.js` 存在
- `packages/brain/src/routes/build-info.js` 含 `Router(` 调用，且默认导出（`export default`）该 router
- `packages/brain/server.js` 含字面量片段 `app.use('/api/brain/build-info'`（路由挂载点）
- 文件 `packages/brain/src/__tests__/build-info.test.js` 存在（实现侧的最终落点测试，由 Generator 在合同批准后从 `sprints/tests/ws1/build-info.test.js` 原样复制）

---

## Workstreams

workstream_count: 1

### Workstream 1: build-info 端点路由 + 集成测试

**范围**: 新增 Express Router 模块 `packages/brain/src/routes/build-info.js`，在 `packages/brain/server.js` 挂载到 `/api/brain/build-info`，并在 `packages/brain/src/__tests__/build-info.test.js` 落地 supertest 集成测试。

**大小**: S（新增 ≈ 30 行 Router + 1 行 server.js import + 1 行 server.js 挂载 + ≈ 80 行测试，总改动 < 120 行）

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/build-info.test.js`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 (it 数) | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/build-info.test.js` | 7 it (status+content-type / 三键 only / package_version match / ISO 8601 round-trip / built_at idempotent / git_sha pattern / git_sha 'unknown' fallback) | `npx vitest run -c sprints/vitest.config.js` → `Test Files 1 failed (1)` / `Tests 7 failed (7)`，每个 it 错误信息均为 `Failed to load url ../../../packages/brain/src/routes/build-info.js`（实现未落地）|

**Red evidence 收集命令**（Reviewer 可在 cecelia repo 根目录机械重跑）:

```bash
cd /workspace && npx vitest run -c sprints/vitest.config.js --reporter=verbose
```

**Proposer 本地实跑摘要**（Round 1, 2026-04-26）:

```
Test Files  1 failed (1)
     Tests  7 failed (7)
  Duration  ~720ms

× responds 200 with Content-Type application/json
× responds with body containing exactly the three keys git_sha, package_version, built_at
× returns package_version equal to packages/brain/package.json version
× returns built_at as a valid ISO 8601 string that round-trips through Date
× returns identical built_at across two requests in the same process
× returns git_sha matching either /^[0-9a-f]{7,40}$/ or the literal "unknown"
× returns git_sha === "unknown" when child_process.execSync throws at module load
```

每条失败原因均为 `Failed to load url ../../../packages/brain/src/routes/build-info.js`，证明：
1. 测试真实 import 目标实现路径（无 mock 被测对象本身）
2. 实现一旦落地，所有断言会被实际触达（不是占位 truthy / placeholder）
