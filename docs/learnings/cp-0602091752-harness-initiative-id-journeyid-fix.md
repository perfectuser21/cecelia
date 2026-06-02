# Learning: harness initiative_id 约定显式化 + journey_id 缺失早预警

### 根本原因
1. `initiativeId = task.id` 是隐含约定，代码里用 `payload.initiative_id || task.initiative_id || task.id` 兜底，LLM 写 "pending" 时虽有 parsePrd 警告但不强制纠正，传到 upsertTaskPlan 时可能用错误的 initiative_id 建 initiative_runs
2. `harness_initiative` 任务创建时 `journey_id` 缺失无任何提示，导致 `initiative_runs.journey_id = null`，Notion Project 游离无 Journey 关联，问题只在 Reporter 阶段才暴露

### 下次预防
- [ ] `prepInitiativeNode` 始终用 `task.id` 作为 `initiativeId`，不再读 payload 旧字段
- [ ] `dbUpsertNode` 在 `upsertTaskPlan` 前检验 `taskPlan.initiative_id === state.initiativeId`，不匹配时强制覆盖
- [ ] `POST /api/brain/tasks` 创建 `harness_initiative` 任务时，`payload.journey_id` 缺失则在 response 里加 `warnings` 字段
- [ ] harness-planner SKILL.md 明确说明 `$HARNESS_INITIATIVE_ID = task.id`
