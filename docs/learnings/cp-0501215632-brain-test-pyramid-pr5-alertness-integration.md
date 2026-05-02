### 根本原因

alertness 路由嵌在 `packages/brain/src/routes/tick.js` 中，通过 `routes.js` 合并挂载到 `/api/brain`，直接挂载 tick router 即可覆盖所有 alertness 端点；`alertness/index.js` 用模块级变量（`currentState`/`_manualOverride`）维护状态，`vi.resetModules()` + 每次 `beforeEach` 重新 `import` 可确保每个测试获得干净的内存状态。

`clearManualOverride()` 内部调用 `evaluateAlertness()`，后者依赖 metrics/diagnosis 子模块，必须 mock 这些子模块否则会触发真实 OS 指标采集和 DB 写入。

### 下次预防

- [ ] alertness 状态行为测试：用 `supertest` + tick router 直接挂载，mock `db.js`/`event-bus.js`/`alertness` 四个子模块（metrics/diagnosis/escalation/healing）
- [ ] 每次 `beforeEach` 执行 `vi.resetModules()` + `makeApp()` 重新 import，保证模块级内存状态干净
- [ ] `afterAll` 调用 `POST /api/brain/alertness/clear-override`，防止测试污染 Brain 全局 alertness 状态
- [ ] `tick.js` 自身也需要 mock，防止其他 tick 相关副作用影响测试
