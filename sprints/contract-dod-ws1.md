# Contract DoD — Workstream 1: `/api/brain/time` 路由模块 + 聚合器挂接 + 真机 E2E 脚本

**范围**:
- 新建 `packages/brain/src/routes/time.js`：Express Router，定义 `GET /time`，响应 JSON `{ iso, timezone, unix }`，默认导出 Router 实例
- 修改 `packages/brain/src/routes.js`：新增一行 `import timeRouter from './routes/time.js'` + 在 for-of 合并数组尾部追加 `timeRouter`
- 新建 `tests/e2e/brain-time.sh`：真机 curl + jq E2E（SC-003），断言强度与 BEHAVIOR `it(2)(5)(8)` 等价（字段白名单 / unix 整数秒 / iso↔unix 2s 一致性 / ISO 8601 严格格式）

**大小**: S（<30 行 Brain 源码改动 + ~80 行 bash 脚本）
**依赖**: 无

## ARTIFACT 条目

### 源码 ARTIFACT

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

### 真机 E2E 脚本 ARTIFACT（新增 — 修复 Round 1 Reviewer Risk 5）

- [ ] [ARTIFACT] `tests/e2e/brain-time.sh` 文件存在且可执行
  Test: `bash -c "test -x tests/e2e/brain-time.sh"`

- [ ] [ARTIFACT] E2E 脚本调用 `/api/brain/time` 端点（curl 到 `/api/brain/time`）
  Test: `node -e "const c=require('fs').readFileSync('tests/e2e/brain-time.sh','utf8');if(!/\/api\/brain\/time/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] E2E 脚本含字段白名单断言（jq keys 等价于 Object.keys）
  Test: `node -e "const c=require('fs').readFileSync('tests/e2e/brain-time.sh','utf8');if(!/Object\.keys/.test(c)||!/keys\s*\|\s*sort/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] E2E 脚本断言 `.unix` 类型必须为 number（覆盖 it(5) 等价断言）
  Test: `node -e "const c=require('fs').readFileSync('tests/e2e/brain-time.sh','utf8');if(!/unix.*type.*number/s.test(c))process.exit(1)"`

- [ ] [ARTIFACT] E2E 脚本断言 unix 字符串长度 ≤ 10（秒级非毫秒级）
  Test: `node -e "const c=require('fs').readFileSync('tests/e2e/brain-time.sh','utf8');if(!/length.{0,30}10/s.test(c))process.exit(1)"`

- [ ] [ARTIFACT] E2E 脚本含 iso↔unix 2000ms 一致性断言（覆盖 it(8) 等价）
  Test: `node -e "const c=require('fs').readFileSync('tests/e2e/brain-time.sh','utf8');if(!/iso.*unix.*2000/s.test(c))process.exit(1)"`

- [ ] [ARTIFACT] E2E 脚本含严格 ISO 8601 正则断言（覆盖 it(4) 等价）
  Test: `node -e "const c=require('fs').readFileSync('tests/e2e/brain-time.sh','utf8');if(!/\\\\d\\{4\\}-\\\\d\\{2\\}-\\\\d\\{2\\}T/.test(c)||!/\[\+\\-\]/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] E2E 脚本含 query 污染免疫断言（传 `?iso=evil&unix=1&timezone=Fake%2FZone` 后仍返回服务器真实时间）
  Test: `node -e "const c=require('fs').readFileSync('tests/e2e/brain-time.sh','utf8');if(!/iso=evil/.test(c)||!/Fake/.test(c))process.exit(1)"`

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `sprints/tests/ws1/time.test.ts`，覆盖 11 条 `it()`（Round 2 从 8 → 11，新增 3 条对抗 Reviewer Risk 1/2/3 指出的 mutation）：

1. `GET /api/brain/time responds with HTTP 200 and application/json content type`
2. `response body contains exactly the three keys iso, timezone, unix — no others`
3. `iso is a string parseable as a Date within 2 seconds of request time`
4. `iso matches strict ISO 8601 instant format with Z or ±HH:MM timezone suffix` **（新增 — Risk 1）**
5. `unix is a positive integer in seconds (at most 10 digits), not milliseconds`
6. `timezone is a non-empty string`
7. `timezone is a valid IANA zone name (accepted by Intl.DateTimeFormat constructor)` **（新增 — Risk 2）**
8. `new Date(iso).getTime() and unix * 1000 agree within 2000ms`
9. `ignores query parameters and returns server-side current time (cannot be poisoned by ?iso=evil etc.)`
10. `timezone falls back to "UTC" when Intl.DateTimeFormat resolves timeZone to empty/undefined`
11. `timezone reflects Intl-resolved value (is NOT hardcoded to "UTC")` **（新增 — Risk 3，反向 mutation detection）**
