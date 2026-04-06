# Learning: Harness Pipeline 防误杀

## 背景

sprint_fix R2 任务在夜间被 Brain emergency_brake 误取消，根因是两个独立系统的矛盾判断：
healthScore=55（ALERT 范围）但 patterns=[]（"System is healthy"）。escalation.js 用 "System is healthy" 作为 reason 触发了 L2 emergency_brake，cancelPendingTasks 把所有 Harness 任务清空。

### 根本原因

1. **双标准冲突**：`alertness/index.js` 的 healthScore（数值，50-69 → ALERT）和 `diagnosis.patterns`（模式检测，0个异常模式 → 健康）是两个独立系统，彼此不感知对方，当数值分低但无异常模式时会产生矛盾结论
2. **白名单缺失**：`escalation.js` 的 `cancelPendingTasks` 和 `pauseLowPriorityTasks` 没有保护 Harness 类型任务，`task-cleanup.js` 的 `PROTECTED_TASK_TYPES` 也没有包含这些类型
3. **stuck 检测无类型感知**：`monitor-loop.js` 的 `STUCK_THRESHOLD_MINUTES=5` 对所有任务一刀切，而 Harness Generator 合法运行 13+ 分钟，Evaluator 合法运行 4+ 分钟
4. **evaluation.md 不持久化**：Evaluator 把 evaluation.md 写在本地 worktree，没有 git commit+push，sprint_fix Generator 读不到上一轮的问题列表

### 下次预防

- [ ] 新增保护性系统时，先列出"哪些任务类型不应该被误杀"，同时更新：escalation.js、task-cleanup.js、monitor-loop.js
- [ ] 双标准或多信号系统（数值 + 模式）必须在合并点加 conflict guard，防止信号矛盾时采用激进策略
- [ ] Monitor stuck 检测必须感知任务类型，对长时间合法运行的任务（Generator/Evaluator）用独立阈值
- [ ] Evaluator 写完关键文件（evaluation.md）后必须立即 git commit+push，确保文件在分支上持久化
- [ ] 添加新的 pipeline task_type 时，同步更新所有"白名单/保护列表"文件（用 grep 搜索现有列表确保覆盖）
