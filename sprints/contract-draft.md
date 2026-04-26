# Sprint Contract Draft (Round 2)

## Stable IDs（合同内引用，杜绝粘贴漂移）

为防止"两处粘贴 PRD 路径不一致 → ARTIFACT 假阴性"型漂移，本合同引入稳定 ID。**任何时候提到 server.js / Router 文件 / 包清单时，必须引用这些 ID 而非裸字符串路径**。Generator 实现时按 ID → path 映射表落盘；Reviewer 验合同时也按映射表查文件。

| Stable ID | 真实路径 | 用途 |
|---|---|---|
| `<SERVER_JS_PATH>` | `packages/brain/server.js` | Brain Express 应用入口（实际工程结构：**无** `src/` 前缀，PRD SC-002 写法 `packages/brain/src/server.js` 与真实工程冲突，本合同以真实路径为准） |
| `<ROUTER_FILE_PATH>` | `packages/brain/src/routes/build-info.js` | 新建的 build-info Express Router 模块 |
| `<BRAIN_PKG_PATH>` | `packages/brain/package.json` | Brain 包清单（`package_version` 真值来源） |
| `<SPRINT_TEST_PATH>` | `sprints/tests/ws1/build-info.test.js` | 合同测试落点（GAN 对抗冻结产物） |
| `<VITEST_CONFIG_PATH>` | `sprints/vitest.config.js` | 独立 vitest 配置（root=repo 根，include sprints/tests/**） |

---

## Feature 1: GET /api/brain/build-info 端点

**行为描述**:
Brain 进程启动后，客户端对路径 `/api/brain/build-info` 发起 HTTP GET 请求时，端点同步返回 JSON 响应。响应体只包含三个键：`git_sha`（当前 commit 的 40 位十六进制 SHA，无法获取时为字符串 `"unknown"`）、`package_version`（与 `<BRAIN_PKG_PATH>` 的 `version` 字段字节级一致）、`built_at`（进程启动时一次性确定的 ISO 8601 时间戳，对同一进程内的所有后续请求保持完全相等）。响应 status=200，Content-Type 包含 `application/json`。

**硬阈值**:
- 响应 `status === 200`
- 响应头 `Content-Type` 字符串包含子串 `application/json`
- 响应 body 是一个 plain JSON object，`Object.keys(body).sort()` 严格等于 `['built_at', 'git_sha', 'package_version']`（即"含且仅含三键"，无第四键）
- `body.git_sha` 类型为 string，且匹配正则 `/^([0-9a-f]{40}|unknown)$/`
- `body.package_version` 字符串严格等于 `JSON.parse(readFileSync('<BRAIN_PKG_PATH>')).version`
- `body.built_at` 字符串满足 `new Date(body.built_at).toISOString() === body.built_at`（ISO 8601 round-trip 严格相等）
- 同一进程实例下，连续 N≥3 次请求得到的 `body.built_at` 字符串两两严格相等
- 同一进程内**两次基于同一 Router 模块构建的 app 实例** ESM 缓存命中后，两次 app 的 `built_at` 字符串严格相等（防"BUILT_AT 在 Router factory 内重计算"型 mutation）

**BEHAVIOR 覆盖**（落成 `<SPRINT_TEST_PATH>` 真实 it() 块）:
- `it('GET /api/brain/build-info returns status 200 with application/json content-type')`
- `it('response body has exactly three keys: built_at, git_sha, package_version')`
- `it('package_version equals <BRAIN_PKG_PATH> version field')`
- `it('built_at is a valid ISO 8601 timestamp (round-trip identical)')`
- `it('returns identical built_at across three consecutive requests within the same process')`
- `it('BUILT_AT is frozen at module load: two app instances built from the same Router module share built_at')`
- `it('git_sha matches /^([0-9a-f]{40}|unknown)$/')`
- `it('git_sha falls back to "unknown" when execSync throws (command not found)')`
- `it('git_sha falls back to "unknown" when execSync throws ETIMEDOUT (CI sandbox timeout simulation)')`

**ARTIFACT 覆盖**（写入 `contract-dod-ws1.md`）:
- 文件 `<ROUTER_FILE_PATH>` 存在
- 该文件 default-export 一个 Express Router 实例（含 `.use` / `.get` 等 Router 方法）
- 该文件含模块顶层常量 `const BUILT_AT = new Date().toISOString()`（防"每次请求重新生成"型 mutation）
- 该文件 `execSync` 调用包含 `timeout` 选项与 try/catch（防 R1 CI sandbox 子进程超时型 ABORT）
- `<SERVER_JS_PATH>` 含静态 import 语句 `import buildInfoRouter from './src/routes/build-info.js'`
- `<SERVER_JS_PATH>` 含挂载语句 `app.use('/api/brain/build-info', buildInfoRouter)`
- `<SPRINT_TEST_PATH>` 存在且含 ≥9 个 `it(` 调用
- `<VITEST_CONFIG_PATH>` 存在且 vitest 能从此 config 发现 `<SPRINT_TEST_PATH>`（config 文件 sanity check：防 R2 cascade-red 假红）

---

## Risks（v9 zero-babysit 链路 ≥7 条具名风险登记）

每条 risk 给出：触发条件 → 失败现象 → mitigation（落到合同某个具体 [ARTIFACT] / [BEHAVIOR] 条目）。Reviewer 可按编号回查合同覆盖。

### R1: `git rev-parse HEAD` 在 CI sandbox 子进程超时 / 权限不足

**触发**: GitHub Actions runner / Docker sandbox 限制 `git` 二进制权限，或 git 索引锁定，子进程挂起 > 默认超时
**失败现象**: 路由请求长时间阻塞 → 测试 timeout → Evaluator 看到红色但归因不出是 git 还是路由本身
**Mitigation**:
- ARTIFACT: `<ROUTER_FILE_PATH>` 中 `execSync` 必须包含 `timeout: 2000`（毫秒）选项 + `stdio: 'pipe'`（防止继承 fd）+ 整体包在 try/catch 中，catch 分支返回 `'unknown'`（DoD 条目"execSync 调用包含 timeout 选项与 try/catch"以正则锁定）
- BEHAVIOR: 新增 `it('git_sha falls back to "unknown" when execSync throws ETIMEDOUT')` 用 `vi.doMock('child_process')` 注入 throw `Error` with `code: 'ETIMEDOUT'`

### R2: `<VITEST_CONFIG_PATH>` 不存在 / root 设错 → 9 条 it() 全 cascade-red 但红的原因是 config 而非实现缺失

**触发**: vitest config 文件丢失，或 root 路径解析错误，或 include glob 匹配不到测试文件
**失败现象**: `npx vitest run` 报 "No test files found" 或 "Cannot resolve test path"，Evaluator 误判为"实现还没写"，但实际是 config 出错
**Mitigation**:
- ARTIFACT: 新增 config 文件 sanity check —— `npx vitest run -c <VITEST_CONFIG_PATH> --reporter=verbose 2>&1` 输出必须含 `build-info.test.js` 串（证明 vitest 真的发现了测试文件）。这一关在 ARTIFACT 阶段就拦截，不会污染 BEHAVIOR 红证据

### R3: 多个 it() 共享同一进程，但每个 it() 都用 `loadAppFresh()` 新建 app → 测试者预期的 BUILT_AT 不变性其实是 ESM 缓存行为；若 Generator 把 `BUILT_AT = new Date().toISOString()` 放在 Router factory 内，supertest 每次新建 app 会让 BUILT_AT 变化造成假红

**触发**: Generator 把 `const buildInfoRouter = (() => { const router = express.Router(); router.get('/', (_, res) => res.json({ built_at: new Date().toISOString(), ... })); return router; })()` 写成 factory，每次请求重生 BUILT_AT
**失败现象**: 单 it() 内 N=3 idempotent 测试因为只调一次 `loadAppFresh()` 仍然过；但 round-1 测试无法区分"BUILT_AT 是模块顶层常量"与"BUILT_AT 在 Router 内每请求新生"两种实现
**Mitigation**:
- BEHAVIOR: 新增 `it('BUILT_AT is frozen at module load: two app instances built from the same Router module share built_at')` —— 在**同一个 it() 内**两次 `loadAppFresh()`（不调 `vi.resetModules()`），两个 app 各自挂载同一个 Router import，断言两 app 的 `/api/brain/build-info` 响应 `built_at` 严格相等。强制 BUILT_AT 必须是模块顶层常量
- ARTIFACT: `const BUILT_AT = new Date().toISOString()` 必须出现在模块顶层（行首无缩进，正则锚定 `^\s*const\s+BUILT_AT`）

### R4: PRD SC-002 写 `packages/brain/src/server.js` 与真实工程结构 `packages/brain/server.js` 冲突 → 两处粘贴时漂移，ARTIFACT 测试假阴性

**触发**: PRD 作者凭印象写路径；Generator 实现按真实路径落盘；Reviewer 拿 PRD 路径校验导致 file-not-found
**失败现象**: ARTIFACT 测试 `accessSync('packages/brain/src/server.js')` 报 ENOENT，Evaluator 报告"实现缺失"，实际是 PRD 路径错
**Mitigation**:
- 合同顶部"Stable IDs"区定义 `<SERVER_JS_PATH>` = `packages/brain/server.js`（真实路径）；合同正文、DoD、test 全部引用 ID 而非裸字符串路径；Reviewer 看的是同一份 ID → path 映射表

### R5: ESM `import.meta.url` 在两处落点（`<SPRINT_TEST_PATH>` 与 `packages/brain/src/__tests__/build-info.test.js`）的 `__dirname` 不同 → 单文件双落点 import 路径漂移

**触发**: Generator 把测试文件原样复制到 `packages/brain/src/__tests__/`，但 import 路径是相对 sprints/tests/ws1/ 写的，复制后路径错
**失败现象**: 两处之一的测试 import 失败，CI dod-structure-purity 校验过不去
**Mitigation**:
- 测试文件内置 `isSprintCopy` 判别（基于 `__dirname.includes('sprints/tests/ws1')`），按落点动态选 `ROUTER_SPEC` 与 `BRAIN_PKG_PATH`，**单一文件字节级原样可双落点**

### R6: `vi.doMock('child_process')` 在多 it() 之间泄漏 → 后续测试 git_sha 也变成 'unknown'

**触发**: 测试运行器复用 module cache，`vi.doMock` 注册的 mock 在后续 it() 仍生效
**失败现象**: 第 7 条 it() 通过后，第 6 条 git_sha pattern 测试因为 git_sha 变 'unknown' 仍然过（因为正则容许 'unknown'），但隐藏了"真实 git 路径根本没跑过"的事实
**Mitigation**:
- 测试 `beforeEach(() => vi.resetModules())` + `afterEach(() => { vi.doUnmock('child_process'); vi.doUnmock('node:child_process'); vi.resetModules(); })`
- 对 fallback 测试用专门的 `describe` 块隔离，且 `loadAppFresh('?fallback')` / `'?etimedout'` 用 query string 触发新模块图

### R7: CI sandbox `git rev-parse HEAD` 输出含尾部换行 → `git_sha` 字符串末尾 `\n` 让 40-hex 正则不匹配

**触发**: `execSync('git rev-parse HEAD').toString()` 默认含 `\n` 结尾
**失败现象**: 真实 git 路径下，`git_sha` 形如 `"aa0a3041c...\n"`（41 字符），正则 `/^([0-9a-f]{40}|unknown)$/` 不匹配，测试红
**Mitigation**:
- 硬阈值正则严格锁 40-hex（不容许尾换行/前缀）
- BEHAVIOR `it('git_sha matches /^([0-9a-f]{40}|unknown)$/')` 间接强制 Generator 实现必须 `.trim()` execSync 输出

### R8: 不含 git 历史的 build sandbox（如 Docker `COPY` 不带 .git）下，git 命令可用但 rev-parse 失败 → 路由必须仍返回 200

**触发**: 生产部署用 multi-stage Docker，最终镜像无 `.git`；或 lambda 包打包丢失 git 元数据
**失败现象**: 路由抛 500，整个端点不可用，违反 PRD US-001 边界场景 3
**Mitigation**:
- BEHAVIOR `it('git_sha falls back to "unknown" when execSync throws (command not found)')` 已覆盖
- ARTIFACT execSync 必须 try/catch 整体包裹（与 R1 mitigation 共享同一条 ARTIFACT，但触发路径不同：R1 是 timeout，R8 是 ENOENT/non-zero exit）

---

## Workstreams

workstream_count: 1

### Workstream 1: build-info Express Router + server.js mount + supertest 集成测试

**范围**: 单一 Express Router 模块（`<ROUTER_FILE_PATH>`，约 35 行）+ `<SERVER_JS_PATH>` 加 1 行 import + 1 行 `app.use` 挂载 + supertest 集成测试。无外部依赖，无 db 触碰，无并发逻辑。
**大小**: S（<100 行总改动，新代码 ~40 行 + 2 行 server.js mod + 测试 ~210 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `<SPRINT_TEST_PATH>`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `<SPRINT_TEST_PATH>` | status+content-type / 三键 only / package_version match / ISO 8601 round-trip / built_at idempotent N=3 / **BUILT_AT cross-app frozen (新增 R3 mitigation)** / git_sha 40-hex pattern / git_sha unknown fallback (command not found) / **git_sha unknown fallback ETIMEDOUT (新增 R1 mitigation)** | `npx vitest run -c <VITEST_CONFIG_PATH>` → Test Files 1 failed (1), Tests 9 failed (9)，每条 fail 原因均为 `Failed to load url ../../../packages/brain/src/routes/build-info.js`（实现尚不存在），证明测试真实 import 实现路径，未 mock 被测对象本身 |

---

## Round 2 修订摘要（vs Round 1）

针对 Reviewer round-1 反馈（VERDICT: REVISION，risk_registered=1，目标 ≥7）：

1. **Stable ID 引入**：新增"Stable IDs"区，`<SERVER_JS_PATH>` 等 5 个 ID 全合同引用，杜绝 PRD 路径与真实工程"两处粘贴漂移"型 ABORT
2. **Risks 登记 8 条**（vs round-1 的 1 条）：每条 R1-R8 都钩到具体 ARTIFACT / BEHAVIOR mitigation，Reviewer 可按编号回查
3. **新增 BEHAVIOR 测试 2 条**（it 总数 7 → 9）：
   - `it('BUILT_AT is frozen at module load: two app instances built from the same Router module share built_at')`（R3 mitigation：抓"BUILT_AT 藏在 Router factory / 每请求新生"型 mutation）
   - `it('git_sha falls back to "unknown" when execSync throws ETIMEDOUT')`（R1 mitigation：抓"execSync 无 timeout"型 mutation）
4. **新增 ARTIFACT 2 条**：
   - `<VITEST_CONFIG_PATH>` config 文件 sanity check（R2 mitigation：在 ARTIFACT 阶段拦截 cascade-red，让 Evaluator 能分辨真红假红）
   - `<ROUTER_FILE_PATH>` execSync 调用必须含 `timeout` 选项 + try/catch 包裹（R1+R8 mitigation：正则锁实现）
