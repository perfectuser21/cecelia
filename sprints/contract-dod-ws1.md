# Contract DoD — Workstream 1: Brain /api/brain/time 只读时间端点

**范围**: 新增 Express Router + 在 `packages/brain/server.js` 挂载（含命名导出 `app` + VITEST 护栏最小重构） + 新增单测 + 更新 `docs/current/README.md`。
**大小**: S（总新增 < 100 行 + server.js 最小重构）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/time.js` 文件存在
  Test: node -e "require('fs').accessSync('packages/brain/src/routes/time.js')"

- [ ] [ARTIFACT] `packages/brain/src/routes/time.js` 使用 `express.Router` 并 default export 一个 Router 实例
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/from\s+['\"]express['\"]/.test(c))process.exit(1);if(!/Router\s*\(\s*\)/.test(c))process.exit(2);if(!/export\s+default\s+\w+/.test(c))process.exit(3)"

- [ ] [ARTIFACT] `packages/brain/src/routes/time.js` 注册 `GET /` 路径（与 `/api/brain/time` 前缀组合后即 `/api/brain/time`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/router\.get\s*\(\s*['\"]\/['\"]\s*,/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/routes/time.js` 含 `toISOString` / `getTime` / `resolvedOptions` 三个调用，构成"单一快照"实现的源代码线索（实现锁，非缺陷检测；真正兜住语义的是 BEHAVIOR it#7 + R5 新增 ARTIFACT #13）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!c.includes('toISOString'))process.exit(2);if(!/getTime\s*\(\s*\)/.test(c))process.exit(3);if(!/resolvedOptions\s*\(\s*\)/.test(c))process.exit(4)"

- [ ] [ARTIFACT] `packages/brain/server.js` 含名为 `timeRoutes` 的 ESM import，指向 `./src/routes/time.js`（强制变量名消歧，避免挂载/import 变量错位）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/import\s+timeRoutes\s+from\s+['\"]\.\/src\/routes\/time\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 将 `timeRoutes` 挂载到精确路径 `/api/brain/time`（与 import 同名，杜绝错挂）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/app\.use\s*\(\s*['\"]\/api\/brain\/time['\"]\s*,\s*timeRoutes\s*\)/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 单元测试文件 `packages/brain/src/__tests__/routes-time.test.js` 存在
  Test: node -e "require('fs').accessSync('packages/brain/src/__tests__/routes-time.test.js')"

- [ ] [ARTIFACT] 单元测试文件含至少 4 个 `it(` 断言块（覆盖 200 / 三字段存在 / 字段类型 / 三字段同时刻）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/routes-time.test.js','utf8');const n=(c.match(/\bit\s*\(/g)||[]).length;if(n<4)process.exit(n||1)"

- [ ] [ARTIFACT] 单元测试文件使用 `supertest` 发 `GET /api/brain/time`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/routes-time.test.js','utf8');if(!/supertest/.test(c))process.exit(1);if(!/['\"]\/api\/brain\/time['\"]/.test(c))process.exit(2)"

- [ ] [ARTIFACT] `docs/current/README.md` 含 `/api/brain/time` 端点文档条目，并在同一文件中含 `iso`、`timezone`、`unix` 三个字段名
  Test: node -e "const c=require('fs').readFileSync('docs/current/README.md','utf8');if(!c.includes('/api/brain/time'))process.exit(1);if(!/\biso\b/.test(c))process.exit(2);if(!/\btimezone\b/.test(c))process.exit(3);if(!/\bunix\b/.test(c))process.exit(4)"

- [ ] [ARTIFACT] `packages/brain/server.js` 以命名导出形式暴露 `app`（允许 `export const app = express()` 或等价的 `export { app }` / `export { app as app }`，可与既有 `export default app;` 共存）——供 BEHAVIOR it#11 动态导入真实 Brain app（R4 新增，闭合 PRD US-001 / SC-002 的"跑起来的 Brain"语义）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');const p1=/export\s+const\s+app\s*=/;const p2=/export\s*\{[^}]*\bapp\b[^}]*\}/;if(!p1.test(c)&&!p2.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 将 DB / WS / 外部端口副作用的顶层 `await` 链收进 `process.env.VITEST` 护栏（R4 新增，使 `VITEST=true` 下 `import { app }` 不连 DB、不开端口）——护栏以字面量 `process.env.VITEST` 作为判定锚点，且至少护住 `runMigrations` + `listenWithRetry` 两个关键锚点（这两个是最容易在测试环境炸的；其他等价副作用函数通过 BEHAVIOR it#11 动态 import 的真实副作用链兜底）
  Test: bash -c "node -e \"const c=require('fs').readFileSync('packages/brain/server.js','utf8');const hasGuard=/process\.env\.VITEST/.test(c);if(!hasGuard)process.exit(1);const lines=c.split(/\r?\n/);const vitestLineIdx=lines.findIndex(l=>/process\.env\.VITEST/.test(l));if(vitestLineIdx<0)process.exit(2);const afterVitest=lines.slice(vitestLineIdx).join('\n');if(!/runMigrations\s*\(/.test(afterVitest))process.exit(3);if(!/listenWithRetry\s*\(/.test(afterVitest))process.exit(4)\""

- [ ] [ARTIFACT] `packages/brain/src/routes/time.js` 源码（行注释 `// …` + 块注释 `/* … */` 剥离后）中：无参 `new Date()` 字面量恰好 1 次；`Date.now(` 字面量 0 次。此条把 FR-003「三字段同一 Date 快照」从行为层概率断言升级为**静态 deterministic 硬锁**——反模式「分别 `new Date()` / 分别 `Date.now()` 取时间再拼装」被源码层直接挡住，不再依赖 CI run 偶然碰到跨秒边界（**R5 新增 #13**）
  Test: node -e "const raw=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');const stripped=raw.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'');const nd=(stripped.match(/\bnew\s+Date\s*\(\s*\)/g)||[]).length;if(nd!==1)process.exit(10+nd);const dn=(stripped.match(/\bDate\s*\.\s*now\s*\(/g)||[]).length;if(dn!==0)process.exit(20+dn)"

- [ ] [ARTIFACT] Brain workspace 单测文件 `packages/brain/src/__tests__/routes-time.test.js` 必须**实际跑通**且**至少 4 个断言通过**——以 vitest **JSON reporter**（Jest-compatible schema）解析，deterministic，**不依赖控制台文本匹配**：从仓库根执行 `cd packages/brain && npx vitest run src/__tests__/routes-time.test.js --reporter=json --outputFile=/tmp/brain-routes-time-r7.json`，exit code 为 0；再用 `node` 解析 `/tmp/brain-routes-time-r7.json`，要求 `success === true` 且 `Number.isInteger(numPassedTests)` 且 `numPassedTests >= 4` 且 `numFailedTests === 0`。与 R6 相比改用官方 JSON reporter schema（本地已验证输出含 `success / numPassedTests / numFailedTests / numTotalTests / testResults`）替代原先的 `grep -oE 'Tests  X passed'` 控制台字符串匹配——对 vitest 版本升级/输出格式改动免疫。此条把 SC-001（`npm test` 在 Brain workspace 通过 + 专门覆盖 /api/brain/time 的 test 文件）从"静态文件形态"升级为"实跑过"——与 ARTIFACT #7（文件存在）/ #8（≥ 4 个 `it(` 块）/ #9（使用 supertest）形成四通道闭环，挡下 `it.skip` / 空 body `it('x', () => {})` / 未真连 `src/routes/time.js` 的桩测试等反模式（**R7 改写 #14**，替换 R6 脆弱字符串匹配）
  Test: bash -c "cd packages/brain && npx vitest run src/__tests__/routes-time.test.js --reporter=json --outputFile=/tmp/brain-routes-time-r7.json 2>&1 | tail -n 20; ec=\${PIPESTATUS[0]}; if [ \$ec -ne 0 ]; then exit \$ec; fi; node -e \"const r=JSON.parse(require('fs').readFileSync('/tmp/brain-routes-time-r7.json','utf8'));if(r.success!==true)process.exit(50);if(!Number.isInteger(r.numPassedTests))process.exit(51);if(r.numPassedTests<4)process.exit(52);if(r.numFailedTests!==0)process.exit(53)\""

- [ ] [ARTIFACT] Brain workspace 单测文件 `packages/brain/src/__tests__/routes-time.test.js` 内容必须满足**行为锚点四件套**——把 ARTIFACT #14「实跑 + 通过 ≥4」从"能跑"升级为"跑且真的测到行为"，彻底挡下 Generator 用 4 个桩测试（如 `it('x', () => expect(1).toBe(1))`）凑数通过 #14 的反模式： (a) 至少一处 HTTP 200 状态码断言（源码含 `.toBe(200)` 字面量）；(b) 三字段名 `iso` / `timezone` / `unix` 各自以字面量形态出现 **≥ 2 次**（保证既在字段访问如 `res.body.iso` 里，又在其他断言/期望里出现）；(c) iso↔unix 同秒相等的算术断言在测试源码中出现——必须同时含 `Math.floor(…Date.parse…)` 字面量组合 + `/ 1000` 字面量；(d) 至少一处路径字面量 `'/api/brain/time'` 或 `"/api/brain/time"`。注释剥离后计数，避免被注释"借字"绕过（**R7 新增 #15**，落实 Reviewer 反馈"风险 2：只检跑过不检测到什么"）
  Test: node -e "const raw=require('fs').readFileSync('packages/brain/src/__tests__/routes-time.test.js','utf8');const c=raw.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'');if(!/\.toBe\s*\(\s*200\s*\)/.test(c))process.exit(11);const isoCnt=(c.match(/\biso\b/g)||[]).length;if(isoCnt<2)process.exit(12);const tzCnt=(c.match(/\btimezone\b/g)||[]).length;if(tzCnt<2)process.exit(13);const unixCnt=(c.match(/\bunix\b/g)||[]).length;if(unixCnt<2)process.exit(14);if(!/Math\.floor\s*\([^)]*Date\.parse/.test(c))process.exit(15);if(!/\/\s*1000\b/.test(c))process.exit(16);if(!/['\"]\/api\/brain\/time['\"]/.test(c))process.exit(17)"

- [ ] [ARTIFACT] `packages/brain/src/routes/time.js` **禁止**从同 workspace 内的本地文件 `import`（即禁止相对路径 `./xxx` / `../xxx` 形式的 import）。允许的 import 来源仅限 npm 包名（如 `express`）与 Node 内置（如 `node:path`）。此条堵住"把 `new Date()` / `toISOString` / `getTime` / `resolvedOptions` 等静态锁要求的调用挪到 helper 本地文件再 `import` 回来"的 belt-and-suspenders 绕路风险——虽然该绕路在 R6 评估为近 0 风险（time.js 仍需字面量包含这些 token 才能通过 ARTIFACT #4），R7 明文禁止彻底消除歧义（**R7 新增 #16**，落实 Reviewer 反馈"helper 旁路 belt-and-suspenders"建议）
  Test: node -e "const raw=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');const c=raw.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'');const localImports=c.match(/import\s+[^;]+?\s+from\s+['\"](\.|\.\.)[^'\"]*['\"]/g)||[];if(localImports.length>0)process.exit(10+Math.min(localImports.length,9))"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `sprints/tests/ws1/time.test.js`，覆盖以下 12 个行为：
- returns HTTP 200 with application/json content-type
- response body contains iso, timezone, unix fields all non-empty
- iso is a valid ISO 8601 extended format string parseable by Date
- timezone is a non-empty string
- timezone is a valid IANA name accepted by Intl.DateTimeFormat
- unix is a positive integer in seconds (lower bound > 1e9, upper bound < 1e12)
- iso and unix within a single response represent the exact same second (strict equality) — 这是"单一 new Date() 快照"语义的行为兜底（与 R5 新增 ARTIFACT #13 的静态硬锁互为双通道）
- two consecutive calls both succeed and each response is internally consistent to the second
- does not require any auth header to return 200
- packages/brain/server.js imports time router and mounts it at /api/brain/time using the same variable
- **（R4）** can GET /api/brain/time against the real Brain app exported from server.js — PRD US-001/SC-002 的终局兜底，直接从 server.js 命名导出的 `app` 跑 supertest
- **（R5 新增 #12）** fifty consecutive requests each satisfy strict iso/unix same-second equality — 把 R4 单次概率断言扩张到 50 次连调，belt-and-suspenders 概率兜底（与 R5 新增 ARTIFACT #13 的静态硬锁配对，任一失败即判红）

**R7 ARTIFACT 层新增说明**：R7 的 #15（行为锚点四件套）+ #16（禁止本地 import）纯粹锁 Brain workspace 单测文件内容结构 + time.js 源码边界，无对应新增 BEHAVIOR it——BEHAVIOR 层 12 条保持 R5 以来稳定；#14 的改写（JSON reporter）同样是 DoD 实现方式的替换，BEHAVIOR 语义不变。
