# Learning: Scope 飞轮并发安全修复

### 根本原因
scope_plan INSERT 缺少 ON CONFLICT DO NOTHING，并发 tick 可能重复创建任务。project_plan 有但 scope_plan 漏了。

### 下次预防
- [ ] 所有飞轮触发的 INSERT tasks 必须加 ON CONFLICT DO NOTHING
- [ ] closer 函数的状态检查应覆盖 active + in_progress 两种状态
