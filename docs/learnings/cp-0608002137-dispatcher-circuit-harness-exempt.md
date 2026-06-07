## dispatcher.js 熔断检查全局拦截 harness_initiative（2026-06-08）

### 根本原因

`dispatcher.js` 的全局熔断检查（`isAllowed('cecelia-run')`）放在任务选择（`selectNextDispatchableTask`）**之前**，对所有任务类型一视同仁。当熔断器 OPEN 时，`harness_initiative` 任务（走 Docker spawn，不依赖 cecelia-bridge）也被错误拦截，pipeline 全程卡住。

正确豁免逻辑（`needsBridgeCheck = task_type !== 'harness_initiative'`）已在 line 534 存在，但提前的全局检查让它永不可达。

### 下次预防

- [ ] 新增任何全局 early-return 检查前，先问："有没有任务类型天然豁免这个检查？"
- [ ] 任务类型路径不同（bridge vs docker）→ 相关保护门禁必须在任务选择**之后**才生效
- [ ] 熔断器检查不应在还不知道"要 dispatch 哪个任务"时就提前拦截
- [ ] Regression test `dispatcher-circuit-harness-exempt.test.js` 已永久留 CI，保证不退化
