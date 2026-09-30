## Brain {VERSION} — 价值流建模③：workflows 真表 + 骨干活动挂 workflow/executor/enabler + ops_workflows.workflow_id（决策 3e867cad 第 4-5 张表 / 752b7166）

- 迁移 494：新表 `workflows`（Capability × 渠道/形态的可执行链条；`capability_id` 触发器守卫只允许有父的 journey）；`journey_steps` 加 `workflow_id` / `executor_kind`(code|agent|human) / `enabler_id`（Call Activity），不删 `journey_id`；`backbone_activities` 视图带出 capability_key / activity_key 与三列；`ops_workflows.workflow_id`（n8n 画布降为 Workflow 的运行时实现，覆盖 09-07 定义）。词表 f425e3fd，任务 ce41cd59。
- 回填（幂等）：智能获客价值流下建 capability「关键词获客」「对标获客」与 workflow「抖音·关键词获客」「抖音·对标获客」；8 个 3.0 骨干活动挂抖音·关键词获客，executor_kind 判定/评分=agent 其余=code；enabler 种子 `device_lock` / `account_selfcheck`，预检、收尾 enabler_id=device_lock，enabler_calls 三条。
- 新只读 API `GET /api/brain/workflows`（capability_id / value_stream_id / status 过滤，带 capability_name、value_stream_id、activity_count）。
- 新 smoke `vs-model-workflows-smoke.sh`（迁移/回滚结构 + 路由接线 + 可选真库），回滚 `rollback/494_vs_model_workflows.down.sql`。
