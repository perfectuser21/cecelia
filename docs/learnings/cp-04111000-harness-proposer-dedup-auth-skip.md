# Learning: harness Proposer 去重 + auth 失败不计 quarantine

**Branch**: cp-04101855-71b1dd76-3cc4-49a8-9b91-ab6ab9
**Date**: 2026-04-11

### 根本原因

1. **Proposer 重复派发**：harness_planner 完成 callback 时，Layer 1 逻辑直接调 `createHarnessTask` 创建 Proposer，没有先检查同 `planner_task_id` 是否已有 `queued/in_progress` 的同类任务。Planner 重试场景会导致同一 pipeline 出现多个 Proposer 并行。

2. **auth 失败累计 quarantine**：`handleTaskFailure` 会对任何失败递增 `failure_count`，当 auth（凭据失效）连续触发 3 次时，任务进隔离区。但 auth 失败是基础设施问题，应由熔断器处理，不应累计到 quarantine 阈值。

### 下次预防

- [ ] 新增任何"Planner 完成 → 子任务派发"逻辑时，先加去重查询（参考 architecture_design/initiative_plan 的去重模式）
- [ ] `handleTaskFailure` 调用处需区分"任务本身失败"（累计计数）和"基础设施失败"（不累计）：auth/network/rate_limit 属后者，传 `skipQuarantine=true`
- [ ] DoD 中使用模板字符串生成的日志片段时，检查静态部分（如 `already queued for planner`）而非变量占位部分
