# Contract DoD — Workstream 1: GET /api/brain/time 端点 + 路由注册 + 文档同步

**范围**: 新增只读端点 `GET /api/brain/time` 返回 `{iso, timezone, unix}`；在 `packages/brain/server.js` 顶层（零缩进）注册；新增生产侧测试 `packages/brain/tests/time.test.js`（必须 import server.js default export 做真实 supertest，**且必须含 `.expect(200)` 硬性断言**，body 断言作为可选增强）；同步 `CLAUDE.md` 第 7 节

**大小**: S（<100 行）
**依赖**: 无

**Round 8 变更**（Reviewer Round 7 反馈闭环 — 采纳"路径 2：强制附加 `.expect(200)`"）：
- 风险 1（阻塞）：Round 7 把 body 断言收紧到 matcher 白名单（`.toBe` / `.toEqual` / `.toMatch` / `.toMatchObject` / `.toContain` / `.toHaveProperty` / `.toStrictEqual` / 比较 matcher / `.toBeDefined` 等），但 Reviewer 指出两点仍有问题：(i) 值比较 matcher 本身也能写出无意义断言（如 `toMatch(/./)`）；(ii) `.toBeDefined` / `.toBeTruthy` / `.toBeFalsy` / `.toBeNull` 与裸 expect 语义距离过近，`.not.` 前缀（如 `.not.toBeNull()`）等价于 `toBeDefined`。继续挑 body matcher 白名单会越描越细。Round 8 **采纳 Reviewer 明确建议的路径 2**：把 DoD 第 8 条 (e) 从"200 断言 **或** body 断言"改为"`.expect(200)` / `toBe(200)` / `toEqual(200)` **硬性必须**"，body 断言降级为**可选增强**（不再参与通过判定）。理由：**"响应 200"比"body 字段有值"更贴近入口可达性验证的语义** —— 只要真实发起的 HTTP 请求必须返回 200，即便 Generator 再试图写假 body 断言也无法伪装"server.js 真注册 + supertest 真 200"；sprint 侧 `sprints/tests/ws1/time.test.js` 8 个 it 本来就覆盖了 body 三字段的 schema 与 round-trip 行为锁，brain 包生产侧测试无需再重复
- 观察 D（非阻塞，Node ICU 版本差异）：Reviewer 继续保留 Round 6 的非阻塞立场，Round 8 不动。多数 CI/dev 环境用 full-icu；若后续出现 round-trip flaky 再显式声明 Node ICU 版本要求

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

- [ ] [ARTIFACT] 生产侧测试 **静态 import `packages/brain/server.js` default export 并用作 supertest 入参 + `from 'supertest'` + `.get('/api/brain/time')` + `.expect(200)` 硬性必须** —— Round 8 Reviewer Round 7 反馈采纳"路径 2"：
  - **(a)/(b)/(c)/(d) 入参锁（沿袭 Round 7 不变）**：先捕获 `import <SRV_NAME> from '../server.js'` 的变量名（**仅静态 import**，禁动态 import —— Round 6 观察 C 的规避通道"动态 import 藏在 if(false) 死分支"关闭），再捕获 `import <ST_NAME> from 'supertest'` 的变量名，强制出现 `<ST_NAME>(<SRV_NAME>)` 调用（supertest 真用 server.js 导入的 app），并出现 `.get('/api/brain/time')`。若 server.js 未真正注册路由，运行时必然 404 → DoD 第 11 条 vitest 运行时锁见真红
  - **(e) 行为锁（Round 8 采纳路径 2：`.expect(200)` 硬性必须）**：测试内必须出现 `.expect(200)` / `toBe(200)` / `toEqual(200)` 任一 200 状态码断言。理由：Reviewer 明确指出"响应 200"比"body 字段有值"更贴近入口可达性验证的语义 —— 只要 HTTP 请求必须返回 200，即便 Generator 试图写假 body 断言也无法伪装"server.js 真注册 + supertest 真 200"。body 三字段的 schema 与 round-trip 行为验证由 `sprints/tests/ws1/time.test.js` 8 个 it 独立覆盖，此处不重复
  - **body 断言降级为可选增强**（不再参与通过判定）：Round 7 的 matcher 白名单思路被 Reviewer 否决 —— (i) 值比较 matcher 本身也能写 `toMatch(/./)` 这类无意义断言；(ii) `.toBeDefined` / `.toBeTruthy` / `.toBeFalsy` / `.toBeNull` 与裸 expect 语义距离过近，`.not.` 前缀（如 `.not.toBeNull()`）等价于 `toBeDefined` 同一等价类。既然 200 硬门已经锁住入口可达性，body matcher 白名单无需再折腾
  - 总计满足五层：(a) 静态 import server.js 并捕获变量名，(b) import supertest 并捕获变量名，(c) `<ST_NAME>(<SRV_NAME>)` 调用，(d) `.get('/api/brain/time')` 调用，(e) **`.expect(200)` / `toBe(200)` / `toEqual(200)` 任一必须出现**
  Test: node -e "const c=require('fs').readFileSync('packages/brain/tests/time.test.js','utf8');const srvM=c.match(/import\s+(\w+)\s+from\s+['\"]\.\.\/server\.js['\"]/);if(!srvM)process.exit(1);const srv=srvM[1];const stM=c.match(/import\s+(\w+)\s+from\s+['\"]supertest['\"]/);if(!stM)process.exit(1);const st=stM[1];const usesSrv=new RegExp('\\\\b'+st+'\\\\s*\\\\(\\\\s*'+srv+'\\\\s*\\\\)').test(c);if(!usesSrv)process.exit(1);const hasGet=/\.get\(\s*['\"]\/api\/brain\/time['\"]/.test(c);if(!hasGet)process.exit(1);const has200=/\.expect\(\s*200\s*\)/.test(c)||/(status|statusCode)\s*\)?\.?\s*(toBe|toEqual)\(\s*200\s*\)/.test(c);if(!has200)process.exit(1)"

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
