# Learning: DB 连接池保护 + Circuit Breaker 缩短 + tick lock 并发修复

## 变更概要
修复 Brain 运行时三个稳定性隐患。

### 根本原因
1. DB 连接池 max=20 在 tick 高负载时可能耗尽连接
2. Circuit Breaker 冷却 30 分钟过长，单次失败后系统长时间不可用
3. tick lock 超时时强制释放，导致两个 tick 并发执行产生竞态条件

### 下次预防
- [ ] DB 连接池参数应根据并发量设定合理上限
- [ ] Circuit Breaker 冷却时间应与故障恢复时间匹配，避免过长
- [ ] 并发锁超时应选择安全策略（跳过而非释放）
