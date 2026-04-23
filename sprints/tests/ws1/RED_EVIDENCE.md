# Workstream 1 — Red Evidence (TDD Phase 1, Round 2)

**捕获命令**: `/workspace/node_modules/.bin/vitest run sprints/tests/ws1/time.test.ts --reporter=verbose`（vitest 1.6.1，从仓库根跑，使用默认 config）

**Round 1 → Round 2 变更**：`it()` 数量从 8 → 11，新增 3 条抗 mutation（Risk 1/2/3）；新增 `tests/e2e/brain-time.sh` 作为 SC-003 真机 E2E 脚本（Risk 5）。

**预期红的原因**: Generator 尚未创建 `packages/brain/src/routes/time.js`，测试文件首行 `import timeRouter from '../../../packages/brain/src/routes/time.js'` 解析失败，触发 suite-level 加载错误。11 条 `it()` 因 suite 未能进入 collect 阶段 ⇒ 全部统计为 FAIL（no tests ran）。

**实际输出**（Round 2 捕获 /tmp/ws1-red-r2.log 末尾）:

```
⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  sprints/tests/ws1/time.test.ts [ sprints/tests/ws1/time.test.ts ]
Error: Failed to load url ../../../packages/brain/src/routes/time.js (resolved id: ../../../packages/brain/src/routes/time.js) in /workspace/sprints/tests/ws1/time.test.ts. Does the file exist?
 ❯ loadAndTransform node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  no tests
```

**it() 清单（Generator 实现后必须 11 条全绿）**:

1. `GET /api/brain/time responds with HTTP 200 and application/json content type`
2. `response body contains exactly the three keys iso, timezone, unix — no others`
3. `iso is a string parseable as a Date within 2 seconds of request time`
4. `iso matches strict ISO 8601 instant format with Z or ±HH:MM timezone suffix` **（Round 2 新增 — Risk 1）**
5. `unix is a positive integer in seconds (at most 10 digits), not milliseconds`
6. `timezone is a non-empty string`
7. `timezone is a valid IANA zone name (accepted by Intl.DateTimeFormat constructor)` **（Round 2 新增 — Risk 2）**
8. `new Date(iso).getTime() and unix * 1000 agree within 2000ms`
9. `ignores query parameters and returns server-side current time (cannot be poisoned by ?iso=evil etc.)`
10. `timezone falls back to "UTC" when Intl.DateTimeFormat resolves timeZone to empty/undefined`
11. `timezone reflects Intl-resolved value (is NOT hardcoded to "UTC")` **（Round 2 新增 — Risk 3，反向 mutation detection）**

**Green 条件**:
- vitest：Generator 按 `contract-dod-ws1.md` 实现 `routes/time.js` 并在 `routes.js` 聚合后，重跑同命令应得 `Tests  11 passed (11) · Test Files  1 passed (1)`
- E2E 脚本：Generator 实现路由且 Brain 进程启动后，`BRAIN_URL=http://localhost:5221 bash tests/e2e/brain-time.sh` 应 `exit 0` 并打印 `[e2e] PASS — all 7 assertions met`

**备注**: Brain 的 `packages/brain/vitest.config.js` 的 `test.include` 只覆盖 `src/**` + `../../tests/packages/brain/**`，不包含 `sprints/tests/**`。因此本合同测试需由仓库根 vitest 或 Harness v6 调度脚本显式传入文件路径执行；不会被 brain-ci 常规测试 include 自动拉入，也不会污染 brain 的 main 绿线。
