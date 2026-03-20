# Learning: Codex Bridge 断连无降级策略

## 背景
executor.js 的路由逻辑中，非 US_ONLY 任务走 Codex Bridge，但网络断开时直接返回失败，任务回到 queued 循环，无法自愈。

### 根本原因
`triggerCeceliaRun()` 对 Codex Bridge 调用使用 `return triggerCodexBridge(task)` 直接返回结果，没有检查返回值的 `success` 字段。当 Bridge 不可达时，任务反复进入 queued → execute → fail → queued 循环。

### 下次预防
- [ ] 所有外部 HTTP 调用点必须有降级路径（fallback），不能假设远端始终可达
- [ ] 路由决策代码需要区分"业务失败"和"网络不可达"，后者应自动降级
- [ ] 新增外部依赖时，在 PR checklist 中加一项"断连降级策略"
