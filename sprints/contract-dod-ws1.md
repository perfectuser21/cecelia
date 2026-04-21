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
