# Contract DoD — Workstream 1: GET /api/brain/time 端点 + 路由注册 + 文档同步

**范围**: 新增只读端点 `GET /api/brain/time` 返回 `{iso, timezone, unix}`；在 `packages/brain/server.js` 顶层（零缩进）注册；新增生产侧测试 `packages/brain/tests/time.test.js`（必须 import server.js default export 做真实 supertest，不仅是私有 express app）；同步 `CLAUDE.md` 第 7 节

**大小**: S（<100 行）
**依赖**: 无

**Round 4 变更**（Reviewer Round 3 反馈闭环）：
- 风险 1（阻塞）：删除 IANA 严格正则硬阈值（误杀 Etc/GMT+0 / GMT 等合法别名），改由 round-trip 做 IANA 权威验证
- 风险 2（阻塞）：DoD 新增 **第 11 条** — bash 调 vitest 运行时跑通 `packages/brain/tests/time.test.js`，真正锁"从 server.js 入口可达"，取代"纯 grep 静态后门"
- 风险 3（观察）：合同 sleep 1050ms → 1100ms，彻底消除 CI timer 抖动

## ARTIFACT 条目

- [ ] [ARTIFACT] 路由文件 `packages/brain/src/routes/time.js` 存在
  Test: node -e "require('fs').accessSync('packages/brain/src/routes/time.js')"

- [ ] [ARTIFACT] 路由文件导出 Express Router（含 `export default` 和 `Router`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/export\s+default\s+router/.test(c)||!/Router\s*\(\s*\)/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 路由文件注册 `GET /` 处理器
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/router\.get\(\s*['\"]\/['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 顶部 import 时间路由（指向 `./src/routes/time.js`，分号可选）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/^import\s+timeRoutes\s+from\s+['\"]\.\/src\/routes\/time\.js['\"];?\s*$/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 注册精确路径字面量 `/api/brain/time` 绑定 `timeRoutes`（正则放宽 — `\s*` 允许换行/空白，`;?` 允许分号可选，行尾 `$` with /m 标志；禁 `/api/brain/times`/`/api/brain/timer` 笔误 — Round 2 Reviewer 风险 3 的放宽版）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/app\.use\(\s*['\"]\/api\/brain\/time(?![A-Za-z0-9_])['\"]\s*,\s*timeRoutes\s*\)\s*;?\s*$/m.test(c))process.exit(1);if(/['\"]\/api\/brain\/times(?![A-Za-z0-9_])['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `server.js` 中至少存在一行 `app.use(` **零缩进起始**且包含 `/api/brain/time` 字面量（顶层注册，不在 if/try/else/函数块内 — Round 2 Reviewer 风险 3 的 DoD 侧兜底，放宽版）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');const lines=c.split('\n');const hits=lines.filter(l=>/^app\.use\(\s*['\"]\/api\/brain\/time(?![A-Za-z0-9_])['\"]/.test(l));if(hits.length<1)process.exit(1)"

- [ ] [ARTIFACT] 生产侧测试文件 `packages/brain/tests/time.test.js` 存在
  Test: node -e "require('fs').accessSync('packages/brain/tests/time.test.js')"

- [ ] [ARTIFACT] 生产侧测试 import 真实 route 模块 `../src/routes/time.js`（不能只引 vi.mock 占位）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/tests/time.test.js','utf8');if(!/from\s+['\"]\.\.\/src\/routes\/time\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 生产侧测试 **import `packages/brain/server.js` default export + `from 'supertest'` + `.get('/api/brain/time')`** —— 把"从 server.js 入口真实可达"锁到 Green commit（Reviewer 风险 3 的真正端到端锁，替代 Round 2 静态四 it）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/tests/time.test.js','utf8');const hasSrv=/import\s+\w+\s+from\s+['\"]\.\.\/server\.js['\"]/.test(c)||/await\s+import\s*\(\s*['\"]\.\.\/server\.js['\"]\s*\)/.test(c);const hasSt=/from\s+['\"]supertest['\"]/.test(c);const hasGet=/\.get\(\s*['\"]\/api\/brain\/time['\"]/.test(c);if(!hasSrv||!hasSt||!hasGet)process.exit(1)"

- [ ] [ARTIFACT] `CLAUDE.md` "Brain 知识查询工具" 区块出现字面量 `/api/brain/time`
  Test: node -e "const c=require('fs').readFileSync('.claude/CLAUDE.md','utf8').replace(/\r/g,'');const i=c.indexOf('## 7. Brain 知识查询工具');const j=c.indexOf('\n## ',i+1);const seg=(j>0?c.slice(i,j):c.slice(i));if(!seg.includes('/api/brain/time'))process.exit(1)"

- [ ] [ARTIFACT] **生产侧测试在 vitest 下真实运行通过** —— Round 4 Reviewer 风险 2 真正闭环锁。运行 `packages/brain/tests/time.test.js`，vitest exit 0 表示"server.js 挂载 + 路由行为 + 字段 schema"三者在运行时同时满足，不是 grep 字符串 能欺骗的静态后门（禁止在 if(false) 块内假挂载、禁止路径笔误、禁止 import 但未注册）
  Test: bash -c "cd packages/brain && npx vitest run tests/time.test.js --no-coverage --reporter=basic"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws1/）

见 `sprints/tests/ws1/time.test.js`，Round 4 覆盖 **8 个功能 it**（IANA 正则 it 改名为 `timezone is a non-empty string`，round-trip it 承担 IANA 权威校验）：

- responds with HTTP 200 and application/json on GET /api/brain/time
- response body has exactly three keys: iso, timezone, unix
- iso is an ISO-8601 UTC millisecond string
- timezone is a non-empty string
- timezone round-trips through Intl.DateTimeFormat without throwing
- unix is an integer within 1 second of current wall clock
- iso and unix represent the same moment within 1 second tolerance
- two consecutive calls spaced 1.1 seconds return different unix values
