# Sprint Contract Draft (Round 3)

源 PRD：`sprints/sprint-prd.md`（commit `a757f4b`）— Brain build-info 端点

## Round 3 修订摘要（针对 Round 2 Reviewer 反馈）

1. **R-2 cwd 漂移防御**（双层）：
   - **静态层（ARTIFACT 新增条目）**：实现必须用 `import.meta.url` + `fileURLToPath` 解析 `package.json` 绝对路径；禁止 `require('./package.json')` / `from './package.json'` / `readFileSync('./package.json')` / `readFileSync('package.json')` 这类依赖 `process.cwd()` 的相对解析。正则在 brain-manifest.js（同仓 router 样板）上自我验证通过。
   - **行为层（新增 it #10）**：`process.chdir('/tmp')` 主动制造非 brain 目录 cwd 后调用端点，断言 `package_version` 仍严格等于 brain/package.json 的 version 字段值。任何依赖 cwd 解析的实现（即便巧合等于当前 1.223.0 也会因 readFile 抛错）会被打回。
   - **配套 vitest 改动**：vitest 默认 worker 线程不允许 `process.chdir()`（防 worker 间状态污染主进程），sprints/vitest.config.js 切换到 `pool: 'forks' + singleFork:true`——每个测试文件作为独立子进程运行，chdir 副作用被 fork 边界隔离。
2. **R-3 "模块加载时一次性"语义澄清**：合同备注明确这是**单进程内单次 import 后所有请求返回相同值**的语义，非"跨 it / 跨 vi.resetModules() 也不变"。it #7 维持仅 round-trip 恒等断言（不跨 it 比较时间戳）。
3. **R-4 既有路由 cascade guard（合并到 it #11）**：原 manifest 兜底单测在 Red 阶段会因 `brain-manifest.js` 已存在而误绿。Round 3 改成"双 router 兜底"：同一 it 内 dynamic import 两个 router 模块，断言两个 default export 都是 Router-shaped（`typeof === 'function'` 且 `.use` 是函数）——build-info.js 缺失 → fail（Red 阶段保护），manifest.js 误删 → fail（cascade 保护）。

口径对齐：BEHAVIOR 覆盖列表条目数 = 11，Test Contract 表 it() 数 = 11，Red Evidence 实跑 FAIL 数 = 11；相对 Round 2 净增 2 个 it（cwd 漂移 + 双 router cascade）和 1 条 ARTIFACT（fileURLToPath 静态保护）。

---

## Feature 1: GET /api/brain/build-info HTTP 端点

**行为描述**:
Brain 进程启动后，对 `GET /api/brain/build-info` 的请求返回 200 状态码与 `application/json` 响应体；JSON 对象**恰好**包含 `git_sha`、`package_version`、`built_at` 三个 own enumerable key（不允许多余字段污染契约）。`package_version` 严格等于 `packages/brain/package.json` 中 `version` 字段在 runtime 读出的值（禁止硬编码）；且**与进程 cwd 无关**——即便启动时或调用前 `process.cwd()` 不在 brain 目录（典型场景：vitest workdir、Docker entrypoint、其他单元测试），`package_version` 仍能稳定回出真实值。`built_at` 是 ISO 8601 规范化字符串：`new Date(body.built_at).toISOString() === body.built_at`，挡住 `"2026-01-01"` 这类合法但非规范化输入。`git_sha` 来源遵循固定优先级链 `GIT_SHA → GIT_COMMIT → COMMIT_SHA → SOURCE_COMMIT → VERCEL_GIT_COMMIT_SHA → 'unknown'`：取第一个被设置且非空的值；五个全空时回落到字面量 `'unknown'`。挂载新端点后 `server.js` 现有路由（如 `/api/brain/manifest`）依然可用，且既有 router 模块（`brain-manifest.js`）作为 ESM 默认导出仍是 Router 实例（不被误删/挪动）。

**硬阈值**:
- HTTP 响应状态码 = `200`
- `Content-Type` 包含 `application/json`
- `Object.keys(body).sort()` 严格等于 `['built_at', 'git_sha', 'package_version']`（三键集合 exact match，挡 mutation 加多余字段）
- `typeof body.git_sha === 'string'` 且 `body.git_sha.length > 0`，**即使**清空 `GIT_SHA / GIT_COMMIT / COMMIT_SHA / SOURCE_COMMIT / VERCEL_GIT_COMMIT_SHA` 五个 SHA 注入变量
- **git_sha 取值优先级固定为 `GIT_SHA → GIT_COMMIT → COMMIT_SHA → SOURCE_COMMIT → VERCEL_GIT_COMMIT_SHA → 'unknown'`**：取链中第一个被设置且非空的值；五个全空时返回字面量 `'unknown'`。实现禁止在运行时调用 `git rev-parse` 等子进程（git 元信息由构建流水线注入到上述 env 变量；运行时只读 env，不依赖 `.git` 目录）
- `body.package_version` 字符串 === `JSON.parse(readFileSync('packages/brain/package.json')).version`（runtime 读取，禁止硬编码 `"1.223.0"`），且**该相等关系与 `process.cwd()` 解耦**——`process.chdir('/tmp')` 后再次调用端点，结果仍相等
- 实现侧 `package.json` 路径解析必须用 `import.meta.url` + `fileURLToPath`（绝对路径），禁止 `require('./package.json')` / `from './package.json'` / `readFileSync('./package.json')` / `readFileSync('package.json')` 等依赖 cwd 的相对解析（防 vitest 工作目录漂移、Docker entrypoint 漂移）
- `new Date(body.built_at).toISOString() === body.built_at`（合法 ISO 8601 且为规范化格式）
- 端点路径前缀必须挂在 `/api/brain/build-info`
- 既有 router 文件 `packages/brain/src/routes/brain-manifest.js` 保持作为 ESM 模块可加载（default export 是 Router-shaped 函数，带 `.use` 方法）

**BEHAVIOR 覆盖**（这些会在 `tests/ws1/` 里落成真实 it() 块，共 11 个，与测试文件 1:1 对应）:
1. `it('GET /api/brain/build-info returns 200 with content-type application/json')`
2. `it('response body has own property git_sha')`
3. `it('response body has own property package_version')`
4. `it('response body has own property built_at')`
5. `it('responds with exactly three own keys: git_sha / package_version / built_at (no extras)')`
6. `it('package_version exactly equals the version field in packages/brain/package.json')`
7. `it('built_at is a stable ISO 8601 string (round-trip via new Date().toISOString() is identity)')`
8. `it('git_sha is a non-empty string even when GIT_SHA / GIT_COMMIT / COMMIT_SHA / SOURCE_COMMIT / VERCEL_GIT_COMMIT_SHA are all unset')`
9. `it('git_sha resolution follows fixed priority GIT_SHA > GIT_COMMIT > COMMIT_SHA > SOURCE_COMMIT > VERCEL_GIT_COMMIT_SHA > "unknown"')`
10. `it('package_version stays correct when process.cwd is changed away from brain directory (cwd-drift defense)')`
11. `it('both build-info and brain-manifest routers expose Router-shaped default export (cascade guard: build-info ESM contract + manifest router untouched)')`

**ARTIFACT 覆盖**（这些会写进 `contract-dod-ws1.md`）:
- `packages/brain/src/routes/build-info.js` 文件存在
- 该文件使用 `import { Router } from 'express'` 并以 `export default router` 形式导出（与 `brain-manifest.js` 风格一致）
- 该文件注册了 `router.get('/')` 处理器
- 该文件引用 `package.json` 作为 `package_version` 来源（不允许出现硬编码的 `"1.223.0"` 字面量）
- **该文件用 `import.meta.url` + `fileURLToPath` 解析 `package.json` 绝对路径**，禁止 cwd 相对路径解析（防漂移）
- 该文件按固定优先级链引用 5 个 SHA env 变量（源码可静态 grep 出 `GIT_SHA / GIT_COMMIT / COMMIT_SHA / SOURCE_COMMIT / VERCEL_GIT_COMMIT_SHA` 全部 5 个标识符），并禁止 `child_process` / `execSync` / `spawnSync` 调用（不在 runtime 跑 `git rev-parse`）
- `packages/brain/server.js` 顶部 `import buildInfoRoutes from './src/routes/build-info.js'`
- `packages/brain/server.js` 含 `app.use('/api/brain/build-info', buildInfoRoutes)` 挂载行
- 现有 `app.use('/api/brain/manifest', brainManifestRoutes)` 行未被删除（回归保护）

---

## Workstreams

workstream_count: 1

### Workstream 1: 新增 build-info Router 并挂载到 server.js

**范围**:
- 新建 `packages/brain/src/routes/build-info.js`：Express Router，GET `/` 返回 `{ git_sha, package_version, built_at }`；`package_version` 在模块加载时从 `packages/brain/package.json` 读取，**路径必须用 `import.meta.url` + `fileURLToPath` 解析为绝对路径**；`built_at` 在模块加载时一次性确定（`new Date().toISOString()`），所有请求返回相同值；`git_sha` 在模块加载时按固定优先级 `GIT_SHA → GIT_COMMIT → COMMIT_SHA → SOURCE_COMMIT → VERCEL_GIT_COMMIT_SHA` 取第一个非空值，全空时回落 `'unknown'`（绝不抛错、绝不为空、绝不调用 `child_process`）。
- 修改 `packages/brain/server.js`：在文件顶部 import 区追加 `import buildInfoRoutes from './src/routes/build-info.js';`，在第 240 行附近 `app.use('/api/brain/manifest', ...)` 紧邻位置追加 `app.use('/api/brain/build-info', buildInfoRoutes);`。
- 不修改 `package.json`、不动其他 router、不引入新的 npm 依赖。

**大小**: S（预计实现侧 < 60 行新增 + ~ 2 行 server.js 改动）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/build-info.test.js`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖（共 11 个 it()） | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/build-info.test.js` | (1) 200 + content-type / (2-4) 三个独立 own-property 断言 git_sha & package_version & built_at / (5) 严格三键集合（sort 后 toEqual） / (6) package_version 严格相等 brain/package.json.version / (7) built_at ISO toISOString round-trip 恒等 / (8) 同时清空 `GIT_SHA / GIT_COMMIT / COMMIT_SHA / SOURCE_COMMIT / VERCEL_GIT_COMMIT_SHA` 后 git_sha 仍非空 / (9) 五个 env 变量按 `GIT_SHA → GIT_COMMIT → COMMIT_SHA → SOURCE_COMMIT → VERCEL_GIT_COMMIT_SHA → 'unknown'` 优先级解析 / (10) `process.chdir('/tmp')` 后 package_version 仍等于 brain/package.json.version（cwd 漂移防御） / (11) 双 router cascade：build-info.js 与 brain-manifest.js 都作为 ESM 模块可加载且 default export 是 Router-shaped 函数 | 共 11 个 `it()`，全部 FAIL（实现文件 `packages/brain/src/routes/build-info.js` 不存在；`beforeEach(vi.resetModules())` + per-it 内 dynamic import 各自抛 `Failed to load url ../../../packages/brain/src/routes/build-info.js`）。本地实跑命令：`cd sprints && npx vitest run --config ./vitest.config.js`；本地实测结果：`Test Files 1 failed (1) / Tests 11 failed (11)` |

## Red Evidence（Proposer 本地实跑摘要 — Round 3）

```
RUN  v1.6.1 /workspace/sprints
 ❯ tests/ws1/build-info.test.js  (11 tests | 11 failed) ~10ms
 × tests/ws1/build-info.test.js > [BEHAVIOR] > GET /api/brain/build-info returns 200 with content-type application/json
 × tests/ws1/build-info.test.js > [BEHAVIOR] > response body has own property git_sha
 × tests/ws1/build-info.test.js > [BEHAVIOR] > response body has own property package_version
 × tests/ws1/build-info.test.js > [BEHAVIOR] > response body has own property built_at
 × tests/ws1/build-info.test.js > [BEHAVIOR] > responds with exactly three own keys: git_sha / package_version / built_at (no extras)
 × tests/ws1/build-info.test.js > [BEHAVIOR] > package_version exactly equals the version field in packages/brain/package.json
 × tests/ws1/build-info.test.js > [BEHAVIOR] > built_at is a stable ISO 8601 string (round-trip via new Date().toISOString() is identity)
 × tests/ws1/build-info.test.js > [BEHAVIOR] > git_sha is a non-empty string even when GIT_SHA / GIT_COMMIT / COMMIT_SHA / SOURCE_COMMIT / VERCEL_GIT_COMMIT_SHA are all unset
 × tests/ws1/build-info.test.js > [BEHAVIOR] > git_sha resolution follows fixed priority GIT_SHA > GIT_COMMIT > COMMIT_SHA > SOURCE_COMMIT > VERCEL_GIT_COMMIT_SHA > "unknown"
 × tests/ws1/build-info.test.js > [BEHAVIOR] > package_version stays correct when process.cwd is changed away from brain directory (cwd-drift defense)
 × tests/ws1/build-info.test.js > [BEHAVIOR] > both build-info and brain-manifest routers expose Router-shaped default export (cascade guard: build-info ESM contract + manifest router untouched)
Test Files  1 failed (1)
Tests       11 failed (11)
```

三表口径对齐（internal_consistency 验证）：BEHAVIOR 覆盖列表条目数 = 11，Test Contract 表 it() 数 = 11，Red Evidence 实跑 FAIL 数 = 11。

## 备注

- 测试扩展名使用 `.js`：项目 brain 包是 ESM JS、无 TypeScript 配置；vitest include 模式 `*.{test,spec}.?(c|m)[jt]s?(x)` 同时接受 `.test.js` 与 `.test.ts`。选 `.js` 让测试更稳地直接 runtime 加载，无 esbuild 类型转译副作用。
- `sprints/vitest.config.js` 是合同测试专属最小配置：只 include `tests/ws*/**/*.{test,spec}.?(c|m)[jt]s?(x)`，不继承 brain 包的 mock / 大量 exclude，避免 cross-package 副作用污染合同对抗。Generator 阶段实现完成后用同一命令转绿。
- **vitest pool 选择**：Round 3 切到 `pool: 'forks' + singleFork:true`。原因：vitest 默认 worker_threads pool 不允许 `process.chdir()`（防 worker 与主进程间 cwd 状态污染），但 it #10 的 cwd 漂移测试需要 chdir 到 `/tmp`。forks 模式每个测试文件作为独立子进程运行，chdir 只影响该子进程，与主进程边界清晰。`singleFork:true` 确保 11 个 it 在同一子进程顺序执行（保留 `vi.resetModules()` 的隔离语义同时避免多 fork 启动开销）。
- **测试默认隔离 module 缓存**：测试文件顶部 `beforeEach(() => vi.resetModules())`。理由——`build-info.js` 在模块加载时一次性读取 `process.env.*` 与 `new Date().toISOString()`，ESM 默认全局缓存模块；若不重置，第二个 it 之后的 dynamic import 会复用首个 it 评估时的 env 快照，导致 it #8（清空 env vars）和 it #9（priority 矩阵）和 it #10（cwd 漂移）的 env / cwd 操控**静默失效**。`beforeEach(vi.resetModules())` 的设计与 Red Evidence 中"per-it dynamic import 各自抛 ERR_MODULE_NOT_FOUND" 口径一致：Red 阶段每个 it 各自独立标红，Green 阶段各 it 各自重新评估模块顶层，不会互相污染。
- **每个 `it()` 内部用 `await import(...)` 动态加载**而非顶层 import：Red 阶段（实现文件不存在）每个 it 各自抛 `ERR_MODULE_NOT_FOUND` 并独立 FAIL，避免 suite 顶层 import 折叠成单条错误，损失粒度。
- **"模块加载时一次性"语义澄清**（针对 Round 2 R-3 反馈）：合同语义指**单进程内 import 一次后**所有 GET 请求返回相同的 `built_at` / `git_sha` / `package_version`；不延伸到"跨 `vi.resetModules()` 也不变"——后者会强制重新评估模块顶层，本来就不应稳定。it #7 因此只断言 round-trip 恒等（`new Date(x).toISOString() === x`），不跨 it 比较时间戳。Green 阶段实现的"启动时一次性"对应**生产 server.js 启动后所有请求一致**的真实语义。
- **git_sha 优先级测试设计**：测试预先 snapshot 5 个 env 变量当前值（确保测试结束 finally 块完整还原），然后将全部 5 个设为可识别的 sentinel 字符串（如 `priority-marker-GIT_SHA`），逐个删除当前最高优先级变量并 `vi.resetModules()` + 重新 import 验证次高位接管，最终全部删除后断言落在字面量 `'unknown'`。该测试单独验证"实现是否使用了固定优先级"——任何打乱顺序、跳过某个变量、或回落值不是 `'unknown'` 的实现都会被打回。
- **cwd 漂移测试设计（it #10，对应 Round 2 R-2）**：snapshot `process.cwd()`，`process.chdir('/tmp')`（最常见的非 brain 目录），`vi.resetModules()` 强迫 build-info.js 重新评估顶层（重新解析 package.json 路径），调用 GET 端点断言 `package_version` 仍是 brain/package.json.version；finally 块还原 cwd。配合 ARTIFACT 静态层"必须用 import.meta.url + fileURLToPath"——**任何 cwd 相对路径解析的实现都会在 chdir('/tmp') 后 readFile 抛错或读到 `/tmp/package.json`（不存在或非 brain version），双重防御 mutation**。
- **既有路由 cascade guard（it #11，对应 Round 2 R-4）**：原方案是 supertest smoke `GET /api/brain/manifest → 200`，但该端点依赖 `brain-manifest.generated.json` 实际状态（缺失/损坏会 500），smoke 测试会因外部状态不稳。改为更直接的"router 文件结构完整性"断言：dynamic import 两个 router 模块，断言 default export 是 Router-shaped function（带 `.use` 方法）。Red 阶段 build-info.js 缺失 → import 抛 ERR_MODULE_NOT_FOUND → fail（保护测试自身红色）；Green 阶段任何"server.js 重构连带挪动/删除 brain-manifest.js 文件"的 mutation → import 抛 ERR_MODULE_NOT_FOUND → fail（cascade 保护既有路由）。
