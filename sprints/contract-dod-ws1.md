# Contract DoD — Workstream 1: `/api/brain/time` 路由模块 + 聚合器挂接 + 真机 E2E 脚本

**范围**:
- 新建 `packages/brain/src/routes/time.js`：Express Router，定义 `GET /time`，响应 JSON `{ iso, timezone, unix }`，`iso` 由 `new Date().toISOString()` 生成（UTC Z 后缀），默认导出 Router 实例；**`Intl.DateTimeFormat` 调用必须发生在 `router.get` 回调体内部，不得在模块顶层执行/缓存**
- 修改 `packages/brain/src/routes.js`：新增 `import timeRouter from './routes/time.js'`，并以 `router.use('/<path>', timeRouter)` **或**出现在 for-of 聚合数组字面量 `[..., timeRouter, ...]` 中的形式**真实挂接**（仅 `import` + 注释不通过 — Round 4 mount-expression 硬化）
- 新建/更新 `tests/e2e/brain-time.sh`：真机 curl + jq E2E（SC-003），8 步断言，强等价 BEHAVIOR `it(2)(4)(5)(7)(8)(9)(12)(13)`；Round 4 step 8 状态码改为 `{404, 405}` 硬枚举

**大小**: S（<30 行 Brain 源码改动 + ~135 行 bash 脚本）
**依赖**: 无

## ARTIFACT 条目

### 源码 ARTIFACT

- [ ] [ARTIFACT] `packages/brain/src/routes/time.js` 文件存在
  Test: `node -e "require('fs').accessSync('packages/brain/src/routes/time.js')"`

- [ ] [ARTIFACT] `routes/time.js` 定义 `GET /time` 路由
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/router\\.get\\(\\s*['\"]\\/time['\"]/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] `routes/time.js` 默认导出 Express Router 实例
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/export\\s+default\\s+router/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] `routes/time.js` 不 import 任何 DB 模块（db.js / pg / redis）
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(/from\\s+['\"](?:\\.\\.\\/)+db(?:\\.js)?['\"]|from\\s+['\"]pg['\"]|from\\s+['\"]ioredis['\"]|from\\s+['\"]redis['\"]/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] `routes/time.js` 不 import 任何外部 LLM SDK（openai / anthropic）
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(/from\\s+['\"]openai['\"]|from\\s+['\"]@anthropic-ai\\/sdk['\"]/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] `routes/time.js` 使用 `Intl.DateTimeFormat` 获取 timezone 且含 `UTC` fallback 字面量
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/Intl\\.DateTimeFormat/.test(c)||!/['\"]UTC['\"]/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] `routes/time.js` 使用 `toISOString()` 生成 iso（保证 UTC Z 后缀立场 — Round 3 问题 1）
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/\\.toISOString\\s*\\(\\s*\\)/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] **`Intl.DateTimeFormat` 调用必须发生在 `router.get` 回调体内，禁止模块顶层缓存**（Round 4 新增 — Reviewer Round 3 问题 2）。机械化：剥离注释后，首次 `router.get(` 出现位置前的切片不得包含 `Intl.DateTimeFormat`；首次 `router.get(` 出现位置后的切片必须至少包含一次 `Intl.DateTimeFormat`
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8').replace(/\\/\\*[\\s\\S]*?\\*\\//g,'').replace(/\\/\\/[^\\n]*/g,'');const i=c.search(/router\\.get\\s*\\(/);if(i<0)process.exit(2);const pre=c.slice(0,i),post=c.slice(i);if(/Intl\\.DateTimeFormat/.test(pre))process.exit(1);if(!/Intl\\.DateTimeFormat/.test(post))process.exit(3)"`

- [ ] [ARTIFACT] `packages/brain/src/routes.js` 含 `import` time router 的语句
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes.js','utf8');if(!/import\\s+timeRouter\\s+from\\s+['\"]\\.\\/routes\\/time\\.js['\"]/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] **`packages/brain/src/routes.js` 中 `timeRouter` 必须作为函数调用实参出现在 `router.use('/<path>', timeRouter)` 或数组字面量 `[..., timeRouter, ...]` 成员中**（Round 4 收紧 — Reviewer Round 3 问题 1，替代原「标识符 ≥ 2 次」检查；剥离注释后仍需匹配其一，防止「仅 import + 注释里再提一次」假实现）
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes.js','utf8').replace(/\\/\\*[\\s\\S]*?\\*\\//g,'').replace(/\\/\\/[^\\n]*/g,'');const m=/router\\.use\\s*\\(\\s*['\"][^'\"]+['\"]\\s*,\\s*timeRouter\\s*\\)/.test(c);const a=/\\[[^\\]]*\\btimeRouter\\b[^\\]]*\\]/.test(c);if(!m&&!a)process.exit(1)"`

- [ ] [ARTIFACT] `routes/time.js` 文件长度 < 60 行（限制实现在约定规模内，防止隐藏业务逻辑）
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(c.split(/\\n/).length>=60)process.exit(1)"`

### 真机 E2E 脚本 ARTIFACT（Round 2 起交付；Round 3 收紧 ISO 正则 + 新增非 GET/body 免疫；Round 4 step 8 状态码硬枚举）

- [ ] [ARTIFACT] `tests/e2e/brain-time.sh` 文件存在且可执行
  Test: `bash -c "test -x tests/e2e/brain-time.sh"`

- [ ] [ARTIFACT] E2E 脚本调用 `/api/brain/time` 端点（curl 到 `/api/brain/time`）
  Test: `node -e "const c=require('fs').readFileSync('tests/e2e/brain-time.sh','utf8');if(!/\\/api\\/brain\\/time/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] E2E 脚本含字段白名单断言（jq keys 等价于 Object.keys）
  Test: `node -e "const c=require('fs').readFileSync('tests/e2e/brain-time.sh','utf8');if(!/keys\\s*\\|\\s*sort/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] E2E 脚本断言 `.unix` 类型必须为 number（覆盖 it(5) 等价断言）
  Test: `node -e "const c=require('fs').readFileSync('tests/e2e/brain-time.sh','utf8');if(!/unix.*type.*number/s.test(c))process.exit(1)"`

- [ ] [ARTIFACT] E2E 脚本断言 unix 字符串长度 ≤ 10（秒级非毫秒级）
  Test: `node -e "const c=require('fs').readFileSync('tests/e2e/brain-time.sh','utf8');if(!/length.{0,30}10/s.test(c))process.exit(1)"`

- [ ] [ARTIFACT] E2E 脚本含 iso↔unix 2000ms 一致性断言（覆盖 it(8) 等价）
  Test: `node -e "const c=require('fs').readFileSync('tests/e2e/brain-time.sh','utf8');if(!/iso.*unix.*2000|fromdateiso8601/s.test(c))process.exit(1)"`

- [ ] [ARTIFACT] E2E 脚本含严格 ISO 8601 **UTC Z-only** 正则断言（Round 3 收紧 — 问题 1：不接受 ±HH:MM）
  Test: `node -e "const c=require('fs').readFileSync('tests/e2e/brain-time.sh','utf8');if(!/\\\\d\\{4\\}-\\\\d\\{2\\}-\\\\d\\{2\\}T/.test(c))process.exit(1);if(!/Z\\$/.test(c))process.exit(2);if(/\\[\\+\\\\-\\]\\\\d\\{2\\}/.test(c)&&!/Round\\s*3|Z-?suffix|Z\\s*only|UTC\\s*Z|contains.*offset/i.test(c))process.exit(3)"`

- [ ] [ARTIFACT] E2E 脚本含 query 污染免疫断言（传 `?iso=evil&unix=1&timezone=Fake%2FZone` 后仍返回服务器真实时间）
  Test: `node -e "const c=require('fs').readFileSync('tests/e2e/brain-time.sh','utf8');if(!/iso=evil/.test(c)||!/Fake/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] E2E 脚本含**非 GET 方法轮询**（POST/PUT/PATCH/DELETE 四方法）+ body 注入免疫断言 + **非 GET 状态码必须 `∈ {404, 405}` 硬枚举检查**（Round 4 收紧 — Reviewer Round 3 问题 3）
  Test: `node -e "const c=require('fs').readFileSync('tests/e2e/brain-time.sh','utf8');for(const m of ['POST','PUT','PATCH','DELETE']){if(!c.includes(m))process.exit(1)}if(!/-X\\s+[\\\"\\']?\\$?\\{?METHOD/.test(c)&&!/curl.*-X\\s+POST/.test(c))process.exit(2);if(!/iso.{0,5}evil/.test(c)||!/Fake\\/?Zone/.test(c))process.exit(3);if(!/404/.test(c)||!/405/.test(c))process.exit(4)"`

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `sprints/tests/ws1/time.test.ts`，覆盖 **13 条** `it()`（Round 4 与 Round 3 同数，但 `it(12)(13)` 语义收紧对抗 Reviewer Round 3 问题 3）：

1. `GET /api/brain/time responds with HTTP 200 and application/json content type`
2. `response body contains exactly the three keys iso, timezone, unix — no others`
3. `iso is a string parseable as a Date within 2 seconds of request time`
4. `iso matches strict ISO 8601 UTC instant format (Z suffix only, no ±HH:MM)`
5. `unix is a positive integer in seconds (at most 10 digits), not milliseconds`
6. `timezone is a non-empty string`
7. `timezone is a valid IANA zone name (accepted by Intl.DateTimeFormat constructor)`
8. `new Date(iso).getTime() and unix * 1000 agree within 2000ms`
9. `ignores query parameters and returns server-side current time (cannot be poisoned by ?iso=evil etc.)`
10. `timezone falls back to "UTC" when Intl.DateTimeFormat resolves timeZone to empty/undefined`
11. `timezone reflects Intl-resolved value (is NOT hardcoded to "UTC")`
12. `non-GET methods (POST/PUT/PATCH/DELETE) on /api/brain/time respond with status in {404,405} and do NOT leak iso/timezone/unix keys` **（Round 4 收紧 — 问题 3：状态码改为硬枚举）**
13. `POST with JSON body containing {iso,unix,timezone} does NOT poison response — raw res.text must not contain "evil" or "Fake/Zone" literals` **（Round 4 追加 raw-text 断言 — 问题 3）**
