# Contract DoD — Workstream 1: build-info Express Router + server.js mount + 集成测试

**范围**: 创建 `<ROUTER_FILE_PATH>` Router 模块；在 `<SERVER_JS_PATH>` 静态 import 并挂载该 Router；编写 supertest 集成测试。
**大小**: S（总改动 <100 行）
**依赖**: 无

**Stable ID → 真实路径映射**（全文引用 ID，杜绝粘贴漂移）：
- `<ROUTER_FILE_PATH>` = `packages/brain/src/routes/build-info.js`
- `<SERVER_JS_PATH>` = `packages/brain/server.js`（**真实路径无 src/ 前缀**，与 PRD SC-002 文本不一致以本合同为准 — R4 mitigation）
- `<BRAIN_PKG_PATH>` = `packages/brain/package.json`
- `<SPRINT_TEST_PATH>` = `sprints/tests/ws1/build-info.test.js`
- `<VITEST_CONFIG_PATH>` = `sprints/vitest.config.js`

## ARTIFACT 条目

- [ ] [ARTIFACT] 路由文件 `<ROUTER_FILE_PATH>` 存在
  Test: node -e "require('node:fs').accessSync('packages/brain/src/routes/build-info.js')"

- [ ] [ARTIFACT] 路由文件 default-export 一个 Express Router 实例（含 `.get` 与 `.use` 方法，与 `express.Router()` 同形）
  Test: node -e "import('./packages/brain/src/routes/build-info.js').then(m => { const r = m.default; if (!r || typeof r.get !== 'function' || typeof r.use !== 'function') process.exit(1); }).catch(() => process.exit(1))"

- [ ] [ARTIFACT] 路由文件含模块顶层常量 `const BUILT_AT = new Date().toISOString()`（在模块加载时一次性确定，行首无缩进锚定 — 防 R3"BUILT_AT 藏在 Router factory 闭包"型 mutation）
  Test: node -e "const c=require('node:fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');if(!/^\s*const\s+BUILT_AT\s*=\s*new\s+Date\(\s*\)\s*\.toISOString\(\s*\)\s*;?\s*$/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] 路由文件 `execSync` 调用包含 `timeout` 选项与 try/catch 包裹（R1+R8 mitigation — 防 CI sandbox 子进程超时型 ABORT；正则要求 execSync 第二参数对象内出现 `timeout` 键，且文件含 `try` + `catch`）
  Test: node -e "const c=require('node:fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');if(!/execSync\s*\([^)]*,\s*\{[^}]*timeout\s*:/.test(c))process.exit(1);if(!/\btry\s*\{/.test(c)||!/\bcatch\s*\(/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `<SERVER_JS_PATH>` 含静态 import 语句 `import buildInfoRouter from './src/routes/build-info.js'`
  Test: node -e "const c=require('node:fs').readFileSync('packages/brain/server.js','utf8');if(!/import\s+buildInfoRouter\s+from\s+['\"]\.\/src\/routes\/build-info\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `<SERVER_JS_PATH>` 含挂载语句 `app.use('/api/brain/build-info', buildInfoRouter)`
  Test: node -e "const c=require('node:fs').readFileSync('packages/brain/server.js','utf8');if(!/app\.use\(\s*['\"]\/api\/brain\/build-info['\"]\s*,\s*buildInfoRouter\s*\)/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 集成测试文件 `<SPRINT_TEST_PATH>` 存在且含至少 9 个 `it(` 调用（round-2 从 7 增至 9：新增 R1 ETIMEDOUT fallback + R3 BUILT_AT cross-app frozen）
  Test: bash -c "test -f sprints/tests/ws1/build-info.test.js && [ \"$(grep -cE '^[[:space:]]*it\\(' sprints/tests/ws1/build-info.test.js)\" -ge 9 ]"

- [ ] [ARTIFACT] `<VITEST_CONFIG_PATH>` 存在（使 Reviewer 在 repo 根可运行 `npx vitest run -c sprints/vitest.config.js`）
  Test: test -f sprints/vitest.config.js

- [ ] [ARTIFACT] `<VITEST_CONFIG_PATH>` config 文件 sanity check：vitest 用此 config 能发现 `<SPRINT_TEST_PATH>`（R2 mitigation — 在 ARTIFACT 阶段拦截"config 错导致 cascade-red"假红，让 Evaluator 能分辨真红假红）
  Test: bash -c "npx vitest run -c sprints/vitest.config.js --reporter=verbose 2>&1 | grep -q 'build-info.test.js'"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws1/）

见 `<SPRINT_TEST_PATH>`，覆盖 9 条 it()：
- GET /api/brain/build-info returns status 200 with application/json content-type
- response body has exactly three keys: built_at, git_sha, package_version
- package_version equals `<BRAIN_PKG_PATH>` version field
- built_at is a valid ISO 8601 timestamp (round-trip identical)
- returns identical built_at across three consecutive requests within the same process
- BUILT_AT is frozen at module load: two app instances built from the same Router module share built_at（R3 mitigation）
- git_sha matches /^([0-9a-f]{40}|unknown)$/
- git_sha falls back to "unknown" when execSync throws (command not found)
- git_sha falls back to "unknown" when execSync throws ETIMEDOUT（R1 mitigation）
