# Learning: Brain 每日自检反思调度器

## 任务

为 Brain 添加每日自检反思机制，分析 dev_execution_logs 和 learnings 数据，自动发现反复问题并创建修复任务。

### 根本原因

Brain tick loop 只负责任务派发，缺少对执行结果的回顾分析。dev_execution_logs 和 learnings 数据持续积累但无人消费，导致同样的问题反复出现却没有被系统性地识别和修复。

### 下次预防

- [ ] 新增调度功能时，检查 UTC 时间窗口是否与现有调度冲突（code-review 02:00, contract-scan 03:00, reflection 04:00）
- [ ] SQL 查询中的时间间隔用参数化查询 `$1::interval` 而非字符串模板，防止 SQL 注入
- [ ] 参考 daily-review-scheduler.js 的模式（isInWindow + hasToday + trigger）保持一致性
