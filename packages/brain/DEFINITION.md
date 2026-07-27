# Brain 模块定义

**版本**: 1.267.93

## Kernel Harness F1 基线

- 固定复用 `Cecelia Harness Pipeline` Journey，并以幂等投影补齐 S0-S12。
- 历史 Planner/GAN/Generator/Evaluator/Final E2E ID 与 Notion 关联原样保留；
  同 stage 历史别名通过 mapping gap 字段显式暴露。
- 根 `regression-contract.yaml` 是 143 个 element cells 与 legacy P0/P1
  映射的唯一权威来源；派生审计报告明确非权威。
- endpoint 账本语义延伸到 production verified、rollback anchor 与
  report/learning，但本版本不修改 merge/staging/production 运行时状态机。

## Kernel attempt telemetry

- `harness_attempts` 以 additive migration 361 增加 logical cycle、attempt kind、retry lineage、restart reason、workstream 与 derived 时间来源。
- attempt 生命周期在 `starting` 首次记录 `started_at`，且仅在终态写 `completed_at`。
- `GET /api/brain/harness/tasks/:task_id/attempt-telemetry` 必须由 `x-tenant-id + task_id` 双作用域查询，响应采用字段白名单。
- orphan 的结构化收口区分 resume 返回 `null`、`false`、成功 child lineage 与 live lease owner fencing。
- Kernel action 路由与批准合同冻结语义不变。
