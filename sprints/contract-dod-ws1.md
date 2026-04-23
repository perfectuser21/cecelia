# Contract DoD — Workstream 1: `/api/brain/time` 路由模块 + 聚合器挂接 + 真机 E2E 脚本

**范围**:
- 新建 `packages/brain/src/routes/time.js`：Express Router，定义 `GET /time`，响应 JSON `{ iso, timezone, unix }`，`iso` 由 `new Date().toISOString()` 生成（UTC Z 后缀），默认导出 Router 实例；**`Intl.DateTimeFormat` 必须每次请求都调用，不得在模块顶层缓存**（Round 5：由 BEHAVIOR it(11) 动态 mock 切换机械抓取，不再用 ARTIFACT 正则检查）
- 修改 `packages/brain/src/routes.js`：新增 `import timeRouter from './routes/time.js'`，并将其**真实聚合挂接**到某个能解析 `/time` 的挂接点（具体语法形式不限——`router.use('/path', timeRouter)` / 数组字面量 `[..., timeRouter, ...]` / 其它合法表达式皆可）。Round 5：**删除 Round 4 的 mount-expression 正则 ARTIFACT**（Reviewer 指出该正则既会误杀合法挂接又可被字符串/注释绕过），改由 `routes-aggregator.test.ts` 行为测试从聚合器根 `GET /api/brain/time` 验证 200 + 三字段，只要行为通过即视为挂接正确
- 新建/更新 `tests/e2e/brain-time.sh`：真机 curl + jq E2E（SC-003），Round 5 step 7.5 新增 sanity baseline（对一条肯定不存在路径同 METHOD 打一发记录 baseline 状态码），step 8 非 GET 期望值**相对化**到 baseline（不再硬编码 `{404, 405}`）

**大小**: S（<30 行 Brain 源码改动 + ~160 行 bash 脚本）
**依赖**: 无

## ARTIFACT 条目

### 源码 ARTIFACT（Round 5：瘦身版——剥离易被误杀/绕过的静态正则检查，行为判定移到 tests/ws1 的 it() 中）

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

- [ ] [ARTIFACT] `routes/time.js` 使用 `toISOString()` 生成 iso（保证 UTC Z 后缀立场 — Round 3 问题 1）
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/\\.toISOString\\s*\\(\\s*\\)/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] `packages/brain/src/routes.js` 含 `import timeRouter from './routes/time.js'`（必要条件；聚合挂接的充分性由行为测试 `routes-aggregator.test.ts` 验证）
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes.js','utf8');if(!/import\\s+timeRouter\\s+from\\s+['\"]\\.\\/routes\\/time\\.js['\"]/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] `routes/time.js` 文件长度 < 60 行（限制实现在约定规模内，防止隐藏业务逻辑）
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(c.split(/\\n/).length>=60)process.exit(1)"`

> **Round 5 变更说明**（Reviewer Round 4 Risk 1 & Risk 2 回应）：
>
> 1. **删除** Round 4 的 `timeRouter` mount-expression 正则 ARTIFACT。Reviewer 指出该正则对合法挂接形式（特别是带多行数组字面量 + 具名变量 + 尾逗号的 for-of 模式）存在误杀，同时对「注释补齐 + 变量别名 + 字符串拼接」等假实现存在绕过空间。行为判定改由 `sprints/tests/ws1/routes-aggregator.test.ts` 承担：动态 import 真实 `routes.js`（mock 掉其它子路由的副作用），`GET /api/brain/time` 必须返回 200 + 三字段合规。这是对「聚合器真把 timeRouter 挂上了」的**行为判据**，不再依赖语法正则猜测。
>
> 2. **删除** Round 4 的 `Intl.DateTimeFormat` 切片位置 ARTIFACT。Reviewer 指出字面量正则匹配可被 `const I = Intl` / 字符串拼接 / 别名 import 绕过。行为判定改由 `sprints/tests/ws1/time.test.ts` 的 `it(11)`（Round 5 重写）承担：`vi.resetModules()` → 先 mock 成 `Asia/Tokyo` 再动态 import `routes/time.js` → 发请求 A 拿到 Asia/Tokyo → **不重载模块**切换 mock 成 `America/New_York` → 发请求 B 必须拿到 New_York。若实现在模块顶层缓存（任何形式），请求 B 仍返回 Asia/Tokyo，测试 fail。这是对「每次请求都走 Intl」的**行为判据**，对别名/拼接/缓存策略免疫。

### 真机 E2E 脚本 ARTIFACT（Round 2 起交付；Round 3 收紧 ISO 正则 + 新增非 GET/body 免疫；Round 4 step 8 状态码硬枚举；Round 5 step 7.5 新增 sanity baseline + step 8 状态码相对化）

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

- [ ] [ARTIFACT] E2E 脚本含**非 GET 方法轮询**（POST/PUT/PATCH/DELETE 四方法）+ body 注入免疫断言（Round 3 新增）
  Test: `node -e "const c=require('fs').readFileSync('tests/e2e/brain-time.sh','utf8');for(const m of ['POST','PUT','PATCH','DELETE']){if(!c.includes(m))process.exit(1)}if(!/curl.*-X\\s+[\\\"\\']?POST/.test(c)&&!/-X\\s+[\\\"\\']?\\$?\\{?METHOD/.test(c))process.exit(2);if(!/iso.{0,5}evil/.test(c)||!/Fake\\/?Zone/.test(c))process.exit(3)"`

- [ ] [ARTIFACT] **E2E 脚本含 sanity baseline 步骤（step 7.5）**：对一条明显不存在的路径（`__definitely_not_a_route_xyz__` 或类似）发同 METHOD 请求，记录 baseline 状态码（Round 5 新增 — Reviewer Round 4 Risk 3）
  Test: `node -e "const c=require('fs').readFileSync('tests/e2e/brain-time.sh','utf8').replace(/#[^\\n]*/g,'');if(!/__definitely_not_a_route_xyz__|NOTFOUND_PATH|__not_a_route/.test(c))process.exit(1);if(!/BASELINE/i.test(c))process.exit(2)"`

- [ ] [ARTIFACT] **E2E 脚本非 GET 状态码相对化到 baseline（不再硬编码 `{404, 405}`）**（Round 5 — Reviewer Round 4 Risk 3）
  Test: `node -e "const c=require('fs').readFileSync('tests/e2e/brain-time.sh','utf8').replace(/#[^\\n]*/g,'');if(!/EXPECTED_CODE|BASELINE_POST|BASELINE_PUT|BASELINE_PATCH|BASELINE_DELETE/.test(c))process.exit(1);if(!/METHOD_CODE\\s*!=\\s*[\\\"\\']?\\$|EXPECTED_CODE/.test(c))process.exit(2)"`

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `sprints/tests/ws1/time.test.ts` + `sprints/tests/ws1/routes-aggregator.test.ts`，Round 5 共 **13 + 2 = 15 条 `it()`**（相对 Round 4 + 2：Risk 1 行为覆盖 2 条；Risk 2 覆盖方式从 ARTIFACT 切换为 time.test.ts it(11) 重写，it 计数不变）：

### `time.test.ts`（13 条，Round 5 重写 it(11)）

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
11. **`timezone re-resolves per request — NOT cached at module top level (mutation: const CACHED_TZ = Intl.DateTimeFormat()...)`** **（Round 5 重写 — Reviewer Round 4 Risk 2：动态 import + 两次 mock 切换，不重载模块，抓模块顶层缓存）**
12. `non-GET methods (POST/PUT/PATCH/DELETE) on /api/brain/time respond with status in {404,405} and do NOT leak iso/timezone/unix keys`
13. `POST with JSON body containing {iso,unix,timezone} does NOT poison response — raw res.text must not contain "evil" or "Fake/Zone" literals`

### `routes-aggregator.test.ts`（2 条 — Round 5 新增 — Reviewer Round 4 Risk 1：聚合挂接的行为判定）

14. `GET /api/brain/time via the REAL routes.js aggregator returns 200 with exact {iso, timezone, unix} body`（动态 import `routes.js` + mock 掉其它子路由副作用 + supertest 从 `/api/brain` 前缀发请求，实测聚合器是否把 timeRouter 挂到能解析 `/time` 的位置）
15. `non-existent aggregator path /api/brain/__nope__ returns non-2xx — proving the aggregator is not a catch-all`（反向 sanity：防「app.all('*') 一律返回 200」这种骗过 it(14) 的假实现）
