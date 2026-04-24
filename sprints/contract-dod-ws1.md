# Contract DoD — Workstream 1: Health Route Module

**范围**: 新增路由模块 `packages/brain/src/routes/health.js`，实现 `GET /` 返回 `{status, uptime_seconds, version}`。不得 import `db.js` / `tick.js` 或任何外部服务。`version` 来自 `packages/brain/package.json`。
**大小**: S
**依赖**: 无

---

## ARTIFACT 条目

- [ ] [ARTIFACT] 路由源文件 `packages/brain/src/routes/health.js` 存在
  Test: node -e "require('fs').accessSync('packages/brain/src/routes/health.js')"

- [ ] [ARTIFACT] `packages/brain/src/routes/health.js` 使用 `export default` 导出
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/health.js','utf8');if(!/export\s+default\s+/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/routes/health.js` 含 `router.get('/', ...)` handler 定义
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/health.js','utf8');if(!/router\.get\(\s*['\"]\/['\"]\s*,/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/routes/health.js` 不 import 数据库模块 `db.js`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/health.js','utf8');if(/from\s+['\"][^'\"]*\/db\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/routes/health.js` 不 import tick 模块 `tick.js`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/health.js','utf8');if(/from\s+['\"][^'\"]*\/tick\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/routes/health.js` 源码不含 `pool.query` 调用
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/health.js','utf8');if(/pool\.query/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/routes/health.js` 源码不含 `getTickStatus` 调用
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/health.js','utf8');if(/getTickStatus/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 单元测试文件 `packages/brain/src/__tests__/routes/health.test.js` 存在
  Test: node -e "require('fs').accessSync('packages/brain/src/__tests__/routes/health.test.js')"

- [ ] [ARTIFACT] 单元测试文件含至少 3 个 `it(` 块（确保不是空壳）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/routes/health.test.js','utf8');const m=c.match(/\\bit\\s*\\(/g)||[];if(m.length<3)process.exit(1)"

---

## BEHAVIOR 索引（实际测试在 sprints/tests/ws1/）

见 `sprints/tests/ws1/health-route.test.ts`，覆盖：
- returns HTTP 200 with only status/uptime_seconds/version keys
- returns status equal to literal string "ok"
- returns uptime_seconds as a non-negative number
- returns version as a non-empty string
- responds with application/json content-type
- does not invoke pg pool query during request handling
- does not invoke getTickStatus during request handling
- still returns 200 with full shape when pg pool rejects
- completes within 500ms even under rejecting pg pool
