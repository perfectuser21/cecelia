# Learning: Brain Gate 路由注册 + initiative_plan 清理

## 背景
注册 4 个新 Codex Gate 路由，删除废弃的 initiative_plan 自动创建路径。

### 根本原因
系统中存在三条并行派发路径（pr_plans / initiative_plan / area_stream），互相矛盾。initiative_plan 的"边跑边规划"模式与 pr_plans 的"先规划后执行"模式冲突，导致重复任务创建。

### 下次预防
- [ ] 新增派发路径前先确认旧路径是否废弃
- [ ] 保持单一真实来源原则（SSOT）
- [ ] 定期审计 task_type 注册表，清理未使用的类型
