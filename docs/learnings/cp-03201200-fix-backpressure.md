# Learning: Backpressure 与动态 slot 矛盾
## 分支
`cp-03201200-fix-backpressure`
### 根本原因
BACKPRESSURE_BURST_LIMIT=1 和动态 slot/pressure/alertness 三层防雪崩完全重复。7 个空闲 slot 但每 tick 只派 1 个。
### 下次预防
- [ ] 新增限流机制前检查是否和现有机制重复
- [ ] 所有限流参数从 brain_config 读取，不硬编码
