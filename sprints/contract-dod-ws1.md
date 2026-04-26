# Contract DoD — Workstream 1: build-info Express Router + server.js mount + 集成测试

**范围**: 创建 `packages/brain/src/routes/build-info.js` Router 模块；在 `packages/brain/server.js` 静态 import 并挂载该 Router；编写 supertest 集成测试。
**大小**: S（总改动 <100 行）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] 路由文件 `packages/brain/src/routes/build-info.js` 存在
  Test: node -e "require('node:fs').accessSync('packages/brain/src/routes/build-info.js')"

- [ ] [ARTIFACT] 路由文件 default-export 一个 Express Router 实例（含 `.get` 与 `.use` 方法，与 `express.Router()` 同形）
  Test: node -e "import('./packages/brain/src/routes/build-info.js').then(m => { const r = m.default; if (!r || typeof r.get !== 'function' || typeof r.use !== 'function') process.exit(1); }).catch(() => process.exit(1))"

- [ ] [ARTIFACT] 路由文件含模块顶层常量 `const BUILT_AT = new Date().toISOString()`（在模块加载时一次性确定，缓存语义在静态层锁定，防"每次请求重新生成"型 mutation）
  Test: node -e "const c=require('node:fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');if(!/^\s*const\s+BUILT_AT\s*=\s*new\s+Date\(\s*\)\s*\.toISOString\(\s*\)\s*;?\s*$/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 含静态 import 语句 `import buildInfoRouter from './src/routes/build-info.js'`
  Test: node -e "const c=require('node:fs').readFileSync('packages/brain/server.js','utf8');if(!/import\s+buildInfoRouter\s+from\s+['\"]\.\/src\/routes\/build-info\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 含挂载语句 `app.use('/api/brain/build-info', buildInfoRouter)`
  Test: node -e "const c=require('node:fs').readFileSync('packages/brain/server.js','utf8');if(!/app\.use\(\s*['\"]\/api\/brain\/build-info['\"]\s*,\s*buildInfoRouter\s*\)/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 集成测试文件 `sprints/tests/ws1/build-info.test.js` 存在且含至少 7 个 `it(` 调用
  Test: bash -c "test -f sprints/tests/ws1/build-info.test.js && [ \"$(grep -cE '^[[:space:]]*it\\(' sprints/tests/ws1/build-info.test.js)\" -ge 7 ]"

- [ ] [ARTIFACT] `sprints/vitest.config.js` 存在（使 Reviewer 在 repo 根可运行 `npx vitest run -c sprints/vitest.config.js`）
  Test: test -f sprints/vitest.config.js

## BEHAVIOR 索引（实际测试在 sprints/tests/ws1/）

见 `sprints/tests/ws1/build-info.test.js`，覆盖：
- GET /api/brain/build-info returns status 200 with application/json content-type
- response body has exactly three keys: built_at, git_sha, package_version
- package_version equals packages/brain/package.json version field
- built_at is a valid ISO 8601 timestamp (round-trip identical)
- returns identical built_at across three consecutive requests within the same process
- git_sha matches /^([0-9a-f]{40}|unknown)$/
- git_sha falls back to "unknown" when git rev-parse HEAD fails
