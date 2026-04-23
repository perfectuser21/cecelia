# Contract DoD — Workstream 1: `/api/brain/time` 路由模块 + 聚合器挂接

**范围**:
- 新建 `packages/brain/src/routes/time.js`：Express Router，定义 `GET /time`，响应 JSON `{ iso, timezone, unix }`，默认导出 Router 实例
- 修改 `packages/brain/src/routes.js`：新增一行 `import timeRouter from './routes/time.js'` + 在 for-of 合并数组尾部追加 `timeRouter`

**大小**: S（<30 行净改动）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/time.js` 文件存在
  Test: `node -e "require('fs').accessSync('packages/brain/src/routes/time.js')"`

- [ ] [ARTIFACT] `routes/time.js` 定义 `GET /time` 路由
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/router\.get\(\s*['\"]\/time['\"]/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] `routes/time.js` 默认导出 Express Router 实例
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/export\s+default\s+router/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] `routes/time.js` 不 import 任何 DB 模块（db.js / pg / redis）
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(/from\s+['\"](?:\.\.\/)+db(?:\.js)?['\"]|from\s+['\"]pg['\"]|from\s+['\"]ioredis['\"]|from\s+['\"]redis['\"]/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] `routes/time.js` 不 import 任何外部 LLM SDK（openai / anthropic）
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(/from\s+['\"]openai['\"]|from\s+['\"]@anthropic-ai\/sdk['\"]/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] `routes/time.js` 使用 `Intl.DateTimeFormat` 获取 timezone 且含 `UTC` fallback 字面量
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/Intl\.DateTimeFormat/.test(c)||!/['\"]UTC['\"]/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] `packages/brain/src/routes.js` 含 `import` time router 的语句
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes.js','utf8');if(!/import\s+timeRouter\s+from\s+['\"]\.\/routes\/time\.js['\"]/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] `packages/brain/src/routes.js` 将 `timeRouter` 加入 for-of 合并数组（而非 router.use 单独挂载，以对齐 FR-004）
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes.js','utf8');const m=c.match(/for\s*\(\s*const\s+subRouter\s+of\s+\[([^\]]+)\]/);if(!m||!/timeRouter/.test(m[1]))process.exit(1)"`

- [ ] [ARTIFACT] `routes/time.js` 文件长度 < 60 行（限制实现在约定规模内，防止隐藏业务逻辑）
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(c.split(/\n/).length>=60)process.exit(1)"`

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `sprints/tests/ws1/time.test.ts`，覆盖 8 条 `it()`：

- `GET /api/brain/time responds with HTTP 200 and application/json content type`
- `response body contains exactly the three keys iso, timezone, unix — no others`
- `iso is a string parseable as a Date within 2 seconds of request time`
- `unix is a positive integer in seconds (at most 10 digits), not milliseconds`
- `timezone is a non-empty string`
- `new Date(iso).getTime() and unix * 1000 agree within 2000ms`
- `ignores query parameters and returns server-side current time (cannot be poisoned by ?iso=evil etc.)`
- `timezone falls back to "UTC" when Intl.DateTimeFormat resolves timeZone to empty/undefined`
