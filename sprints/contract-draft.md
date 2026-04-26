# Sprint Contract Draft (Round 2)

> Task: `1eb6f168-c3ec-4754-a538-778fd8a11f1b`
> Planner branch: `main`
> Propose round: 2
> Sprint dir: `sprints/`

---

## 稳定 ID 引用表

| ID | 含义 |
|---|---|
| `RED_CMD` | `npx vitest run -c sprints/vitest.config.js` —— Reviewer 在 `/workspace` 根目录机械重跑收集 Red evidence 的唯一入口 |
| `SERVER_FILE` | `packages/brain/server.js` —— Brain HTTP 入口实际路径（见 §Reviewer 反馈裁决·事实证据） |
| `ROUTER_FILE` | `packages/brain/src/routes/build-info.js` —— 新增 Express Router 模块 |
| `IMPL_TEST_FILE` | `packages/brain/src/__tests__/build-info.test.js` —— Generator 在 commit 1 从 `sprints/tests/ws1/build-info.test.js` 字节级复制 |

---

## Reviewer 反馈裁决（Round 1 → Round 2）

| # | Reviewer 反馈 | 处理 |
|---|---|---|
| 1 | 加 module-level top-level `BUILT_AT = new Date().toISOString()` 实现示范 + 连续两次断言 `===` 的测试 | **采纳**：合同硬阈值 + Feature 行为描述里固化"模块加载时一次性确定"语义；测试加一条"连续 3 次请求 built_at 严格相等"强化（原 round 1 已覆盖 2 次，Round 2 再加 3 次以增大 mutation 检出概率） |
| 2 | ESM/CJS 互操作：测试统一用 `import pkg ... assert { type: 'json' }` 或 `createRequire`，硬阈值固定写法 | **采纳（变体）**：测试已使用 `JSON.parse(readFileSync(BRAIN_PKG_PATH,'utf8'))`（同样规避 `require` 的 ESM 报错，且无需 `assert { type: 'json' }` 这类不稳定语法）；合同硬阈值新增显式"测试侧禁止 `require('packages/brain/package.json')`，必须 `JSON.parse(readFileSync(...))`"  |
| 3 | Cascade Risk：route 模块 import 失败让 server.js 启动崩 | **采纳**：新增 ARTIFACT，要求 server.js 在挂载 build-info 路由处使用 `try { ... } catch (err) { console.error(...) }` 包裹路由导入失败仅告警不阻断；测试侧 cascade 不在 build-info 测试覆盖范围（属 server.js 启动健壮性，不是 build-info 行为） |
| 4 | `packages/brain/server.js` 全部替换为 `packages/brain/src/server.js`，与 PRD「预期受影响文件」+ CLAUDE.md SSOT 一致 | **不采纳——Reviewer 反馈与代码事实冲突**：见下文事实证据小节 |
| 5 | `npx vitest run -c sprints/vitest.config.js` 抽稳定 ID `RED_CMD`，文中只引用一次 | **采纳**：见 §稳定 ID 引用表，本合同后文一律用 `RED_CMD` 引用 |

### §Reviewer 反馈 #4 事实证据小节（不采纳的依据）

```bash
$ ls -la /workspace/packages/brain/server.js /workspace/packages/brain/src/server.js
-rw-r--r-- 1 cecelia cecelia 33321 ... /workspace/packages/brain/server.js
ls: cannot access '/workspace/packages/brain/src/server.js': No such file or directory
```

```json
// packages/brain/package.json
"main": "server.js",
"scripts": { "start": "node server.js" }
```

```javascript
// packages/brain/server.js（顶部 import 模式，~50 个现存路由）
import brainRoutes from './src/routes.js';
import memoryRoutes from './src/routes/memory.js';
import vpsMonitorRoutes from './src/routes/vps-monitor.js';
// ... 同样模式：server.js 在 packages/brain/，路由模块在 packages/brain/src/routes/
```

PRD 自身已在 round 1 之前的版本里两处标注（第 56 行 SC-002、第 91 行「预期受影响文件」）：
> *PRD 原文 `packages/brain/src/server.js` 系路径手误，实际为 `packages/brain/server.js`*

CLAUDE.md 顶部「SSOT」段落写的是 `packages/brain/src/server.js`，但**该段落本身与代码事实不符，是过期文档**——这属于另一条独立任务（CLAUDE.md 修订），不在本 sprint 范围内。本合同必须按代码事实锁定 `SERVER_FILE = packages/brain/server.js`，否则 Generator 实现到 `src/server.js` 会落到一个不存在的目录，且与 round 1 已绿的 ARTIFACT 验证（`grep app.use('/api/brain/build-info' on packages/brain/server.js`）冲突。

**裁决依据**：
1. 文件系统事实 > 文档 SSOT 文字
2. PRD 已自我修订承认手误
3. 与 server.js 现存 ~50 个路由的 import 模式（`./src/routes/xxx.js`）一致

---

## Feature 1: GET /api/brain/build-info 返回构建身份三元组

**行为描述**:

Brain HTTP 服务在 `/api/brain/build-info` 路径暴露一个 GET 端点。客户端发起请求后，服务返回 status=200、`Content-Type: application/json`，响应体是一个 JSON 对象，**有且仅有** 三个键：`git_sha`、`package_version`、`built_at`。

- `git_sha` 是字符串，值要么是当前 HEAD 提交的十六进制 SHA（7-40 位 `[0-9a-f]`），要么在 `git` 子进程失败 / 不可用时严格等于字面量 `"unknown"`，**禁止 null / undefined / 空串**。
- `package_version` 是字符串，**严格等于** `packages/brain/package.json` 的 `version` 字段。
- `built_at` 是字符串，且 `new Date(built_at).toISOString() === built_at`（即合法 ISO 8601 with millis & Z）。
- `built_at` 在模块**首次加载时**赋给一个 module-level `const BUILT_AT = new Date().toISOString()`（或等效一次性求值），后续每个请求都返回同一引用 → 同进程内任意 N 次请求结果字符串严格相等（N ≥ 2，本合同测试取 N=2 与 N=3 两条断言以提高 mutation 检出率）。

**硬阈值**:

- HTTP status === `200`
- Response header `Content-Type` 匹配 `/application\/json/`
- `Object.keys(body).sort()` 严格等于 `['built_at', 'git_sha', 'package_version']`（即"含且仅含"三键）
- `body.git_sha` 是 string，且满足 `body.git_sha === 'unknown' || /^[0-9a-f]{7,40}$/.test(body.git_sha)`
- `body.package_version === brainPkg.version`，其中 `brainPkg = JSON.parse(readFileSync('packages/brain/package.json','utf8'))`（**测试侧禁止 `require('packages/brain/package.json')`，因 brain 是 ESM 包 `"type":"module"`，`require` 在 vitest ESM 加载下不可用**）
- `new Date(body.built_at).toISOString() === body.built_at`
- 模块加载时 `child_process.execSync('git rev-parse HEAD', ...)` 抛错的情况下 → `body.git_sha === 'unknown'`（测试通过 `vi.doMock('child_process')` + `vi.doMock('node:child_process')` 双拦截 + `vi.resetModules()` + `import(... + '?fallback')` 强制重加载实现）
- 同一 Express app 实例上**连续两次**请求 → `res1.body.built_at === res2.body.built_at`
- 同一 Express app 实例上**连续三次**请求 → `res1.body.built_at === res2.body.built_at && res2.body.built_at === res3.body.built_at`（Round 2 新增；防止"每两次刷新一次"这种实现 mutation 通过 N=2 但被 N=3 抓住）

**BEHAVIOR 覆盖**（落成 `tests/ws1/build-info.test.js` 的 `it()` 块，共 8 条）:

- `it('responds 200 with Content-Type application/json')`
- `it('responds with body containing exactly the three keys git_sha, package_version, built_at')`
- `it('returns package_version equal to packages/brain/package.json version')`
- `it('returns built_at as a valid ISO 8601 string that round-trips through Date')`
- `it('returns identical built_at across two requests in the same process')`
- `it('returns identical built_at across three consecutive requests in the same process')`  ← Round 2 新增
- `it('returns git_sha matching either /^[0-9a-f]{7,40}$/ or the literal "unknown"')`
- `it('returns git_sha === "unknown" when child_process.execSync throws at module load')`

**ARTIFACT 覆盖**（落成 `contract-dod-ws1.md` 的 `- [ ] [ARTIFACT]` 条目）:

- 文件 `packages/brain/src/routes/build-info.js`（`ROUTER_FILE`）存在
- `ROUTER_FILE` 含 `Router(` 调用，且默认导出（`export default`）该 router
- `ROUTER_FILE` 含 module-level `const BUILT_AT` 一次性赋值（**Round 2 新增**：`/^const\s+BUILT_AT\s*=\s*new Date\(\)\.toISOString\(\)/m` 文件级匹配，证明 built_at 在模块加载时缓存而非每请求重算）
- `packages/brain/server.js`（`SERVER_FILE`）含字面量片段 `app.use('/api/brain/build-info'`（路由挂载点）
- `SERVER_FILE` import 了 build-info router 模块（含字面量片段 `routes/build-info`）
- `SERVER_FILE` 在挂载 build-info 路由处使用 `try { ... } catch` 包裹（**Round 2 新增**：cascade risk 缓解；正则 `/try\s*\{[\s\S]{0,400}?\/api\/brain\/build-info[\s\S]{0,400}?\}\s*catch/`，确保 router import/挂载失败时仅告警不让 server.js 启动崩溃）
- 文件 `packages/brain/src/__tests__/build-info.test.js`（`IMPL_TEST_FILE`）存在（实现侧落点测试，由 Generator 在合同批准后从 `sprints/tests/ws1/build-info.test.js` 原样复制）
- `IMPL_TEST_FILE` 与 `sprints/tests/ws1/build-info.test.js` **字节级相等**（`diff -q` 退出码 0）

---

## Workstreams

workstream_count: 1

### Workstream 1: build-info 端点路由 + 集成测试 + cascade 防护

**范围**: 新增 Express Router 模块 `ROUTER_FILE`，在 `SERVER_FILE` 用 try/catch 包裹挂载到 `/api/brain/build-info`，并在 `IMPL_TEST_FILE` 落地 supertest 集成测试。

**大小**: S（新增 ≈ 35 行 Router + 1 行 server.js import + 3-5 行 server.js try/catch 挂载 + ≈ 100 行测试，总改动 < 150 行）

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/build-info.test.js`（8 个 it）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 (it 数) | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/build-info.test.js` | 8 it（Round 1 7 条 + Round 2 新增 1 条 N=3 idempotent） | `RED_CMD` → `Test Files 1 failed (1)` / `Tests 8 failed (8)`，每个 it 错误信息均为 `Failed to load url ../../../packages/brain/src/routes/build-info.js`（实现未落地）|

**Red evidence 收集命令**：见 `RED_CMD`（在 `/workspace` 根目录执行）。

**Proposer 本地实跑摘要**（Round 2, 2026-04-26）:

```
Test Files  1 failed (1)
     Tests  8 failed (8)
  Duration  ~750ms

× responds 200 with Content-Type application/json
× responds with body containing exactly the three keys git_sha, package_version, built_at
× returns package_version equal to packages/brain/package.json version
× returns built_at as a valid ISO 8601 string that round-trips through Date
× returns identical built_at across two requests in the same process
× returns identical built_at across three consecutive requests in the same process
× returns git_sha matching either /^[0-9a-f]{7,40}$/ or the literal "unknown"
× returns git_sha === "unknown" when child_process.execSync throws at module load
```

每条失败原因均为 `Failed to load url ../../../packages/brain/src/routes/build-info.js`，证明：
1. 测试真实 import 目标实现路径（无 mock 被测对象本身）
2. 实现一旦落地，所有断言会被实际触达（不是占位 truthy / placeholder）
3. Round 2 新增的 N=3 idempotent 与原 N=2 idempotent 共同形成对"每偶数次刷新缓存"型 mutation 的双重护栏
