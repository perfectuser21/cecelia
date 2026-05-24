# Learning — cp-0524153048-fix-harness-pipeline-brain-4issues

### 根本原因

task-router.js 有两张独立的路由表（VALID_TASK_TYPES + LOCATION_MAP），两者互不自动同步。harness_evaluate 在 SKILL_WHITELIST 中已注册，但因未双写另两张表导致路由校验失败。

### 下次预防

- [ ] 新增任务类型时，必须同时写 3 处：VALID_TASK_TYPES + LOCATION_MAP + SKILL_WHITELIST
- [ ] Planner 节点接收的 payload 字段必须在 runPlannerNode 中显式透传到 prompt/env，不能假设 agent 会自行查 Notion
- [ ] reportNode 只做状态回写不足以触发完整交付流程，必须派 harness_report 子任务走 6 步交付
