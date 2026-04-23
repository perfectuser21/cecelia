# Workstream 1 — Red Evidence (TDD Phase 1, Round 5)

**捕获命令**: `/workspace/node_modules/.bin/vitest run sprints/tests/ws1/ --reporter=verbose`（vitest 1.6.1，从仓库根跑，使用默认 config）

**Round 演进**：
- Round 1：8 条 it()
- Round 2：11 条 it()（新增 Risk 1/2/3 对抗：iso 严格 ISO 8601 正则 / timezone 有效 IANA 校验 / timezone 非硬编码反向 mock）
- Round 3：13 条 it()（新增 Reviewer Round 2 问题 2 的对抗：非 GET 方法不泄漏三字段 + POST body 不污染响应），并把 `it(4)` 的 ISO 8601 正则从"Z 或 ±HH:MM"收紧为"仅 Z"
- Round 4：**保持 13 条 it()** 但 `it(12)(13)` 语义收紧对抗 Reviewer Round 3 问题 3；`contract-dod-ws1.md` 追加两条硬 ARTIFACT（mount-expression 正则 + Intl 切片位置）
- **Round 5（本轮）**：**由 Reviewer Round 4 推荐「放弃硬 ARTIFACT，改行为路线」** → 
  - **删除** Round 4 的两条硬 ARTIFACT（Reviewer Risk 1 mount 正则被误杀/绕过；Risk 2 Intl 切片被 `const I = Intl` 别名绕过）
  - **重写 `it(11)`**：动态 import + 双 mock 切换 + 不重载模块 —— 抓「模块顶层缓存 Intl 解析」假实现（Risk 2 行为路线）
  - **新增 `sprints/tests/ws1/routes-aggregator.test.ts`** 2 条 it()（Risk 1 行为路线）：
    - `it(14)`：动态 import 真实 `packages/brain/src/routes.js`（vi.mock 屏蔽其它子路由副作用）+ supertest `GET /api/brain/time` 验证 200 + 三字段合规
    - `it(15)`：反向 sanity，`GET /api/brain/__nope__` 非 200（防 `app.all('*')` catch-all 假实现）
  - **E2E `tests/e2e/brain-time.sh`** 新增 step 7.5 sanity baseline + step 8 状态码相对化到 baseline（Risk 3）

**预期红的原因**: 
- `time.test.ts`：Generator 尚未创建 `packages/brain/src/routes/time.js`，测试文件首行 `import timeRouter from '../../../packages/brain/src/routes/time.js'` 解析失败，触发 **suite-level 加载错误**。13 条 `it()` 因 suite 未能进入 collect 阶段 ⇒ 全部统计为 FAIL（no tests ran）。
- `routes-aggregator.test.ts`：
  - `it(14)` **fail**（`expected 404 to be 200`）— 因为 `routes.js` 尚未含 `import timeRouter` 也未挂接，动态 import 的聚合器里没有 `/time` 路由，GET `/api/brain/time` 返回 404
  - `it(15)` **pass**（反向断言 `__nope__` 非 200）— 这是**有意设计**的行为：it(15) 在 Red 阶段就 pass 是正确的，因为「聚合器里不存在该路径」本就应该 404；it(15) 的 mutation 检测价值体现在 Green 阶段若 Generator 用 `app.all('*', ...)` 假实现骗过 it(14)，it(15) 会 fail。

**实际输出**（Round 5 捕获 `/tmp/ws1-red-r5.log` 末尾）:

```
 × sprints/tests/ws1/routes-aggregator.test.ts > ... > GET /api/brain/time via the REAL routes.js aggregator returns 200 with exact {iso, timezone, unix} body
   → expected 404 to be 200 // Object.is equality
 ✓ sprints/tests/ws1/routes-aggregator.test.ts > ... > non-existent aggregator path /api/brain/__nope__ returns non-2xx — proving the aggregator is not a catch-all

 FAIL  sprints/tests/ws1/time.test.ts [ sprints/tests/ws1/time.test.ts ]
Error: Failed to load url ../../../packages/brain/src/routes/time.js ...

 Test Files  2 failed (2)
      Tests  1 failed | 1 passed (2)
```

**it() 清单（Round 5 = 13 + 2 = 15 条，Generator 实现后必须 15 条全绿）**:

### `time.test.ts`（13 条）

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
11. **`timezone re-resolves per request — NOT cached at module top level (mutation: const CACHED_TZ = Intl.DateTimeFormat()...)`（Round 5 重写 — Risk 2）**
12. `non-GET methods (POST/PUT/PATCH/DELETE) on /api/brain/time respond with status in {404,405} and do NOT leak iso/timezone/unix keys`
13. `POST with JSON body containing {iso,unix,timezone} does NOT poison response — raw res.text must not contain "evil" or "Fake/Zone" literals`

### `routes-aggregator.test.ts`（2 条 — Round 5 新增 — Risk 1）

14. `GET /api/brain/time via the REAL routes.js aggregator returns 200 with exact {iso, timezone, unix} body`
15. `non-existent aggregator path /api/brain/__nope__ returns non-2xx — proving the aggregator is not a catch-all`

**Green 条件**:
- vitest：Generator 按 `contract-dod-ws1.md` 实现 `routes/time.js`（`iso: new Date().toISOString()`，仅声明 `router.get('/time', ...)`，`Intl.DateTimeFormat` 调用在 handler 回调体内、不处理 POST/PUT/PATCH/DELETE）并在 `routes.js` 聚合（以任意合法挂接形式——Round 5 不再限定 for-of 数组或 `router.use()`，只要行为层 it(14) 通过），重跑同命令应得 `Tests 15 passed (15) · Test Files 2 passed (2)`
- E2E 脚本：Generator 实现路由且 Brain 进程启动后，`BRAIN_URL=http://localhost:5221 bash tests/e2e/brain-time.sh` 应 `exit 0` 并打印 `[e2e] PASS — all 8 assertions met`

**Round 5 硬立场摘要**（供 Generator 阅读）:

1. **iso 格式立场**：`iso` 必须为 `new Date().toISOString()` 产物（UTC Z 后缀）。不允许任何 `±HH:MM` 偏移写法。正则：`/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/`
2. **timezone 语义解耦**：`timezone` 是服务器 `Intl.DateTimeFormat().resolvedOptions().timeZone` 产物（fallback `UTC`），与 `iso` 呈现格式**互不依赖**
3. **`Intl.DateTimeFormat` 调用位置（Round 5 改用行为判据）**：必须**每次请求都调用**（不得在模块顶层求值或缓存）。行为 probe：`it(11)` 动态 import 后切换两次 mock，若模块顶层缓存则第二次请求仍返回第一次 mock 值 → 测试 fail。**不再有 ARTIFACT 切片正则**，对 `const I = Intl` 别名 / 字符串拼接 / alias-assign 等绕过方式全部免疫（spy 拦的是 `Intl.DateTimeFormat` 属性访问，别名 `I` 同指 Intl 对象）
4. **非 GET 不处理**：`router.get('/time', handler)` — 其余 HTTP 方法交 Express 默认行为处理。supertest BEHAVIOR `it(12)` 下挂接独立 timeRouter 到 express，期望状态 ∈ `{404, 405}` 硬枚举；真机 E2E step 8 期望状态 == 同 METHOD 对 `__definitely_not_a_route_xyz__` 的 baseline 响应（Round 5 对 Brain 全局 middleware 布局免疫）
5. **Body 免疫是副产物**：因为非 GET 不触发 handler，POST body `{iso:"evil",...}` 永远进不到响应。不需要额外的 body 解析或清洗逻辑。`res.text` raw 不得出现 `evil`/`Fake/Zone`
6. **聚合器挂接形态（Round 5 彻底放开语法约束）**：`packages/brain/src/routes.js` 必须 `import timeRouter from './routes/time.js'`（保留 ARTIFACT）并将其真实挂接到某个能从 `/api/brain` 前缀解析 `/time` 的位置。**具体语法形式不限** —— for-of 数组成员 / `router.use('/path', timeRouter)` / 其它合法表达式皆可。行为判据：`routes-aggregator.test.ts` it(14) 动态 import `routes.js`（mock 掉其它副作用）+ supertest `GET /api/brain/time` 返回 200 + 三字段合规

**备注**: Brain 的 `packages/brain/vitest.config.js` 的 `test.include` 只覆盖 `src/**` + `../../tests/packages/brain/**`，不包含 `sprints/tests/**`。因此本合同测试需由仓库根 vitest 或 Harness v6 调度脚本显式传入文件路径执行；不会被 brain-ci 常规测试 include 自动拉入，也不会污染 brain 的 main 绿线。
