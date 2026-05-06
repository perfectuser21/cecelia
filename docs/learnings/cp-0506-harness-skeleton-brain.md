# Learning: harness-skeleton-brain — initiative_runs.journey_type

### 根本原因
Harness pipeline 缺少 journey_type 持久化，导致 Proposer/Generator 无法从 DB 读取 journey type，只能靠 skill 提示词记忆（容易遗忘）。

### 下次预防
- [ ] 新增 task-plan.json 字段时，同步检查：1）parseTaskPlan 是否透传；2）graph.js INSERT 是否写入；3）routes GET 是否返回
- [ ] migration 编号在 PR 前先 ls migrations/ 确认无冲突
