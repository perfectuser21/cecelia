# Contract DoD — Workstream 1: GET /api/brain/time 端点 + 路由注册 + 文档同步

**范围**: 新增只读端点 `GET /api/brain/time` 返回 `{iso, timezone, unix}`；在 `packages/brain/server.js` 顶层（零缩进）注册；新增生产侧测试 `packages/brain/tests/time.test.js`（必须 import server.js 做真实 supertest，不仅是私有 express app）；同步 `CLAUDE.md` 第 7 节

**大小**: S（<100 行）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] 路由文件 `packages/brain/src/routes/time.js` 存在
  Test: node -e "require('fs').accessSync('packages/brain/src/routes/time.js')"

- [ ] [ARTIFACT] 路由文件导出 Express Router（含 `export default` 和 `Router`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/export\s+default\s+router/.test(c)||!/Router\s*\(\s*\)/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 路由文件注册 `GET /` 处理器
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/router\.get\(\s*['\"]\/['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 顶部 import 时间路由（指向 `./src/routes/time.js`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/import\s+timeRoutes\s+from\s+['\"]\.\/src\/routes\/time\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 注册精确路径字面量 `/api/brain/time`（禁止 `/api/brain/times` 等笔误形变 — Reviewer 风险 3 回应）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/app\.use\(\s*['\"]\/api\/brain\/time['\"]\s*,\s*timeRoutes\s*\)/.test(c))process.exit(1);if(/['\"]\/api\/brain\/times?(?![A-Za-z0-9_])['\"]/.test(c)&&!/['\"]\/api\/brain\/time['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `server.js` 中 `app.use('/api/brain/time', timeRoutes)` 行为顶层注册（零缩进，不在 if/try/else/函数块内 — Reviewer 风险 3 回应）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');const hits=c.split('\n').filter(l=>/app\.use\(\s*['\"]\/api\/brain\/time['\"]/.test(l));if(hits.length<1)process.exit(1);for(const l of hits){if(!/^app\.use\(/.test(l))process.exit(1)}"

- [ ] [ARTIFACT] 生产侧测试文件 `packages/brain/tests/time.test.js` 存在
  Test: node -e "require('fs').accessSync('packages/brain/tests/time.test.js')"

- [ ] [ARTIFACT] 生产侧测试 import 真实 route 模块（不能只引 vi.mock 占位）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/tests/time.test.js','utf8');if(!/from\s+['\"]\.\.\/src\/routes\/time\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 生产侧测试 **import `packages/brain/server.js` default export 并调用 supertest 对 `/api/brain/time` 发起 GET** —— 把"从 server.js 入口可达"锁到 Green commit（Reviewer 风险 3 回应）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/tests/time.test.js','utf8');const hasSrv=/import\s+\w+\s+from\s+['\"]\.\.\/server\.js['\"]/.test(c)||/await\s+import\s*\(\s*['\"]\.\.\/server\.js['\"]\s*\)/.test(c);const hasSt=/from\s+['\"]supertest['\"]/.test(c);const hasGet=/\.get\(\s*['\"]\/api\/brain\/time['\"]/.test(c);if(!hasSrv||!hasSt||!hasGet)process.exit(1)"

- [ ] [ARTIFACT] `CLAUDE.md` "Brain 知识查询工具" 区块出现字面量 `/api/brain/time`
  Test: node -e "const c=require('fs').readFileSync('.claude/CLAUDE.md','utf8').replace(/\r/g,'');const i=c.indexOf('## 7. Brain 知识查询工具');const j=c.indexOf('\n## ',i+1);const seg=(j>0?c.slice(i,j):c.slice(i));if(!seg.includes('/api/brain/time'))process.exit(1)"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws1/）

见 `sprints/tests/ws1/time.test.js`，覆盖 **12 个 it**：

*第一组 — 功能行为（8 个）*:

- responds with HTTP 200 and application/json on GET /api/brain/time
- response body has exactly three keys: iso, timezone, unix
- iso is an ISO-8601 UTC millisecond string
- timezone is a valid IANA zone matching UTC or Area/Location(/Sub)
- timezone round-trips through Intl.DateTimeFormat without throwing
- unix is an integer within 1 second of current wall clock
- iso and unix represent the same moment within 1 second tolerance
- two consecutive calls spaced 1.1 seconds return different unix values

*第二组 — server.js 挂载点完整性（4 个，Reviewer 风险 3 回应）*:

- server.js can be read and contains no obvious typo around /api/brain/time
- server.js imports timeRoutes default export from ./src/routes/time.js
- server.js registers app.use with exact path /api/brain/time bound to timeRoutes
- app.use(/api/brain/time, ...) line is at top level (not nested in if/try/else block)
