# Learning: 修复 heartbeat 垃圾循环

分支: cp-03211400-fix-heartbeat-loop
日期: 2026-03-21

## 发现

dept_heartbeat 任务类型不在 executor.js 的 US_ONLY_TYPES 集合中，导致被路由到 Codex Bridge 执行失败。
同时 dept-heartbeat.js 防重复检查不包含 'quarantined' 状态，隔离后立刻创建新任务，形成垃圾循环。

### 根本原因

1. **路由遗漏**：新增 dept_heartbeat 任务类型时，忘记将其加入 US_ONLY_TYPES 集合，导致默认走 Codex Bridge 路由
2. **状态盲区**：防重复 SQL 只检查 queued/in_progress，不检查 quarantined 状态。quarantined 的任务被视为"不存在"，触发重复创建

两个 bug 叠加形成循环：创建 -> 错误路由 -> 执行失败 -> quarantined -> 防重复检查不到 -> 再创建

### 下次预防

- [ ] 新增任务类型时，检查 US_ONLY_TYPES 是否需要更新
- [ ] 防重复 SQL 应考虑所有"占位"状态（queued/in_progress/quarantined），而不仅是活跃状态
- [ ] 增加 quarantined 任务数量监控告警，超阈值时及时发现循环问题
