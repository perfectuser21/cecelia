# Contract DoD — Workstream 1: build-info 端点路由 + 集成测试

**范围**: 新增 Express Router 模块 `packages/brain/src/routes/build-info.js`，在 `packages/brain/server.js` 挂载到 `/api/brain/build-info`，并在 `packages/brain/src/__tests__/build-info.test.js` 落地 supertest 集成测试。
**大小**: S
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] 文件 `packages/brain/src/routes/build-info.js` 存在
  Test: test -f packages/brain/src/routes/build-info.js

- [ ] [ARTIFACT] `packages/brain/src/routes/build-info.js` 包含 Express `Router(` 调用并通过 `export default` 默认导出 router
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');if(!/Router\s*\(/.test(c)){console.error('missing Router( call');process.exit(1)}if(!/export\s+default\s+\w+/.test(c)){console.error('missing export default');process.exit(1)}"

- [ ] [ARTIFACT] `packages/brain/server.js` 在 `/api/brain/build-info` 路径挂载新 router（含字面量片段 `app.use('/api/brain/build-info'`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/app\.use\(\s*['\"]\/api\/brain\/build-info['\"]/.test(c)){console.error('missing app.use mount for /api/brain/build-info');process.exit(1)}"

- [ ] [ARTIFACT] `packages/brain/server.js` import 了 build-info router 模块（含字面量片段 `routes/build-info`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/from\s+['\"]\.\/src\/routes\/build-info(\.js)?['\"]/.test(c)){console.error('missing import for ./src/routes/build-info');process.exit(1)}"

- [ ] [ARTIFACT] 文件 `packages/brain/src/__tests__/build-info.test.js` 存在（Generator 从 `sprints/tests/ws1/build-info.test.js` 原样复制）
  Test: test -f packages/brain/src/__tests__/build-info.test.js

- [ ] [ARTIFACT] 实现侧测试文件与合同测试文件**字节级相等**（保证 Generator 没篡改 GAN 已批准的测试体）
  Test: bash -c "diff -q sprints/tests/ws1/build-info.test.js packages/brain/src/__tests__/build-info.test.js"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws1/）

见 `sprints/tests/ws1/build-info.test.js`，覆盖 7 个 it，对应 PRD 的 4 个验收场景 + 显式三键约束 + git_sha 类型 + git_sha fallback 分支：

- `responds 200 with Content-Type application/json` → 验收场景 1（status / content-type）
- `responds with body containing exactly the three keys git_sha, package_version, built_at` → 验收场景 1（"含且仅含"三键）
- `returns package_version equal to packages/brain/package.json version` → 验收场景 4（SC-004）
- `returns built_at as a valid ISO 8601 string that round-trips through Date` → SC-005
- `returns identical built_at across two requests in the same process` → 验收场景 2（SC-006）
- `returns git_sha matching either /^[0-9a-f]{7,40}$/ or the literal "unknown"` → 类型/格式护栏，禁止 null/空串/任意字符串
- `returns git_sha === "unknown" when child_process.execSync throws at module load` → 验收场景 3（FR-003 fallback 分支）
