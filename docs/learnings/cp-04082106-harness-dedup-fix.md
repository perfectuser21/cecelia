# Learning — Harness 链路 dedup 断链根因

## 根本原因

Harness pipeline 中所有中间任务（Contract Propose/Review/Generator/Evaluator 等）使用固定通用标题（`[Contract] P1`）+ null goal_id + null project_id 组合。`createTask` 的 dedup 检查：
```sql
WHERE title=$1 AND goal_id IS NOT DISTINCT FROM $2 AND project_id IS NOT DISTINCT FROM $3
  AND (status IN ('queued','in_progress') OR (status='completed' AND completed_at > NOW() - INTERVAL '24 hours'))
```
24 小时内同功能 E2E 测试的第二次运行会命中已完成的旧任务，返回旧任务 ID 而不创建新任务，导致链路完全断裂。

## 下次预防

- [ ] harness 链路任务标题必须含 `plannerShort`（planner_task_id 前 8 字符）唯一后缀
- [ ] 新增 harness 任务类型时必须同步添加 `— \${plannerShort}` 后缀
- [ ] E2E 测试怀疑链路断裂时，首先检查 24h 内同标题任务是否存在（dedup 命中）
