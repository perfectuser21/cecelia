# Contract DoD — Workstream 1: GET /api/brain/time 端点 + 路由注册 + 文档同步

**范围**: 新增只读端点 `GET /api/brain/time` 返回 `{iso, timezone, unix}`；在 `packages/brain/server.js` 顶层（零缩进）注册；新增生产侧测试 `packages/brain/tests/time.test.js`（必须 import server.js default export 做真实 supertest，并含 `.expect(200)` 或 body 三字段断言，不仅是裸 `.get(...)`）；同步 `CLAUDE.md` 第 7 节

**大小**: S（<100 行）
**依赖**: 无

**Round 7 变更**（Reviewer Round 6 反馈闭环 — 两个阻塞风险收敛）：
- 风险 1（阻塞）：Round 6 新增的 `hasBody` variant (i) `/expect\s*\(\s*[\w.]*\.body\.(iso|timezone|unix)/` 只要 `expect(res.body.iso)` 开头即命中，不要求 `.toBe(...)` 等 matcher 后缀 → Generator 写 `expect(res.body.iso);` 裸 expect 即可通过行为锁而不做任何断言。Round 7 **variant (i) 末尾强制 matcher 白名单**：`)` 闭合 expect 后必须接 `.` + matcher 名（`toBe` / `toEqual` / `toMatch` / `toMatchObject` / `toContain` / `toHaveProperty` / `toStrictEqual` / `toBeGreaterThan(OrEqual)?` / `toBeLessThan(OrEqual)?` / `toBeCloseTo` / `toBeDefined` / `toBeTruthy` / `toBeFalsy` / `toBeNull` / `toBeInstanceOf` 等），允许 `.not.` 链式前缀，末尾必须 `(` 触发调用。裸 expect 再无逃逸通道
- 风险 2（阻塞，Round 4 遗留未闭）：`hasSrv` 只验"import 语句存在"，Generator 可以 `import app from '../server.js'` 却在测试内 `const a = express(); request(a)` 自建 app 绕开 server.js —— `server.js` 中是否真的写了 `app.use('/api/brain/time', timeRoutes)` 对 supertest 测试结果毫无影响。Round 7 **强制 supertest 以 server.js 导入的变量为入参**：先捕获 `import <SRV_NAME> from '../server.js'` 的 name（**仅静态 import**，顺便关闭 Round 6 观察 C —— 动态 import 藏在 `if(false)` 死分支的规避通道一并关死），再捕获 `import <ST_NAME> from 'supertest'` 的 name，最后校验 `<ST_NAME>(<SRV_NAME>)` 形态必须出现。这样若 server.js 未真正注册路由，运行时必然 404，DoD 第 11 条 vitest 运行时锁会看到真红
- 观察 D（非阻塞，Node ICU 版本差异）：Reviewer 指出 `Intl.DateTimeFormat` 对 `CET`/`Etc/GMT+0` 在 small-icu 与 full-icu Node 下行为可能不完全一致。Round 7 不修（多数 CI/dev 环境用 full-icu；若后续出现 round-trip flaky 再显式声明 Node ICU 要求）

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

- [ ] [ARTIFACT] 生产侧测试 **静态 import `packages/brain/server.js` default export 并用作 supertest 入参 + `from 'supertest'` + `.get('/api/brain/time')` + `.expect(200)` 或带 matcher 的 body 三字段断言** —— Round 7 Reviewer Round 6 风险 1 / 2 双修复：
  - **风险 2（Round 4 遗留未闭）修复 — supertest 真的用 server.js 的 app**：过去 `hasSrv` 只要求 "import 语句存在"，Generator 可以 `import app from '../server.js'` 后再 `const a = express(); request(a)` 私自绕开 server.js 的 app，使 `app.use('/api/brain/time', timeRoutes)` 这行即便不存在也能通过 supertest 测试。Round 7 收紧：先捕获 `import <SRV_NAME> from '../server.js'` 的变量名（**仅静态 import**，禁动态 import — Round 6 观察 C 的规避通道"动态 import 藏在 if(false) 死分支"同步关闭），再捕获 `import <ST_NAME> from 'supertest'` 的变量名，最后强制出现 `<ST_NAME>(<SRV_NAME>)` 调用（即 supertest 必须以 server.js import 来的 app 为入参）。这样若 server.js 未真正注册路由，DoD 第 11 条 vitest 运行时会 404 红到底
  - **风险 1（Round 6 新洞）修复 — body 断言必须带 matcher**：Round 6 variant (i) `/expect\s*\(\s*[\w.]*\.body\.(iso|timezone|unix)/` 只要 `expect(res.body.iso)` 开头即命中，不要求 `.toBe(...)` 等 matcher 后缀 → Generator 写 `expect(res.body.iso);` 裸 expect 也能通过。Round 7 收紧：variant (i) 末尾强制 `)` 闭合 expect，再接 `.` + **matcher 名白名单**（`toBe` / `toEqual` / `toMatch` / `toMatchObject` / `toContain` / `toHaveProperty` / `toStrictEqual` / `toBeGreaterThan(OrEqual)?` / `toBeLessThan(OrEqual)?` / `toBeCloseTo` / `toBeDefined` / `toBeTruthy` / `toBeFalsy` / `toBeNull` / `toBeInstanceOf`），允许 `.not.` 链式前缀，末尾要 `(` 触发调用
  - 总计满足五层：(a) **静态** import server.js default export 并捕获变量名，(b) import supertest 并捕获变量名，(c) 存在 `<ST_NAME>(<SRV_NAME>)` 调用（supertest 真用 server.js 的 app），(d) 存在 `.get('/api/brain/time')` 调用，(e) 存在 `.expect(200)` / `toBe(200)` / `toEqual(200)` **或** 三选一带 matcher 的真实 body 断言：`expect(xxx.body.iso|timezone|unix).toXxx(...)` / `expect(xxx.body).toHaveProperty('iso'|...)` / `toMatchObject({...iso/timezone/unix...})`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/tests/time.test.js','utf8');const srvM=c.match(/import\s+(\w+)\s+from\s+['\"]\.\.\/server\.js['\"]/);if(!srvM)process.exit(1);const srv=srvM[1];const stM=c.match(/import\s+(\w+)\s+from\s+['\"]supertest['\"]/);if(!stM)process.exit(1);const st=stM[1];const usesSrv=new RegExp('\\\\b'+st+'\\\\s*\\\\(\\\\s*'+srv+'\\\\s*\\\\)').test(c);if(!usesSrv)process.exit(1);const hasGet=/\.get\(\s*['\"]\/api\/brain\/time['\"]/.test(c);if(!hasGet)process.exit(1);const has200=/\.expect\(\s*200\s*\)/.test(c)||/(status|statusCode)\s*\)?\.?\s*(toBe|toEqual)\(\s*200\s*\)/.test(c);const MATCHERS='(?:toBe|toEqual|toMatch|toMatchObject|toContain|toHaveProperty|toStrictEqual|toBeGreaterThan|toBeLessThan|toBeGreaterThanOrEqual|toBeLessThanOrEqual|toBeCloseTo|toBeDefined|toBeUndefined|toBeTruthy|toBeFalsy|toBeNull|toBeNaN|toBeInstanceOf)';const hasBodyExpect=new RegExp('expect\\\\s*\\\\(\\\\s*[\\\\w.]*\\\\.body\\\\.(iso|timezone|unix)\\\\s*\\\\)\\\\s*\\\\.\\\\s*(not\\\\s*\\\\.\\\\s*)?'+MATCHERS+'\\\\s*\\\\(').test(c);const hasProp=/expect\s*\(\s*[\w.]*\.body\s*\)\s*\.\s*(not\s*\.\s*)?toHaveProperty\s*\(\s*['\"](iso|timezone|unix)/.test(c);const hasMO=/toMatchObject\s*\(\s*\{[^}]*(iso|timezone|unix)/.test(c);const hasBody=hasBodyExpect||hasProp||hasMO;if(!has200&&!hasBody)process.exit(1)"

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
