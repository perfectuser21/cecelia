---
id: learning-cp-03311024-pipeline-rerun-fix
created: 2026-03-31
branch: cp-03311024-pipeline-rerun-fix
---

# Learning: Pipeline 重跑幂等检查错误包含 completed 状态（2026-03-31）

## 根本原因

`_startOnePipeline` 的幂等检查设计初衷是防止在 pipeline 已有活跃子任务时重复创建，
但查询条件错误地包含了 `completed` 状态（`status IN ('queued', 'in_progress', 'completed')`）。
当用户对已完成的 pipeline 触发重跑时，系统查到旧的 completed content-research 子任务，
误判为"已有任务在飞"，跳过新子任务的创建，同时将 pipeline 标记为 `in_progress`。
此后 pipeline 永远停在 `in_progress`，因为没有任何子任务在推进，形成死锁。
根本原因是幂等检查的语义边界不清：只有「活跃中」的子任务才应阻止重复创建，
历史完成的子任务不属于"已在飞"范畴，不应影响重跑逻辑。

## 下次预防

- [ ] 幂等检查只包含活跃状态（queued/in_progress），禁止将终态（completed/failed/cancelled）纳入阻止条件
- [ ] 新增 pipeline 启动逻辑时，明确定义"活跃"与"历史"的语义边界，并在代码注释中说明
- [ ] 重跑功能上线前，需验证重跑场景：旧子任务已 completed → 新子任务应被创建（not skipped）
- [ ] SQL 幂等查询应有对应的 unit test 覆盖，覆盖 completed 子任务存在时不阻止重跑的场景

## 修复概述

将 `content-pipeline-orchestrator.js` 第 116 行幂等检查从：
```sql
AND status IN ('queued', 'in_progress', 'completed')
```
改为：
```sql
AND status IN ('queued', 'in_progress')
```
