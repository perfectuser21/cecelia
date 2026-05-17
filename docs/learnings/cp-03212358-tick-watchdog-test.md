# Learning: Tick Watchdog 测试覆盖

**Branch**: cp-03212358-tick-watchdog-test
**Date**: 2026-03-21

## 做了什么

为 `startTickWatchdog()` / `stopTickWatchdog()` 补充了 7 个行为测试：
- drain/alertness source 禁用 tick 时自动恢复
- manual source 禁用 tick 时不恢复
- tick 已启用时不触发恢复
- 幂等性（重复 start 不启动多个 timer）
- stop 后不再触发恢复
- 默认间隔验证

### 根本原因

PR #1267 实现了 tick watchdog 自动恢复机制，但没有测试覆盖。watchdog 是 Brain 可靠性的关键保护层，无测试意味着后续重构可能无意中破坏恢复逻辑。

### 下次预防

- [ ] 新增保护机制（watchdog/circuit-breaker/recovery）时，测试必须与代码同 PR 提交
- [ ] tick.js 的 mock 依赖极多（20+ 模块），考虑将 watchdog 逻辑提取为独立模块以降低测试复杂度
