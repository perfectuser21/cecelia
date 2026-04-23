# Contract DoD — Workstream 1: `/api/brain/time` 路由模块 + 聚合器挂接 + 真机 E2E 脚本

**范围**:
- 新建 `packages/brain/src/routes/time.js`：Express Router，定义 `GET /time`，响应 JSON `{ iso, timezone, unix }`，`iso` 由 `new Date().toISOString()` 生成（UTC Z 后缀），默认导出 Router 实例；**`Intl.DateTimeFormat` 必须每次请求都调用，不得在模块顶层缓存**（Round 5：由 BEHAVIOR it 动态 mock 切换机械抓取；Round 6：搬到同文件独立 describe + afterAll；Round 7 — Reviewer Round 6 Risk 3：进一步搬到**独立测试文件** `time-intl-caching.test.ts`，利用 vitest file-per-worker 进程/线程级隔离消除同文件溢出假设）
- 修改 `packages/brain/src/routes.js`：新增 `import timeRouter from './routes/time.js'`，并将其**真实聚合挂接**到某个能解析 `/time` 的挂接点（具体语法形式不限——`router.use('/path', timeRouter)` / 数组字面量 `[..., timeRouter, ...]` / 其它合法表达式皆可）。Round 5：**删除 Round 4 的 mount-expression 正则 ARTIFACT**，改由 `routes-aggregator.test.ts` 行为测试从聚合器根 `GET /api/brain/time` 验证 200 + 三字段，只要行为通过即视为挂接正确
- 新建/更新 `tests/e2e/brain-time.sh`：真机 curl + jq E2E（SC-003）。Round 5 step 7.5 新增 sanity baseline。Round 6：引入 8 码枚举 `ACCEPTABLE_NOT_FOUND_STATUS`。**Round 7（Reviewer Round 6 Risk 1/2）**：放弃 8 码枚举，改**原则性规则** `is_http_error_status`（`400 ≤ code < 600` —— 任何 HTTP 4xx 或 5xx），step 7.5 与 step 8 **共用同一函数**，覆盖面对称；任何 Brain 合法实现走 401/403/404/405/410/415/422/426/429/451/500/502/503/504 ... 均自动接受，真正的 mutation「POST /time 也返回 200」仍被抓住（200 < 400）。step 8 body key 检查从"grep 命中才跑 jq"改为**无条件 jq 判定**（Reviewer Round 6 minor）
- **Round 8（Reviewer Round 7 (a)(b)(c)）— collect sanity pre-flight 硬纪律**：Generator 在实现 `routes/time.js` 之前必须先跑 `npx vitest run sprints/tests/ws1/time-intl-caching.test.ts` 从仓库根确认 collect 成功（看到 `Test Files  1 failed (1)` + `Failed to load url .../routes/time.js`）；若输出 `No test files found` / `Tests  0` / `0 passed` 任一，**禁止继续实现**，必须先修正 `packages/brain/vitest.config.js` / `packages/quality/vitest.config.ts` / 其它被用来跑合同测试的 vitest.config 的字面量 `include` 列表，显式追加 `sprints/tests/ws1/**/*.{test,spec}.{ts,tsx,js,mjs,cjs}`（或等价 glob/具体文件路径），直到 pre-flight 看到真红姿态。合同测试只有被 vitest collect 到才有资格作为 Green 判据，否则 Green=0-passed 是假绿
- **Round 9（Reviewer Round 8 Risk 1/2/3/4）— collect sanity 契约硬化**：
  - **Risk 1** — collect pre-flight 命令从依赖 vitest 文本报告字符串（`Tests 1` / `Test Files 1`）改用 **JSON reporter**（`--reporter=json --outputFile=/tmp/ws1-intl-json.json`）+ node 解析 `numTotalTests === 1` —— JSON schema 跨 vitest 1.x/2.x/3.x 版本稳定，文本输出格式变更不再影响合同判定
  - **Risk 2** — `contract-draft.md` 的 `## Test Collect Sanity` 章节直接贴出本文件 Round 8+Round 9 新增 ARTIFACT 的完整 `node -e` 命令行（不再用"见 contract-dod-ws1.md"跨文件指针引用），消除 Reviewer 需要跨文件对齐契约的风险
  - **Risk 3** — `## Test Collect Sanity` 命令 3（include 登记校验）从 `echo "[root config] ..."` 仅打印，升级为 `FAILED=0` 记账 + `[ "$FAILED" -eq 0 ] || exit 1` 硬判定 —— gate 脚本不再退化为 echo
  - **Risk 4** — 新增 ARTIFACT：`sprints/tests/ws1/time-intl-caching.test.ts` **禁止** top-level static import `routes/time.js`（必须走 `await import(...)` 动态引用），防止 Generator 或未来 reviewer 把动态 import 改成静态 → 模块顶层在 `vi.spyOn` 之前求值 → 顶层缓存 mutation probe 失效 → 测试假绿

**大小**: S（<30 行 Brain 源码改动 + ~180 行 bash 脚本 + 可能 0-2 行 vitest.config `include` 登记）
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

### 真机 E2E 脚本 ARTIFACT（Round 2 起交付；Round 3 收紧 ISO 正则 + 新增非 GET/body 免疫；Round 4 step 8 状态码硬枚举；Round 5 step 7.5 新增 sanity baseline + step 8 状态码相对化到 baseline；Round 6 8 码枚举 ACCEPTABLE_NOT_FOUND_STATUS；**Round 7 — Reviewer Round 6 Risk 1/2**：枚举升级为原则规则 `is_http_error_status`，step 7.5/step 8 共用；body key 检查无条件化）

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

- [ ] [ARTIFACT] **E2E 脚本含 sanity baseline 步骤（step 7.5）**：对一条明显不存在的路径（`__definitely_not_a_route_xyz__` 或类似）发同 METHOD 请求，记录 baseline 状态码（Round 5 引入；Round 7 保留为诊断步骤）
  Test: `node -e "const c=require('fs').readFileSync('tests/e2e/brain-time.sh','utf8').replace(/#[^\\n]*/g,'');if(!/__definitely_not_a_route_xyz__|NOTFOUND_PATH|__not_a_route/.test(c))process.exit(1);if(!/BASELINE/i.test(c))process.exit(2)"`

- [ ] [ARTIFACT] **E2E 脚本定义原则性规则函数 `is_http_error_status`**（Round 7 新增 — Reviewer Round 6 Risk 1/2：放弃 8 码枚举，改 `400 ≤ code < 600` 原则规则）
  Test: `node -e "const c=require('fs').readFileSync('tests/e2e/brain-time.sh','utf8').replace(/#[^\\n]*/g,'');if(!/is_http_error_status\\s*\\(\\s*\\)/.test(c))process.exit(1);if(!/\\-ge\\s+400/.test(c))process.exit(2);if(!/\\-lt\\s+600/.test(c))process.exit(3)"`

- [ ] [ARTIFACT] **E2E 脚本 step 7.5 与 step 8 共用同一原则规则函数**（覆盖面对称 — Reviewer Round 6 Risk 2）：两处均调用 `is_http_error_status`
  Test: `node -e "const c=require('fs').readFileSync('tests/e2e/brain-time.sh','utf8').replace(/#[^\\n]*/g,'');const m=c.match(/is_http_error_status/g)||[];if(m.length<3)process.exit(1)"`

- [ ] [ARTIFACT] **E2E 脚本 step 7.5 baseline 非 4xx/5xx 时 exit 75**（Round 7 保持 — Reviewer Round 5 Risk 1 基础上升级规则）
  Test: `node -e "const c=require('fs').readFileSync('tests/e2e/brain-time.sh','utf8').replace(/#[^\\n]*/g,'');if(!/is_http_error_status.{0,80}\\|\\||!\\s*is_http_error_status/s.test(c))process.exit(1);if(!/exit\\s+75/.test(c))process.exit(2);if(!/FAIL\\s+7\\.5/.test(c))process.exit(3)"`

- [ ] [ARTIFACT] **E2E 脚本 step 8 非 GET 状态码用原则规则判定**（`is_http_error_status`，自动排除 200；放弃 Round 6 的 8 码枚举 — Reviewer Round 6 Risk 1）
  Test: `node -e 'const c=require("fs").readFileSync("tests/e2e/brain-time.sh","utf8").replace(/#[^\\n]*/g,"");if(!/!\\s*is_http_error_status\\s+.?\\$METHOD_CODE/.test(c))process.exit(1);if(!/exit\\s+8\\b/.test(c))process.exit(2)'`

- [ ] [ARTIFACT] **E2E 脚本 step 8 body key 检查无条件 jq 判定**（Round 7 — Reviewer Round 6 minor：解耦 grep 预筛选，消除 JSON 格式变体漏检风险）
  Test: `node -e 'const c=require("fs").readFileSync("tests/e2e/brain-time.sh","utf8").replace(/#[^\\n]*/g,"");if(!/jq\\s+-e\\s+.\\s*\\.?\\s*.{0,50}\\$METHOD_BODY_FILE/s.test(c))process.exit(1);if(!/has\\("iso"\\)\\s+or\\s+has\\("unix"\\)\\s+or\\s+has\\("timezone"\\)/.test(c))process.exit(2)'`

### Round 8 / Round 9 新增 ARTIFACT（Reviewer Round 7 (a)(b)(c) + Reviewer Round 8 Risk 1/2/3/4 — collect sanity pre-flight）

- [ ] [ARTIFACT] `sprints/tests/ws1/time-intl-caching.test.ts` 文件存在（Round 7 已交付 — Round 8 将其"存在性"显式列成 DoD 条目，作为 collect sanity 链条的起点）
  Test: `node -e "require('fs').accessSync('sprints/tests/ws1/time-intl-caching.test.ts')"`

- [ ] [ARTIFACT] `sprints/tests/ws1/time-intl-caching.test.ts` 顶层含**恰好 1 个** `it(` 调用（与 `vitest list` 预期输出 `Tests  1` 强同构 — 防止 Generator 在 Green 阶段误改测试文件或新增 it 绕过断言强度）
  Test: `node -e "const fs=require('fs');const c=fs.readFileSync('sprints/tests/ws1/time-intl-caching.test.ts','utf8');const m=c.match(/^\\s*it\\s*\\(/gm)||[];if(m.length!==1)process.exit(1)"`

- [ ] [ARTIFACT] `sprints/tests/ws1/time-intl-caching.test.ts` 顶层 `describe(` 块数量 ≥ 1（合同结构前置条件，防 vitest 误把文件视为非测试文件）
  Test: `node -e "const fs=require('fs');const c=fs.readFileSync('sprints/tests/ws1/time-intl-caching.test.ts','utf8');const m=c.match(/^\\s*describe\\s*\\(/gm)||[];if(m.length<1)process.exit(1)"`

- [ ] [ARTIFACT] **条件性 vitest.config include 登记（Reviewer Round 7 (b)；Round 9 — Reviewer Round 8 Risk 3：失败路径硬 exit 1，不再 echo 了事）**：**仅检查仓库根**的 vitest.config.{js,ts}（Harness v6 evaluator 从仓库根直接 `npx vitest run sprints/tests/ws1/<file>` 时被实际应用的 config 位置 —— `packages/brain/vitest.config.js` 不在此范畴，它的 `include` 仅覆盖 brain 自身 src/tests，与合同测试隔离开是 PRD 范围限定的要求）：若仓库根存在 vitest.config.{js,ts} 且声明了字面量 `include:` 数组，该数组必须能匹配 `sprints/tests/ws1/time-intl-caching.test.ts`（合法覆盖形式：显式含 `sprints/tests` / `sprints/**` / `**/*.test.ts` / `**/sprints/**` / 具体路径）；若仓库根无 vitest.config 或 config 不含字面量 `include:` 字段，本条自动 pass（这是当前 Round 7 环境 — 默认 vitest glob `**/*.{test,spec}.?(c|m)[jt]s?(x)` 能 collect 到）。Round 9：此 Test 命令本身已含 `process.exit(1)` 于不匹配分支 —— 不再有 echo-only 软兜底
  Test: `node -e "const fs=require('fs');for(const f of ['vitest.config.js','vitest.config.ts']){if(!fs.existsSync(f))continue;const c=fs.readFileSync(f,'utf8');const m=c.match(/include\\s*:\\s*\\[[\\s\\S]*?\\]/);if(!m)continue;if(!/sprints\\/tests|sprints\\/\\*\\*|\\*\\*\\/sprints|\\*\\*\\/\\*\\.test\\.ts|time-intl-caching/.test(m[0])){console.error('FAIL: '+f+' 根字面量 include 未覆盖 sprints/tests/ws1/time-intl-caching.test.ts');process.exit(1)}}process.exit(0)"`

- [ ] [ARTIFACT] **Round 9 新增（Reviewer Round 8 Risk 4）**：`sprints/tests/ws1/time-intl-caching.test.ts` **禁止** top-level static import `routes/time.js` —— 该文件的 Intl 缓存 mutation probe 必须通过 `await import(/* @vite-ignore */ \`...routes/time.js?rev...=${Date.now()}\`)` 动态引用目标模块，方可让 `vi.spyOn(Intl, 'DateTimeFormat')` 在模块顶层代码执行**之前**生效。若 Generator 或未来 editor 把动态 import 改成静态 `import timeRouter from '../../../packages/brain/src/routes/time.js'`，则模块顶层在 `vi.spyOn` 尚未安装 spy 时就完成解析 → 顶层缓存 mutation 不再被抓 → 测试假绿。硬约束：文件首层（非 await/非函数体内）不得出现匹配 `^\s*import\s+.*from\s+['"].*routes/time\.js['"]` 的行
  Test: `node -e "const c=require('fs').readFileSync('sprints/tests/ws1/time-intl-caching.test.ts','utf8');if(/^\\s*import\\s+[^;]*from\\s+['\"][^'\"]*routes\\/time\\.js['\"]/m.test(c)){console.error('FAIL: time-intl-caching.test.ts 顶层发现 static import routes/time.js — mutation probe 失效');process.exit(1)}"`

- [ ] [ARTIFACT] **Round 9 新增（Reviewer Round 8 Risk 4 配套）**：`sprints/tests/ws1/time-intl-caching.test.ts` 必须至少出现一次 `await import(` 调用（证实走动态 import 路线，和上一条静态 import 禁令形成正反两面硬约束）
  Test: `node -e "const c=require('fs').readFileSync('sprints/tests/ws1/time-intl-caching.test.ts','utf8');if(!/await\\s+import\\s*\\(/.test(c)){console.error('FAIL: time-intl-caching.test.ts 未发现 await import(...) — mutation probe 必须走动态 import');process.exit(1)}"`

- [ ] [ARTIFACT] **Round 9 新增（Reviewer Round 8 Risk 4 配套）**：`sprints/tests/ws1/time-intl-caching.test.ts` 必须至少出现一次 `vi.spyOn(Intl, 'DateTimeFormat')` 或 `vi.spyOn(Intl,'DateTimeFormat')` 调用（证实在动态 import 之前安装 Intl spy 的契约）
  Test: `node -e "const c=require('fs').readFileSync('sprints/tests/ws1/time-intl-caching.test.ts','utf8');if(!/vi\\s*\\.spyOn\\s*\\(\\s*Intl\\s*,\\s*['\"]DateTimeFormat['\"]/.test(c)){console.error('FAIL: 未发现 vi.spyOn(Intl, DateTimeFormat) — mutation probe 机制缺失');process.exit(1)}"`

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `sprints/tests/ws1/time.test.ts`（12 条）+ `sprints/tests/ws1/time-intl-caching.test.ts`（1 条）+ `sprints/tests/ws1/routes-aggregator.test.ts`（2 条），Round 7 共 **12 + 1 + 2 = 15 条 `it()`**（总数与 Round 6 一致；Round 7 物理结构变更：把原同文件独立 describe 的 it(11) 搬到**独立测试文件** — Reviewer Round 6 Risk 3）：

### `time.test.ts`（12 条 — Round 7 = 主 describe 全部 12 条，it(11) 已移出到独立文件）

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
11. `non-GET methods (POST/PUT/PATCH/DELETE) on /api/brain/time respond with status in {404,405} and do NOT leak iso/timezone/unix keys`
12. `POST with JSON body containing {iso,unix,timezone} does NOT poison response — raw res.text must not contain "evil" or "Fake/Zone" literals`

### `time-intl-caching.test.ts`（1 条 — Round 7 新增独立文件 — Reviewer Round 6 Risk 3）

13. `timezone re-resolves per request — NOT cached at module top level (mutation: const CACHED_TZ = Intl.DateTimeFormat()...)`（Round 5 行为路线：`vi.resetModules()` + 动态 import + 双 mock 切换；Round 6 曾搬到同文件独立 describe + `afterAll(vi.restoreAllMocks)`；Round 7 进一步搬到**独立测试文件**，利用 vitest file-per-worker 的进程/线程级隔离彻底消除"同文件 afterAll 不可靠"假设 —— OS/VM 层级强隔离是主防线，文件内 afterAll 仅作保险）

### `routes-aggregator.test.ts`（2 条 — Round 5 新增 — Reviewer Round 4 Risk 1：聚合挂接的行为判定）

14. `GET /api/brain/time via the REAL routes.js aggregator returns 200 with exact {iso, timezone, unix} body`（动态 import `routes.js` + mock 掉其它子路由副作用 + supertest 从 `/api/brain` 前缀发请求，实测聚合器是否把 timeRouter 挂到能解析 `/time` 的位置）
15. `non-existent aggregator path /api/brain/__nope__ returns non-2xx — proving the aggregator is not a catch-all`（反向 sanity：防「app.all('*') 一律返回 200」这种骗过 it(14) 的假实现）
