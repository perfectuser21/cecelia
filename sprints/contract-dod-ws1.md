# Contract DoD — Workstream 1: GET /api/brain/time 端点 + 路由注册 + 文档同步

**范围**: 新增只读端点 `GET /api/brain/time` 返回 `{iso, timezone, unix}`；在 `packages/brain/server.js` 顶层（零缩进）注册；新增生产侧测试 `packages/brain/tests/time.test.js`（必须 import server.js default export 做真实 supertest，并含 `.expect(200)` 或 body 三字段断言，不仅是裸 `.get(...)`）；同步 `CLAUDE.md` 第 7 节

**大小**: S（<100 行）
**依赖**: 无

**Round 6 变更**（Reviewer Round 5 反馈闭环 — 两个阻塞观察收敛）：
- 观察 1（阻塞）：第 6 条 DoD 文字"对每个匹配行向上最多 5 行扫描"的量化词"每个"含义不明——在 FOR-ALL 解读下会把 server.js 内合法注释 / 数据结构中携带 `'/api/brain/time'` 字面量的行也要求向上 5 行内必有零缩进 `app.use(`，导致合法代码判红。Round 6 **量化词显式化为 EXISTS 语义**：文字改为"**存在至少一行**..."；代码用 `.some()` 替代原 `for(const t of ti){...if(ok)break;}` 的 early-break 循环，让 EXISTS 语义自文档化，彻底消除 FOR-ALL 误读风险
- 观察 2（阻塞）：第 8 条 DoD 组 2 的 token `res.body.iso` / `res.body.timezone` / `res.body.unix` 只是属性访问而非断言——Generator 可以写 `const x = res.body.iso;` 通过 `hasBody` 命中但不真正断言字段，让 Round 5 引入的"行为锁"半废。Round 6 **hasBody 收紧到 `expect(...)` 包装的真实断言形式**，三选一：
  - `expect(xxx.body.iso|timezone|unix)...`（如 `expect(res.body.iso).toBe(...)`）
  - `expect(xxx.body).toHaveProperty('iso'|'timezone'|'unix')`
  - `toMatchObject({...iso/timezone/unix...})`
- 观察 C（非阻塞，不修）：Reviewer 指出 `hasSrv` 允许静态或动态 `import '../server.js'`，若 Generator 把动态 import 藏在 `if (false) { await import('../server.js'); }` 分支内，静态 grep 会命中但运行时不触发——此漏洞已被 DoD 第 11 条 vitest 运行时锁缓解（若 import 未在执行路径触发，supertest 拿不到 app，测试必红，vitest exit 非 0）。Reviewer 明确标记为非阻塞，Round 6 不动
- 观察 D（非阻塞，已落地）：Round 5 对观察 B（双测试文件职责分工）的回应到位，Round 6 不再重复说明

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

- [ ] [ARTIFACT] `/api/brain/time` 挂载点在 server.js **顶层零缩进**（不在 if/try/else/function 块内；Round 6 Reviewer Round 5 观察 1 修复 — **量化词显式化为 EXISTS 语义**：通过条件仅需"**存在至少一行**含 `/api/brain/time` 字面量，且其自身或向上 5 行内有一行以 `^app.use(` 零缩进起始"。代码改用 `.some()` 自文档化，彻底消除"每个匹配行"可能被误读为 FOR-ALL 导致合法注释/数据结构中的字面量判红的风险。支持单行 `app.use('/api/brain/time', timeRoutes)` 和合法多行写法；禁 if/try/else 包裹块内假挂载（包裹缩进使其无法命中零缩进 `app.use(`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');const ls=c.split('\n');const ti=ls.map((l,i)=>({l,i})).filter(x=>/['\"]\/api\/brain\/time(?![A-Za-z0-9_])['\"]/.test(x.l));if(!ti.length)process.exit(1);const ok=ti.some(t=>{for(let j=t.i;j>=Math.max(0,t.i-5);j--){if(/^app\.use\(/.test(ls[j]))return true;}return false;});if(!ok)process.exit(1)"

- [ ] [ARTIFACT] 生产侧测试文件 `packages/brain/tests/time.test.js` 存在
  Test: node -e "require('fs').accessSync('packages/brain/tests/time.test.js')"

- [ ] [ARTIFACT] 生产侧测试 import 真实 route 模块 `../src/routes/time.js`（不能只引 vi.mock 占位）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/tests/time.test.js','utf8');if(!/from\s+['\"]\.\.\/src\/routes\/time\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 生产侧测试 **import `packages/brain/server.js` default export + `from 'supertest'` + `.get('/api/brain/time')` + `.expect(200)` 或 `expect()` 包装的 body 三字段断言** —— Round 6 Reviewer Round 5 观察 2 修复（行为锁彻底闭合）：原 `hasBody` 用 `/\.body\.(iso|timezone|unix)/` 只能识别属性访问，Generator 写 `const x = res.body.iso;` 即可命中而不真正断言。Round 6 收紧到"**必须是 `expect(...)` 包装的真实断言形式**"。满足四层：(a) server.js 被 import（静态或动态），(b) 从 'supertest' import，(c) 出现 `.get('/api/brain/time')` 调用，(d) 出现 `.expect(200)` / `toBe(200)` / `toEqual(200)` 形式的 200 状态码断言，**或** 三选一真实断言：`expect(xxx.body.iso|timezone|unix)...` / `expect(xxx.body).toHaveProperty('iso'|...)` / `toMatchObject({...iso/timezone/unix...})`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/tests/time.test.js','utf8');const hasSrv=/import\s+\w+\s+from\s+['\"]\.\.\/server\.js['\"]/.test(c)||/await\s+import\s*\(\s*['\"]\.\.\/server\.js['\"]\s*\)/.test(c);const hasSt=/from\s+['\"]supertest['\"]/.test(c);const hasGet=/\.get\(\s*['\"]\/api\/brain\/time['\"]/.test(c);const has200=/\.expect\(\s*200\s*\)/.test(c)||/(status|statusCode)\s*\)?\.?\s*(toBe|toEqual)\(\s*200\s*\)/.test(c);const hasBody=/expect\s*\(\s*[\w.]*\.body\.(iso|timezone|unix)/.test(c)||/expect\s*\(\s*[\w.]*\.body\s*\)\s*\.toHaveProperty\s*\(\s*['\"](iso|timezone|unix)/.test(c)||/toMatchObject\s*\(\s*\{[^}]*(iso|timezone|unix)/.test(c);if(!hasSrv||!hasSt||!hasGet||(!has200&&!hasBody))process.exit(1)"

- [ ] [ARTIFACT] `CLAUDE.md` "Brain 知识查询工具" 区块出现字面量 `/api/brain/time`
  Test: node -e "const c=require('fs').readFileSync('.claude/CLAUDE.md','utf8').replace(/\r/g,'');const i=c.indexOf('## 7. Brain 知识查询工具');const j=c.indexOf('\n## ',i+1);const seg=(j>0?c.slice(i,j):c.slice(i));if(!seg.includes('/api/brain/time'))process.exit(1)"

- [ ] [ARTIFACT] **生产侧测试在 vitest 下真实运行通过** —— Round 4 Reviewer 风险 2 闭环锁 × Round 5 配合第 8 条 `.expect(200)`/body 断言强制。运行 `packages/brain/tests/time.test.js`，vitest exit 0 表示"server.js 挂载 + 路由行为 + 字段 schema + 200 状态码/body 三字段"四者在运行时同时满足，不是 grep 字符串能欺骗的静态后门（禁止在 if(false) 块内假挂载、禁止路径笔误、禁止 import 但未注册、禁止裸 `.get()` 不 assert）
  Test: bash -c "cd packages/brain && npx vitest run tests/time.test.js --no-coverage --reporter=basic"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws1/）

见 `sprints/tests/ws1/time.test.js`，Round 4 / Round 5 覆盖 **8 个功能 it**（sprint 侧不变，Round 5 修订仅发生在 DoD 第 6 / 8 条）：

- responds with HTTP 200 and application/json on GET /api/brain/time
- response body has exactly three keys: iso, timezone, unix
- iso is an ISO-8601 UTC millisecond string
- timezone is a non-empty string
- timezone round-trips through Intl.DateTimeFormat without throwing
- unix is an integer within 1 second of current wall clock
- iso and unix represent the same moment within 1 second tolerance
- two consecutive calls spaced 1.1 seconds return different unix values
