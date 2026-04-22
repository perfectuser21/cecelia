# Contract DoD — Workstream 1: time-endpoints router 实现 + 挂载

**范围**:
- 新建 `packages/brain/src/routes/time-endpoints.js`（Express Router，3 条 GET 路由 + 默认导出 + 命名导出 handlers）
- 修改 `packages/brain/src/routes.js`：新增 `import` 一行 + `router.use('/time', timeEndpointsRouter)` 一行

**大小**: S（新增 ≤ 80 行 + 修改 ≤ 4 行）

**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] 文件 `packages/brain/src/routes/time-endpoints.js` 存在
  Test: node -e "require('fs').accessSync('packages/brain/src/routes/time-endpoints.js')"

- [ ] [ARTIFACT] `time-endpoints.js` 包含 `import { Router } from 'express'`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time-endpoints.js','utf8');if(!/import\s*\{\s*Router\s*\}\s*from\s*['\"]express['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `time-endpoints.js` 含 `router.get('/iso'` GET 路由声明
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time-endpoints.js','utf8');if(!/router\.get\(\s*['\"]\/iso['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `time-endpoints.js` 含 `router.get('/timezone'` GET 路由声明
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time-endpoints.js','utf8');if(!/router\.get\(\s*['\"]\/timezone['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `time-endpoints.js` 含 `router.get('/unix'` GET 路由声明
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time-endpoints.js','utf8');if(!/router\.get\(\s*['\"]\/unix['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `time-endpoints.js` 默认导出 Router（含 `export default`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time-endpoints.js','utf8');if(!/export\s+default\s+\w+/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `time-endpoints.js` 命名导出 3 个 handler（`getIsoHandler` / `getTimezoneHandler` / `getUnixHandler`），便于 BEHAVIOR 测试直接调用。Regex 同时覆盖 `export function/const/let/var NAME` 与 `export { NAME }` / `export { xxx as NAME }` 两种语法
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time-endpoints.js','utf8');for(const n of ['getIsoHandler','getTimezoneHandler','getUnixHandler']){const p1=new RegExp('export\\\\s+(function|const|let|var)\\\\s+'+n+'\\\\b');const p2=new RegExp('export\\\\s*\\\\{[^}]*(\\\\bas\\\\s+)?'+n+'\\\\b[^}]*\\\\}');if(!p1.test(c)&&!p2.test(c)){console.error('missing export',n);process.exit(1)}}"

- [ ] [ARTIFACT] `getTimezoneHandler` 函数体内部引用 `Intl.DateTimeFormat`（禁止模块级缓存 TZ/offset）。**静态结构约束**：handler 必须在每次请求内部调用 `Intl.DateTimeFormat(...).resolvedOptions()`，不得写成 `const TZ = Intl.DateTimeFormat()...` 之类的模块级常量。Regex：从 `getTimezoneHandler` 函数起点（`export function|export const|function|const getTimezoneHandler`）起，其函数体（最多 2000 字符窗口）内必须出现 `Intl.DateTimeFormat`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time-endpoints.js','utf8');const m=c.match(/(export\s+)?(function|const|let|var)\s+getTimezoneHandler\b[\s\S]{0,2000}/);if(!m){console.error('getTimezoneHandler not found');process.exit(1)}if(!/Intl\.DateTimeFormat/.test(m[0])){console.error('Intl.DateTimeFormat not referenced inside getTimezoneHandler body — module-level cache is forbidden');process.exit(1)}"

- [ ] [ARTIFACT] `time-endpoints.js` 总行数 ≤ 80（满足 SC-003 LOC ≤ 100 总约束）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time-endpoints.js','utf8');const n=c.split('\\n').length;if(n>80){console.error('too many lines:',n);process.exit(1)}"

- [ ] [ARTIFACT] `routes.js` 新增 import `timeEndpointsRouter from './routes/time-endpoints.js'`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes.js','utf8');if(!/import\s+timeEndpointsRouter\s+from\s+['\"]\.\/routes\/time-endpoints\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `routes.js` 含挂载 `router.use('/time', timeEndpointsRouter)`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes.js','utf8');if(!/router\.use\(\s*['\"]\/time['\"]\s*,\s*timeEndpointsRouter\s*\)/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `routes.js` 仍保持原有挂载（`/registry` `/pipelines` `/content-library` `/social` `/topics` `/harness` `/kr3` 全部仍在）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes.js','utf8');for(const p of ['/registry','/pipelines','/content-library','/social','/topics','/harness','/kr3']){if(!new RegExp('router\\\\.use\\\\(\\\\s*[\\'\"]'+p.replace(/\\//g,'\\\\/')+'[\\'\"]').test(c)){console.error('mount missing:',p);process.exit(1)}}"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/time-endpoints.test.ts`，共 16 个 `it()` 块，覆盖：
- GET /iso 返回 200 + ISO 8601（毫秒 + Z 或 ±HH:MM 后缀）
- GET /iso 忽略未知 query 参数仍返回 200
- GET /iso 时间戳与测试执行时刻偏差 < 5 秒
- GET /timezone 返回 200 + {timezone, offset, iso} 三字段，全部符合预期格式（timezone 命中严格 IANA 白名单正则）
- GET /timezone 的 offset 严格匹配 ±HH:MM（拒绝 HHMM、单位数小时等）
- GET /timezone 在 Intl.DateTimeFormat 不可用时 fallback 为 UTC + +00:00
- GET /timezone 从 Intl.DateTimeFormat 正向读取 IANA 时区（反制 mutation 8：硬编码 UTC）
- GET /timezone timezone/offset 联合一致：Intl 返回 `Asia/Kolkata` 时 `offset === '+05:30'`（反制 mutation 11：独立分支错配）
- GET /timezone handler 在每次请求内部调 Intl，非模块级缓存（反制 mutation 12：const TZ = ...）
- GET /unix 返回 200 + 10 位正整数（秒，非毫秒）
- GET /unix 值与 Math.floor(Date.now()/1000) 偏差 < 5 秒
- GET /unix 的 unix 字段类型为 Number，非字符串
- GET /iso、/timezone、/unix 三端点响应 `Content-Type: application/json`（3 个独立 it()，mockRes 语义锁死：只有 `.json()` 和显式 `.set('content-type', ...)` 才会写入 header）
- 默认导出的 router 暴露 3 条 GET 路由（路径分别 /iso /timezone /unix）
