## tick.js executor.js 路径错误导致 Brain tick 停止（2026-05-06）

### 根本原因

`packages/brain/src/routes/tick.js` 的两处动态 import 用了 `'./executor.js'`，
但 `executor.js` 实际在上一级 `src/executor.js`，正确路径应为 `'../executor.js'`。

这类错误在 CI 单元测试中不会暴露，因为测试 mock 的是 `'../executor.js'`（从测试文件视角的正确路径），
而 tick.js 的动态 import 只在路由被真实调用时才执行。结果是 Brain 进程正常运行、API 大部分正常，
但 `/api/brain/billing-pause` 和 `/api/brain/session/stats` 路由一被调用就抛异常，
tick loop 依赖这两个路由而整个停止调度，最后一次 tick 事件停在 2026-05-05T23:49。

### 下次预防

- [ ] 动态 `import()` 的路径要和静态 `import` 一样仔细核对相对层级，`routes/` 子目录引用 `src/` 文件必须用 `'../`
- [ ] 新增路由 handler 中的动态 import，配套加静态路径断言测试（`expect(src).not.toContain('wrong/path')`）
- [ ] `lint-test-pairing` 或 smoke.sh 应覆盖关键路由的真实调用，不能只靠 mock 单元测试
