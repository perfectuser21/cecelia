# Learning: executor trigger-cecelia fetch 无超时导致 Brain 完全卡死

**分支**: cp-04041742-fix-executor-fetch-timeout  
**日期**: 2026-04-04

### 根本原因

`packages/brain/src/executor.js` 中 `triggerCeceliaRun()` 函数调用 cecelia-bridge 的 `/trigger-cecelia` 接口时，fetch 没有设置任何超时或 AbortSignal。

当 bridge 不响应（无可用 Claude session、bridge 重启中、网络问题）时，该 fetch Promise 永远不会 resolve。这导致：
1. `doTick()` 永远不结束 → `_tickRunning = true` 永久保持
2. 后续所有 tick 调用都因 "tick_timeout_still_running" 被跳过
3. Node.js 事件循环被阻塞 → Brain 所有 HTTP 请求全部 timeout
4. Brain 完全失去响应能力

次要问题：`TICK_AUTO_RECOVER_MINUTES=5` 过短，导致手动 disable tick 后 5 分钟自动恢复，立即触发相同的阻塞循环。

### 下次预防

- [ ] 所有对外部服务的 fetch 调用必须设置 AbortSignal.timeout，无论是 bridge、外部 API 还是内部服务
- [ ] Code review 时检查 `await fetch(...)` — 没有 signal 参数的 fetch 调用应视为 P0 潜在风险
- [ ] tick auto-recovery 窗口应远大于正常运维操作时间（60min >> 5min）
- [ ] Brain 响应慢/无响应时，优先检查 `_tickRunning` 是否永久为 true（`GET /api/brain/tick/status`）
