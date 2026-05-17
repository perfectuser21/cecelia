# Planner Scope 调度链

### 根本原因
Planner 调度链缺少 Scope 层感知，从 Project 直接跳到 Initiative，导致新加的 Scope 层无法参与调度。

### 下次预防
- [ ] 新增层级时检查 Planner 调度链是否覆盖
- [ ] 验证向后兼容性（无 Scope 数据时降级）
