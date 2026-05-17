# 信号统一走 suggestions 表

### 根本原因

Rumination 和 Desire 系统直接调用 createTask() 绕过 Planner 链路，产生无 goal_id / project_id 的孤儿任务。这些任务不挂 OKR 树，无法被 Planner 的 KR→Project→Scope→Initiative 调度链管理。

### 下次预防

- [ ] 新增信号源时，必须走 suggestions 表而不是直接 createTask
- [ ] Code Review 检查：任何直接 INSERT INTO tasks 的调用必须标注 trigger_source 并说明为什么不走 suggestions
- [ ] 定期审计 tasks 表中 goal_id IS NULL 的非系统任务，发现孤儿即修复
