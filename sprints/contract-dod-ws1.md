# Contract DoD — Workstream 1: GET /api/brain/time 端点 + 路由注册 + 文档同步

**范围**: 新增只读端点 `GET /api/brain/time` 返回 `{iso, timezone, unix}`；在 `packages/brain/server.js` 顶层（零缩进）注册；新增生产侧测试 `packages/brain/tests/time.test.js`（必须以 `<ST_NAME>(<SRV_NAME>).get('/api/brain/time').expect(200)` **单一链式表达式**形态调用 supertest，其中 `<SRV_NAME>` 是 `../server.js` 默认导出变量名、`<ST_NAME>` 是 `supertest` 默认导出变量名）；同步 `CLAUDE.md` 第 7 节

**大小**: S（<100 行）
**依赖**: 无

**Round 9 变更**（Reviewer Round 8 反馈闭环 — 采纳"(c)(d)(e) 强制同链"）：
- 风险 1（阻塞）：Round 8 把 DoD 第 8 条拆成 (a) 静态 import server.js 捕获变量名 / (b) import supertest 捕获变量名 / (c) `<ST>(<SRV>)` 调用 / (d) `.get('/api/brain/time')` 出现 / (e) `.expect(200)`/`toBe(200)`/`toEqual(200)` 任一出现 **五条独立检查**。Reviewer Round 8 指出关键漏洞：**(c)(d)(e) 独立存在 ≠ 同一链式调用**。Generator 仍可绕开 —— 例如写 `supertest(server).get('/health')` 让 (c)(d) 命中（注意 (d) 只要求 `.get('/api/brain/time')` 出现，上例不命中，但 Generator 可另写 `supertest(fakeApp).get('/api/brain/time').expect(200)` 让 (d)(e) 命中同时保留 (c) `supertest(server)` 在他处），并在别处写 `expect(res.status).toBe(200)` 让 (e) 命中，从而 **200 断言并未挂在 time 端点的真实响应上**。Round 9 采纳 Reviewer 明确修复建议：**(c)(d)(e) 强制作为单一链式表达式存在** —— 必须出现 `<ST_NAME>(<SRV_NAME>).get('/api/brain/time').expect(200)` 这一**单一链式表达式**（允许中间链接 `.set()`/`.send()`/`.query()` 等），且 `.expect(200)` 必须在 `.get('/api/brain/time')` **之后**。Test 从"独立 3 个 substring 检查"升级为"链路游走器"（walker）：锚定 `<ST>(<SRV>)` 起点，沿 `.<method>(<balanced-parens>)` 走链，要求链中依序命中 `.get('/api/brain/time')` 与 `.expect(200)`，链条被 `;`/换行后新语句/赋值打断即视为链断裂。**路径 1 同时收益**：一旦要求 `<ST>(<SRV>)` 与 `.get('/api/brain/time')` 必须在同一链路，Round 7 残留的"import 存在 ≠ 被 supertest 使用"后门彻底关闭
- 观察 E（非阻塞，supertest 回调式断言）：Reviewer Round 8 指出 `.expect(status => status === 200)` / `.expect(res => assert.equal(res.status, 200))` 是 supertest 官方支持的 200 等价断言，不在硬门白名单内。本轮**不纳入**（保持硬门最窄：只接受字面量 `.expect(200)`）—— Generator 可以直接写 `.expect(200)`，无需回调式。回调式解析复杂（需 AST 解析 `res.status === 200` 之类表达式），超出合同守门职责
- Round 8 采纳路径 2 的"200 状态码硬门"立场沿用，但 `.expect(200)` 的位置从"文件内任一处出现"收紧到"在上述单一链式表达式中出现"。`toBe(200)` / `toEqual(200)` 旁路**关闭**（无法确证挂在 time 端点的响应上）
- 观察 D（非阻塞，Node ICU 版本差异）：Reviewer 继续保留 Round 6 的非阻塞立场，Round 9 不动

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

- [ ] [ARTIFACT] 生产侧测试以 `<ST_NAME>(<SRV_NAME>).get('/api/brain/time').expect(200)` **单一链式表达式**形态真实发起 supertest 请求 —— Round 9 Reviewer Round 8 反馈采纳"(c)(d)(e) 强制同链"：
  - **(a)/(b) 入参捕获（沿袭 Round 7/8 不变）**：先捕获 `import <SRV_NAME> from '../server.js'` 的变量名（**仅静态 import**，禁动态 import —— Round 6 观察 C 的规避通道"动态 import 藏在 if(false) 死分支"关闭），再捕获 `import <ST_NAME> from 'supertest'` 的变量名
  - **(c)(d)(e) 链路游走器（Round 9 新增 — 核心收紧）**：脚本以 `<ST_NAME>(<SRV_NAME>)` 为锚点，沿 `.<method>(<balanced-parens>)` 游走链路（每个 method 必须紧跟 `(` 并收到匹配 `)`）：
    - 链中必须**依序**出现 `.get('/api/brain/time')`（URL 字面量精确）
    - **且之后**出现 `.expect(200)`（200 整数字面量精确）
    - 允许中间穿插任意 supertest 链接方法（`.set(...)` / `.send(...)` / `.query(...)` / `.expect('Content-Type', /json/)` 等）
    - 链条遇到非 `.` 字符即断裂（如 `;` / 赋值 `=` / 新语句起首）—— 游走器 break
  - **为何同链**：Reviewer Round 8 指出 Round 8 的"(c)(d)(e) 独立 substring 检查"存在漏洞 —— `supertest(server).get('/health')` 与 `supertest(fakeApp).get('/api/brain/time').expect(200)` 与 `expect(res.status).toBe(200)` 可分散在三处，三条独立检查均命中但 **200 断言并未挂在 time 端点响应上**。强制同链后，Generator 必须让 supertest 真以 server.js 导出的 app 为入参，真发起对 `/api/brain/time` 的 GET，真断言 200。若 server.js 未真注册路由，运行时必然 404 → `.expect(200)` 抛错 → DoD 第 11 条 vitest 运行时锁见真红
  - **（旁路关闭）**：Round 8 允许的 `toBe(200)` / `toEqual(200)` 替代路径**已关闭** —— 这两种断言即便出现也无法证明挂在 time 端点的响应上。硬门仅接受链上字面量 `.expect(200)`
  - **（非阻塞观察 E 不纳入）**：supertest 回调式断言 `.expect(status => status === 200)` / `.expect(res => assert.equal(res.status, 200))` 虽是 200 等价断言，但需 AST 级解析才能确证，本轮不纳入硬门。Generator 直接写 `.expect(200)` 即可
  - 总计满足五层（Round 9 同链化）：(a) 静态 import server.js 并捕获变量名，(b) import supertest 并捕获变量名，**(c)(d)(e) 以单一链式表达式 `<ST_NAME>(<SRV_NAME>).get('/api/brain/time').expect(200)` 形态出现在测试文件中**
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/tests/time.test.js','utf8');const sM=c.match(/import\s+(\w+)\s+from\s+['\"]\.\.\/server\.js['\"]/);if(!sM)process.exit(1);const s=sM[1];const tM=c.match(/import\s+(\w+)\s+from\s+['\"]supertest['\"]/);if(!tM)process.exit(1);const t=tM[1];const re=new RegExp('\\\\b'+t+'\\\\s*\\\\(\\\\s*'+s+'\\\\s*\\\\)','g');let m,ok=false;while((m=re.exec(c))&&!ok){let p=m.index+m[0].length,G=false,E=false;while(true){while(p<c.length&&/\s/.test(c[p]))p++;if(c[p]!=='.')break;p++;const nm=/^\w+/.exec(c.slice(p));if(!nm)break;const name=nm[0];p+=name.length;while(p<c.length&&/\s/.test(c[p]))p++;if(c[p]!=='(')break;let d=1,st=p;p++;while(p<c.length&&d>0){if(c[p]==='(')d++;else if(c[p]===')')d--;p++;}if(d!==0)break;const a=c.slice(st+1,p-1);if(name==='get'&&/^\s*['\"]\/api\/brain\/time['\"]\s*$/.test(a))G=true;if(name==='expect'&&/^\s*200\s*$/.test(a)&&G)E=true;}if(G&&E)ok=true;}if(!ok)process.exit(1)"

- [ ] [ARTIFACT] `CLAUDE.md` "Brain 知识查询工具" 区块出现字面量 `/api/brain/time`
  Test: node -e "const c=require('fs').readFileSync('.claude/CLAUDE.md','utf8').replace(/\r/g,'');const i=c.indexOf('## 7. Brain 知识查询工具');const j=c.indexOf('\n## ',i+1);const seg=(j>0?c.slice(i,j):c.slice(i));if(!seg.includes('/api/brain/time'))process.exit(1)"

- [ ] [ARTIFACT] **生产侧测试在 vitest 下真实运行通过** —— Round 4 Reviewer 风险 2 闭环锁 × Round 9 配合第 8 条"同链 `.expect(200)`"强制。运行 `packages/brain/tests/time.test.js`，vitest exit 0 表示"server.js 挂载 + 路由行为 + 链上 `.expect(200)` 真实断言通过"三者在运行时同时满足，不是 grep 字符串能欺骗的静态后门（禁止在 if(false) 块内假挂载、禁止路径笔误、禁止 import 但未注册、禁止 import 但另起 fake express、禁止链外 `toBe(200)` 伪装）
  Test: bash -c "cd packages/brain && npx vitest run tests/time.test.js --no-coverage --reporter=basic"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws1/）

见 `sprints/tests/ws1/time.test.js`，Round 4 / 5 覆盖 **8 个功能 it**（sprint 侧自 Round 4 起不变，Round 9 修订仅发生在 DoD 第 8 条的同链化）：

- responds with HTTP 200 and application/json on GET /api/brain/time
- response body has exactly three keys: iso, timezone, unix
- iso is an ISO-8601 UTC millisecond string
- timezone is a non-empty string
- timezone round-trips through Intl.DateTimeFormat without throwing
- unix is an integer within 1 second of current wall clock
- iso and unix represent the same moment within 1 second tolerance
- two consecutive calls spaced 1.1 seconds return different unix values
