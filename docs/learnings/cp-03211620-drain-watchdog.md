# Learning: Drain 自杀修复 + tick watchdog

## 背景
drain 完成后调用 disableTick() 是致命 bug，会导致 tick loop 完全停止，系统无法自动恢复。

### 根本原因
drain 的设计意图是"暂停派发，等现有任务完成"，但完成后的处理逻辑错误地选择了 disableTick() 而不是恢复正常运行。这相当于"排水完成后把水泵也关了"。同时缺少运行时的自动恢复机制，TICK_AUTO_RECOVER_MINUTES=30 只在启动时检查且太长。

### 下次预防
- [ ] drain/shutdown 类操作完成后，默认行为应该是恢复而非停止
- [ ] 关键系统状态（tick enabled/disabled）需要有运行时 watchdog，不能只靠启动检查
- [ ] disableTick 需要 source 字段区分来源，便于自动恢复决策
- [ ] 系统级配置（如恢复超时）应该选择保守值（短超时优于长超时）
