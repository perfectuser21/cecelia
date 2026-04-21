# Contract DoD — Workstream 1: GET /api/brain/time 端点 + 路由注册 + 文档同步

**范围**: 新增只读端点 `GET /api/brain/time` 返回 `{iso, timezone, unix}`；在 `packages/brain/server.js` 顶层（零缩进）注册；新增生产侧测试 `packages/brain/tests/time.test.js`（必须 import server.js default export 做真实 supertest，并含 `.expect(200)` 或 body 三字段断言，不仅是裸 `.get(...)`）；同步 `CLAUDE.md` 第 7 节

**大小**: S（<100 行）
**依赖**: 无

**Round 5 变更**（Reviewer Round 4 反馈闭环）：
- 风险 1（阻塞）：第 6 条 DoD 把"零缩进顶层"和"路径字面量 `/api/brain/time`"压在同一正则 → 合法多行写法
  ```js
  app.use(
    '/api/brain/time',
    timeRoutes
  );
  ```
  被误杀。Round 5 拆分为两段语义检查：先在文件内定位所有含 `/api/brain/time` 字面量的行，再对每个匹配行向上最多 5 行扫描，要求存在一行以 `^app.use(` **零缩进**起始——既支持单行写法，也支持合法多行写法
- 风险 2（阻塞）：第 8 条 DoD 只要求 `.get('/api/brain/time')` 调用出现在测试字符串中，Generator 可写一个只调不 assert 的 supertest，即便 GET 返回 500/404 也不会让 vitest 红；第 11 条 vitest 运行时锁因此只能看到"测试跑完没抛"而非"行为正确"。Round 5 第 8 条 DoD 追加强制：必须含 `.expect(200)` **或** 对 `res.body.iso/timezone/unix` 的断言，才能让第 11 条运行时锁真正闭环到"响应正确"
- 观察 A（与风险 2 合并修复）：追加 `.expect(200)` 要求 + body 三字段断言任一，使 Generator 无法用裸 `.get()` 规避运行时行为锁
- 观察 B（非阻塞，显式说明）：`sprints/tests/ws1/time.test.js`（BEHAVIOR 覆盖，私有 express，sprint vitest config）与 `packages/brain/tests/time.test.js`（入口可达双层锁，import server.js default export，brain 包 vitest config）职责不同，Generator 不得尝试合并——见合同 Generator commit 2 职责第 3 点

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

- [ ] [ARTIFACT] `/api/brain/time` 挂载点在 server.js **顶层零缩进**（不在 if/try/else/function 块内；Round 5 Reviewer 风险 1 修复 — 拆分"定位字面量行"与"向上扫描零缩进 `app.use(` 起始"两步，支持单行 `app.use('/api/brain/time', timeRoutes)` 和合法多行写法）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');const ls=c.split('\n');const ti=ls.map((l,i)=>({l,i})).filter(x=>/['\"]\/api\/brain\/time(?![A-Za-z0-9_])['\"]/.test(x.l));if(!ti.length)process.exit(1);let ok=false;for(const t of ti){for(let j=t.i;j>=Math.max(0,t.i-5);j--){if(/^app\.use\(/.test(ls[j])){ok=true;break;}}if(ok)break;}if(!ok)process.exit(1)"

- [ ] [ARTIFACT] 生产侧测试文件 `packages/brain/tests/time.test.js` 存在
  Test: node -e "require('fs').accessSync('packages/brain/tests/time.test.js')"

- [ ] [ARTIFACT] 生产侧测试 import 真实 route 模块 `../src/routes/time.js`（不能只引 vi.mock 占位）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/tests/time.test.js','utf8');if(!/from\s+['\"]\.\.\/src\/routes\/time\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 生产侧测试 **import `packages/brain/server.js` default export + `from 'supertest'` + `.get('/api/brain/time')` + `.expect(200)` 或 body 三字段断言** —— Round 5 Reviewer 风险 2 修复：追加强制运行时行为锁，Generator 无法用裸 `.get()` 规避。满足四层：(a) server.js 被 import（静态或动态），(b) 从 'supertest' import，(c) 出现 `.get('/api/brain/time')` 调用，(d) 出现 `.expect(200)` 或 `toBe(200)` 形式的 200 状态码断言，**或** 出现对 `res.body.iso` / `res.body.timezone` / `res.body.unix` / `toMatchObject({...iso...})` 任一 body 三字段断言
  Test: node -e "const c=require('fs').readFileSync('packages/brain/tests/time.test.js','utf8');const hasSrv=/import\s+\w+\s+from\s+['\"]\.\.\/server\.js['\"]/.test(c)||/await\s+import\s*\(\s*['\"]\.\.\/server\.js['\"]\s*\)/.test(c);const hasSt=/from\s+['\"]supertest['\"]/.test(c);const hasGet=/\.get\(\s*['\"]\/api\/brain\/time['\"]/.test(c);const has200=/\.expect\(\s*200\s*\)/.test(c)||/(status|statusCode)\s*\)?\.?\s*(toBe|toEqual)\(\s*200\s*\)/.test(c);const hasBody=/\.body\.(iso|timezone|unix)/.test(c)||/toMatchObject\s*\(\s*\{[^}]*(iso|timezone|unix)/.test(c);if(!hasSrv||!hasSt||!hasGet||(!has200&&!hasBody))process.exit(1)"

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
