# Learning: 背压阈值 5 导致正常任务卡死系统

分支: cp-03212309-fix-backpressure
日期: 2026-03-21

### 根本原因

BACKPRESSURE_THRESHOLD=5 太低。注册 7 个 KR 拆解任务后队列超过 5，触发背压，系统完全停止派发。

### 下次预防

- [ ] 背压阈值应该和 physical_capacity 成比例，不应该是写死的小数字
- [ ] 添加告警：当 dispatch_allowed=false 超过 10 分钟时通知用户
