# Workstream 1 — Red Evidence (TDD Phase 1, Round 4)

**捕获命令**: `/workspace/node_modules/.bin/vitest run sprints/tests/ws1/time.test.ts --reporter=verbose`（vitest 1.6.1，从仓库根跑，使用默认 config）

**Round 演进**：
- Round 1：8 条 it()
- Round 2：11 条 it()（新增 Risk 1/2/3 对抗：iso 严格 ISO 8601 正则 / timezone 有效 IANA 校验 / timezone 非硬编码反向 mock）
- Round 3：13 条 it()（新增 Reviewer Round 2 问题 2 的对抗：非 GET 方法不泄漏三字段 + POST body 不污染响应），并把 `it(4)` 的 ISO 8601 正则从"Z 或 ±HH:MM"收紧为"仅 Z"（Reviewer Round 2 问题 1 — iso↔timezone 语义解耦立场）
- **Round 4**：**保持 13 条 it()** 但 `it(12)(13)` 语义收紧对抗 Reviewer Round 3 问题 3：
  - `it(12)` 状态码从 `!==200` 收紧为 `∈ {404, 405}` 硬枚举
  - `it(13)` 追加 `res.text` raw 字面量反向断言（不含 `evil`/`Fake/Zone`）
  - 同时对抗 Reviewer Round 3 问题 1/2（在 `contract-dod-ws1.md` 的 ARTIFACT 层面硬化）：
    - `timeRouter` 必须作为 `router.use(..., timeRouter)` 实参 OR 数组字面量 `[..., timeRouter, ...]` 成员（剥离注释后），禁「import + 注释补齐」假实现
    - `routes/time.js` 中 `Intl.DateTimeFormat` 调用**必须**发生在 `router.get('/time', ...)` 回调体内部（首次 `router.get(` 之前的切片不得含 `Intl.DateTimeFormat`），禁模块顶层缓存

**预期红的原因**: Generator 尚未创建 `packages/brain/src/routes/time.js`，测试文件首行 `import timeRouter from '../../../packages/brain/src/routes/time.js'` 解析失败，触发 suite-level 加载错误。13 条 `it()` 因 suite 未能进入 collect 阶段 ⇒ 全部统计为 FAIL（no tests ran）。

**实际输出**（Round 4 捕获 `/tmp/ws1-red-r4.log` 末尾）:

```
⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  sprints/tests/ws1/time.test.ts [ sprints/tests/ws1/time.test.ts ]
Error: Failed to load url ../../../packages/brain/src/routes/time.js (resolved id: ../../../packages/brain/src/routes/time.js) in /workspace/sprints/tests/ws1/time.test.ts. Does the file exist?
 ❯ loadAndTransform node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  no tests
```

**it() 清单（Generator 实现后必须 13 条全绿）**:

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
12. `non-GET methods (POST/PUT/PATCH/DELETE) on /api/brain/time respond with status in {404,405} and do NOT leak iso/timezone/unix keys` **（Round 4 收紧 — 问题 3）**
13. `POST with JSON body containing {iso,unix,timezone} does NOT poison response — raw res.text must not contain "evil" or "Fake/Zone" literals` **（Round 4 追加 raw-text 断言 — 问题 3）**

**Green 条件**:
- vitest：Generator 按 `contract-dod-ws1.md` 实现 `routes/time.js`（`iso: new Date().toISOString()`，仅声明 `router.get('/time', ...)`，`Intl.DateTimeFormat` 调用在 handler 回调体内、不处理 POST/PUT/PATCH/DELETE）并在 `routes.js` 聚合后（以 `router.use(..., timeRouter)` 或 for-of 数组成员形式），重跑同命令应得 `Tests  13 passed (13) · Test Files  1 passed (1)`
- E2E 脚本：Generator 实现路由且 Brain 进程启动后，`BRAIN_URL=http://localhost:5221 bash tests/e2e/brain-time.sh` 应 `exit 0` 并打印 `[e2e] PASS — all 8 assertions met`

**Round 4 硬立场摘要**（供 Generator 阅读）:

1. **iso 格式立场**：`iso` 必须为 `new Date().toISOString()` 产物（UTC Z 后缀）。不允许任何 `±HH:MM` 偏移写法。正则：`/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/`。
2. **timezone 语义解耦**：`timezone` 是服务器 `Intl.DateTimeFormat().resolvedOptions().timeZone` 产物（fallback `UTC`），与 `iso` 呈现格式**互不依赖**。
3. **`Intl.DateTimeFormat` 调用位置**：必须在 `router.get('/time', ...)` 的回调体内部。**不得**在模块顶层（例如 `const CACHED_TZ = Intl.DateTimeFormat()...`）求值或缓存。ARTIFACT 切片检查会直接 `exit 1`。
4. **非 GET 不处理**：`router.get('/time', handler)` — 其余 HTTP 方法交 Express 默认行为处理（返回 404）。**不要**写 `router.all` 或独立 POST handler。状态码必须 `∈ {404, 405}`。
5. **Body 免疫是副产物**：因为非 GET 不触发 handler，POST body `{iso:"evil",...}` 永远进不到响应。不需要额外的 body 解析或清洗逻辑。`res.text` raw 不得出现 `evil`/`Fake/Zone`。
6. **聚合器挂接形态**：`packages/brain/src/routes.js` 中 `timeRouter` 必须作为 `router.use('/<path>', timeRouter)` 的实参，或者加入 for-of 合并的数组字面量（例如 `[statusRouter, tasksRouter, ..., timeRouter]`），不能仅出现在 `import` 语句 + 注释里。

**备注**: Brain 的 `packages/brain/vitest.config.js` 的 `test.include` 只覆盖 `src/**` + `../../tests/packages/brain/**`，不包含 `sprints/tests/**`。因此本合同测试需由仓库根 vitest 或 Harness v6 调度脚本显式传入文件路径执行；不会被 brain-ci 常规测试 include 自动拉入，也不会污染 brain 的 main 绿线。
