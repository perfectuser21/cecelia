# Learning: Slot Allocator 双源计数修复

## 分支
cp-03191420-fix-slot-dual-count

## 变更摘要
slot-allocator 中 totalRunning 改为取 ps 检测与 DB 计数的较大值（保守策略）。

### 根本原因
ps 进程检测和 DB status 查询是两个独立数据源，进程崩溃后 DB 更新有延迟，导致 ps 看到的进程数少于实际 in_progress 任务数，可能过度派发。

### 下次预防
- [ ] 涉及并发控制的代码，始终取保守值（多个数据源取 max）
- [ ] 新增并发相关改动时检查数据源一致性
