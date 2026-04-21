# Contract DoD — Workstream 1: Brain /api/brain/time 只读时间端点

**范围**: 新增 Express Router + 在 `packages/brain/server.js` 挂载 + 新增单测 + 更新 `docs/current/README.md`。
**大小**: S（总新增 < 100 行）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/time.js` 文件存在
  Test: node -e "require('fs').accessSync('packages/brain/src/routes/time.js')"

- [ ] [ARTIFACT] `packages/brain/src/routes/time.js` 使用 `express.Router` 并 default export 一个 Router 实例
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/from\s+['\"]express['\"]/.test(c))process.exit(1);if(!/Router\s*\(\s*\)/.test(c))process.exit(2);if(!/export\s+default\s+\w+/.test(c))process.exit(3)"

- [ ] [ARTIFACT] `packages/brain/src/routes/time.js` 注册 `GET /` 路径（与 `/api/brain/time` 前缀组合后即 `/api/brain/time`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/router\.get\s*\(\s*['\"]\/['\"]\s*,/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/routes/time.js` 三字段来自同一个 Date 快照（`new Date(` 恰好 1 次；含 `toISOString` / `getTime` / `resolvedOptions`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');const n=(c.match(/new\s+Date\s*\(/g)||[]).length;if(n!==1)process.exit(10+n);if(!c.includes('toISOString'))process.exit(2);if(!/getTime\s*\(\s*\)/.test(c))process.exit(3);if(!/resolvedOptions\s*\(\s*\)/.test(c))process.exit(4)"

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

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `sprints/tests/ws1/time.test.ts`，覆盖以下 10 个行为：
- returns HTTP 200 with application/json content-type
- response body contains iso, timezone, unix fields all non-empty
- iso is a valid ISO 8601 extended format string parseable by Date
- timezone is a non-empty string
- timezone is a valid IANA name accepted by Intl.DateTimeFormat
- unix is a positive integer in seconds, not milliseconds and not float
- iso and unix within a single response represent the exact same second (strict equality)
- two consecutive calls both succeed and each response is internally consistent to the second
- does not require any auth header to return 200
- packages/brain/server.js imports time router and mounts it at /api/brain/time using the same variable
