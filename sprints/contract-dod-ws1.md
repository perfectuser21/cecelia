# Contract DoD — Workstream 1: build-info endpoint

**范围**: 完整实现 `/api/brain/build-info` 端点（路由文件 + server 挂载 + Dockerfile GIT_SHA 注入 + brain 内部 supertest 测试 4 个文件）

**大小**: S（< 150 行净增）

**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/build-info.js` 文件存在
  Test: test -f packages/brain/src/routes/build-info.js

- [ ] [ARTIFACT] `packages/brain/src/routes/build-info.js` 内含 `Router` 引用且有 default export
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');if(!/Router/.test(c)||!/export\s+default/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 含 `app.use('/api/brain/build-info', ...)` 挂载语句
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/app\.use\(\s*['\"]\/api\/brain\/build-info['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/Dockerfile` 含 `ARG GIT_SHA` 行
  Test: node -e "const c=require('fs').readFileSync('packages/brain/Dockerfile','utf8');if(!/^ARG\s+GIT_SHA\b/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/Dockerfile` 含 `ENV GIT_SHA=$GIT_SHA` 行
  Test: node -e "const c=require('fs').readFileSync('packages/brain/Dockerfile','utf8');if(!/^ENV\s+GIT_SHA=\$GIT_SHA\b/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/__tests__/build-info.test.js` 文件存在
  Test: test -f packages/brain/src/__tests__/build-info.test.js

- [ ] [ARTIFACT] `packages/brain/src/__tests__/build-info.test.js` 含 supertest import（PRD SC-004 强制）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/build-info.test.js','utf8');if(!/from\s+['\"]supertest['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/routes/build-info.js` 不 import 任何 DB / queue 依赖（PRD FR-007 强制零外部依赖）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');if(/from\s+['\"][.\/]+db\.js['\"]/.test(c)||/from\s+['\"]pg['\"]/.test(c)||/from\s+['\"]ioredis['\"]/.test(c)||/from\s+['\"]bullmq['\"]/.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/build-info.test.ts`，覆盖：
- returns HTTP 200 on GET /api/brain/build-info
- returns JSON body with exactly three keys: built_at, git_sha, package_version
- returns package_version equal to packages/brain/package.json.version
- returns identical built_at across two consecutive requests (cached at module load)
- returns built_at as a valid ISO 8601 UTC timestamp
- returns git_sha equal to GIT_SHA env value when set at module load
- returns git_sha equal to "unknown" when GIT_SHA env is empty string at module load
- returns 200 with non-empty git_sha string when GIT_SHA env is unset (no throw)
