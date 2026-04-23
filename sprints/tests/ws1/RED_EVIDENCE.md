# Workstream 1 — Red Evidence (TDD Phase 1)

**捕获命令**: `/workspace/node_modules/.bin/vitest run sprints/tests/ws1/time.test.ts --reporter=verbose`（vitest 1.6.1，从仓库根跑，使用默认 config）

**预期红的原因**: Generator 尚未创建 `packages/brain/src/routes/time.js`，测试文件首行 `import timeRouter from '../../../packages/brain/src/routes/time.js'` 解析失败，触发 suite-level 加载错误。8 条 `it()` 因 suite 未能进入 collect 阶段 ⇒ 全部统计为 FAIL（no tests ran）。

**实际输出**（节选 /tmp/ws1-red.log 末尾）:

```
⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  sprints/tests/ws1/time.test.ts [ sprints/tests/ws1/time.test.ts ]
Error: Failed to load url ../../../packages/brain/src/routes/time.js (resolved id: ../../../packages/brain/src/routes/time.js) in /workspace/sprints/tests/ws1/time.test.ts. Does the file exist?
 ❯ loadAndTransform node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  no tests
```

**it() 清单（Generator 实现后必须全绿）**:

1. `GET /api/brain/time responds with HTTP 200 and application/json content type`
2. `response body contains exactly the three keys iso, timezone, unix — no others`
3. `iso is a string parseable as a Date within 2 seconds of request time`
4. `unix is a positive integer in seconds (at most 10 digits), not milliseconds`
5. `timezone is a non-empty string`
6. `new Date(iso).getTime() and unix * 1000 agree within 2000ms`
7. `ignores query parameters and returns server-side current time (cannot be poisoned by ?iso=evil etc.)`
8. `timezone falls back to "UTC" when Intl.DateTimeFormat resolves timeZone to empty/undefined`

**Green 条件**: Generator 按 `contract-dod-ws1.md` 实现 `routes/time.js` 并在 `routes.js` 聚合后，重跑同命令应得 `Tests  8 passed (8) · Test Files  1 passed (1)`。

**备注**: Brain 的 `packages/brain/vitest.config.js` 的 `test.include` 只覆盖 `src/**` + `../../tests/packages/brain/**`，不包含 `sprints/tests/**`。因此本合同测试需由仓库根 vitest 或 Harness v6 调度脚本显式传入文件路径执行；不会被 brain-ci 常规测试 include 自动拉入，也不会污染 brain 的 main 绿线。
