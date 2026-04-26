# Sprint Contract Draft (Round 2)

源 PRD：`sprints/sprint-prd.md`（commit `a757f4b`）— Brain build-info 端点

## Round 2 修订摘要（针对 Round 1 Reviewer 反馈）

1. **R3 — git_sha 取值优先级**：新增硬阈值固定优先级 `GIT_SHA → GIT_COMMIT → COMMIT_SHA → SOURCE_COMMIT → VERCEL_GIT_COMMIT_SHA → 'unknown'`，并新增 1 个 it（priority resolution）覆盖该规则。
2. **internal_consistency #1 — 三表口径对齐**：BEHAVIOR 覆盖列表从 5 条扩到 9 条，与测试文件 it() 数量、Test Contract 表、Red Evidence 实跑数量完全一致（9 = 9 = 9）。
3. **internal_consistency #2 — env 变量清单展开**：Test Contract 表 BEHAVIOR 覆盖列把"清空 env vars"展开成具体五个变量名，与硬阈值段口径一致，消除歧义。
4. **internal_consistency #3 — 模块缓存隔离**：合同备注新增条目说明 `beforeEach(vi.resetModules())` 策略，与 Red Evidence 中"per-it dynamic import 各自抛 ERR_MODULE_NOT_FOUND" 口径一致——既解释 Red 阶段为什么各 it 独立标红，也解释 Green 阶段为什么 env 类断言不会被前面 it 的模块缓存污染。

---

## Feature 1: GET /api/brain/build-info HTTP 端点

**行为描述**:
Brain 进程启动后，对 `GET /api/brain/build-info` 的请求返回 200 状态码与 `application/json` 响应体；JSON 对象**恰好**包含 `git_sha`、`package_version`、`built_at` 三个 own enumerable key（不允许多余字段污染契约）。`package_version` 严格等于 `packages/brain/package.json` 中 `version` 字段在 runtime 读出的值（禁止硬编码）。`built_at` 是 ISO 8601 规范化字符串：`new Date(body.built_at).toISOString() === body.built_at`，挡住 `"2026-01-01"` 这类合法但非规范化输入。`git_sha` 来源遵循固定优先级链 `GIT_SHA → GIT_COMMIT → COMMIT_SHA → SOURCE_COMMIT → VERCEL_GIT_COMMIT_SHA → 'unknown'`：取第一个被设置且非空的值；五个全空时回落到字面量 `'unknown'`。挂载新端点后 `server.js` 现有路由（如 `/api/brain/manifest`）依然可用。

**硬阈值**:
- HTTP 响应状态码 = `200`
- `Content-Type` 包含 `application/json`
- `Object.keys(body).sort()` 严格等于 `['built_at', 'git_sha', 'package_version']`（三键集合 exact match，挡 mutation 加多余字段）
- `typeof body.git_sha === 'string'` 且 `body.git_sha.length > 0`，**即使**清空 `GIT_SHA / GIT_COMMIT / COMMIT_SHA / SOURCE_COMMIT / VERCEL_GIT_COMMIT_SHA` 五个 SHA 注入变量
- **git_sha 取值优先级固定为 `GIT_SHA → GIT_COMMIT → COMMIT_SHA → SOURCE_COMMIT → VERCEL_GIT_COMMIT_SHA → 'unknown'`**：取链中第一个被设置且非空的值；五个全空时返回字面量 `'unknown'`。实现禁止在运行时调用 `git rev-parse` 等子进程（git 元信息由构建流水线注入到上述 env 变量；运行时只读 env，不依赖 `.git` 目录）
- `body.package_version` 字符串 === `JSON.parse(readFileSync('packages/brain/package.json')).version`（runtime 读取，禁止硬编码 `"1.223.0"`）
- `new Date(body.built_at).toISOString() === body.built_at`（合法 ISO 8601 且为规范化格式）
- 端点路径前缀必须挂在 `/api/brain/build-info`

**BEHAVIOR 覆盖**（这些会在 `tests/ws1/` 里落成真实 it() 块，共 9 个，与测试文件 1:1 对应）:
1. `it('GET /api/brain/build-info returns 200 with content-type application/json')`
2. `it('response body has own property git_sha')`
3. `it('response body has own property package_version')`
4. `it('response body has own property built_at')`
5. `it('responds with exactly three own keys: git_sha / package_version / built_at (no extras)')`
6. `it('package_version exactly equals the version field in packages/brain/package.json')`
7. `it('built_at is a stable ISO 8601 string (round-trip via new Date().toISOString() is identity)')`
8. `it('git_sha is a non-empty string even when GIT_SHA / GIT_COMMIT / COMMIT_SHA / SOURCE_COMMIT / VERCEL_GIT_COMMIT_SHA are all unset')`
9. `it('git_sha resolution follows fixed priority GIT_SHA > GIT_COMMIT > COMMIT_SHA > SOURCE_COMMIT > VERCEL_GIT_COMMIT_SHA > "unknown"')`

**ARTIFACT 覆盖**（这些会写进 `contract-dod-ws1.md`）:
- `packages/brain/src/routes/build-info.js` 文件存在
- 该文件使用 `import { Router } from 'express'` 并以 `export default router` 形式导出（与 `brain-manifest.js` 风格一致）
- 该文件注册了 `router.get('/')` 处理器
- 该文件引用 `package.json` 作为 `package_version` 来源（不允许出现硬编码的 `"1.223.0"` 字面量）
- 该文件按固定优先级链引用 5 个 SHA env 变量（源码可静态 grep 出 `GIT_SHA / GIT_COMMIT / COMMIT_SHA / SOURCE_COMMIT / VERCEL_GIT_COMMIT_SHA` 全部 5 个标识符），并禁止 `child_process` / `execSync` / `spawnSync` 调用（不在 runtime 跑 `git rev-parse`）
- `packages/brain/server.js` 顶部 `import buildInfoRoutes from './src/routes/build-info.js'`
- `packages/brain/server.js` 含 `app.use('/api/brain/build-info', buildInfoRoutes)` 挂载行
- 现有 `app.use('/api/brain/manifest', brainManifestRoutes)` 行未被删除（回归保护）

---

## Workstreams

workstream_count: 1

### Workstream 1: 新增 build-info Router 并挂载到 server.js

**范围**:
- 新建 `packages/brain/src/routes/build-info.js`：Express Router，GET `/` 返回 `{ git_sha, package_version, built_at }`；`package_version` 在模块加载时从 `packages/brain/package.json` 读取；`built_at` 在模块加载时一次性确定（`new Date().toISOString()`），所有请求返回相同值；`git_sha` 在模块加载时按固定优先级 `GIT_SHA → GIT_COMMIT → COMMIT_SHA → SOURCE_COMMIT → VERCEL_GIT_COMMIT_SHA` 取第一个非空值，全空时回落 `'unknown'`（绝不抛错、绝不为空、绝不调用 `child_process`）。
- 修改 `packages/brain/server.js`：在文件顶部 import 区追加 `import buildInfoRoutes from './src/routes/build-info.js';`，在第 240 行附近 `app.use('/api/brain/manifest', ...)` 紧邻位置追加 `app.use('/api/brain/build-info', buildInfoRoutes);`。
- 不修改 `package.json`、不动其他 router、不引入新的 npm 依赖。

**大小**: S（预计实现侧 < 60 行新增 + ~ 2 行 server.js 改动）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/build-info.test.js`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖（共 9 个 it()） | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/build-info.test.js` | (1) 200 + content-type / (2-4) 三个独立 own-property 断言 git_sha & package_version & built_at / (5) 严格三键集合（sort 后 toEqual） / (6) package_version 严格相等 brain/package.json.version / (7) built_at ISO toISOString round-trip 恒等 / (8) 同时清空 `GIT_SHA / GIT_COMMIT / COMMIT_SHA / SOURCE_COMMIT / VERCEL_GIT_COMMIT_SHA` 后 git_sha 仍非空 / (9) 五个 env 变量按 `GIT_SHA → GIT_COMMIT → COMMIT_SHA → SOURCE_COMMIT → VERCEL_GIT_COMMIT_SHA → 'unknown'` 优先级解析（逐个删除最高位、断言次高位接管，最终回落 `'unknown'`） | 共 9 个 `it()`，全部 FAIL（实现文件 `packages/brain/src/routes/build-info.js` 不存在；`beforeEach(vi.resetModules())` + per-it 内 dynamic import 各自抛 `Failed to load url ../../../packages/brain/src/routes/build-info.js`）。本地实跑命令：`cd sprints && npx vitest run --config ./vitest.config.js`；本地实测结果：`Test Files 1 failed (1) / Tests 9 failed (9)` |

## Red Evidence（Proposer 本地实跑摘要 — Round 2）

```
RUN  v1.6.1 /workspace/sprints
 ❯ tests/ws1/build-info.test.js  (9 tests | 9 failed) 9ms
 × tests/ws1/build-info.test.js > [BEHAVIOR] > GET /api/brain/build-info returns 200 with content-type application/json
 × tests/ws1/build-info.test.js > [BEHAVIOR] > response body has own property git_sha
 × tests/ws1/build-info.test.js > [BEHAVIOR] > response body has own property package_version
 × tests/ws1/build-info.test.js > [BEHAVIOR] > response body has own property built_at
 × tests/ws1/build-info.test.js > [BEHAVIOR] > responds with exactly three own keys: git_sha / package_version / built_at (no extras)
 × tests/ws1/build-info.test.js > [BEHAVIOR] > package_version exactly equals the version field in packages/brain/package.json
 × tests/ws1/build-info.test.js > [BEHAVIOR] > built_at is a stable ISO 8601 string (round-trip via new Date().toISOString() is identity)
 × tests/ws1/build-info.test.js > [BEHAVIOR] > git_sha is a non-empty string even when GIT_SHA / GIT_COMMIT / COMMIT_SHA / SOURCE_COMMIT / VERCEL_GIT_COMMIT_SHA are all unset
 × tests/ws1/build-info.test.js > [BEHAVIOR] > git_sha resolution follows fixed priority GIT_SHA > GIT_COMMIT > COMMIT_SHA > SOURCE_COMMIT > VERCEL_GIT_COMMIT_SHA > "unknown"
Test Files  1 failed (1)
Tests       9 failed (9)
```

三表口径对齐（internal_consistency 验证）：BEHAVIOR 覆盖列表条目数 = 9，Test Contract 表 it() 数 = 9，Red Evidence 实跑 FAIL 数 = 9。

## 备注

- 测试扩展名使用 `.js`：项目 brain 包是 ESM JS、无 TypeScript 配置；vitest include 模式 `*.{test,spec}.?(c|m)[jt]s?(x)` 同时接受 `.test.js` 与 `.test.ts`。选 `.js` 让测试更稳地直接 runtime 加载，无 esbuild 类型转译副作用。
- `sprints/vitest.config.js` 是合同测试专属最小配置：只 include `tests/ws*/**/*.{test,spec}.?(c|m)[jt]s?(x)`，不继承 brain 包的 mock / 大量 exclude，避免 cross-package 副作用污染合同对抗。Generator 阶段实现完成后用同一命令转绿。
- **测试默认隔离 module 缓存**：测试文件顶部 `beforeEach(() => vi.resetModules())`。理由——`build-info.js` 在模块加载时一次性读取 `process.env.*` 与 `new Date().toISOString()`，ESM 默认全局缓存模块；若不重置，第二个 it 之后的 dynamic import 会复用首个 it 评估时的 env 快照，导致 it #8（清空 env vars）和 it #9（priority 矩阵）的 env 操控**静默失效**（断言可能假绿，亦可能因前一个 it 残留 env 而假红）。`beforeEach(vi.resetModules())` 的设计与 Red Evidence 中"per-it dynamic import 各自抛 ERR_MODULE_NOT_FOUND" 口径一致：Red 阶段每个 it 各自独立标红，Green 阶段各 it 各自重新评估模块顶层，不会互相污染。
- **每个 `it()` 内部用 `await import(...)` 动态加载**而非顶层 import：Red 阶段（实现文件不存在）每个 it 各自抛 `ERR_MODULE_NOT_FOUND` 并独立 FAIL，避免 suite 顶层 import 折叠成单条错误，损失粒度。
- **git_sha 优先级测试设计**：测试预先 snapshot 5 个 env 变量当前值（确保测试结束 finally 块完整还原），然后将全部 5 个设为可识别的 sentinel 字符串（如 `priority-marker-GIT_SHA`），逐个删除当前最高优先级变量并 `vi.resetModules()` + 重新 import 验证次高位接管，最终全部删除后断言落在字面量 `'unknown'`。该测试单独验证"实现是否使用了固定优先级"——任何打乱顺序、跳过某个变量、或回落值不是 `'unknown'` 的实现都会被打回。
