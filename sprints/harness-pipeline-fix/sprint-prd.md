# Sprint PRD — Harness Pipeline 编排 Bug 修复 + 稳定性保障

## 背景

Harness v4.0 三层架构（Planner → GAN → Generator/CI）在多 Workstream 串行链场景下存在 7 个已知 Bug，涉及 report 触发时机错误、goal_id 校验绕过缺失、contract_branch 空值 guard 缺失、report payload 缺字段、串行链幂等保护缺失。此外 harness_report 模型配置为 Sonnet 过重，应降级为 Haiku。这些问题导致 harness pipeline 在生产环境不可靠，需要一次性修复并加入回归测试。

## 目标

修复 execution.js 中 harness pipeline 编排链路的 7 个已知 Bug，确保多 Workstream 串行执行、report 触发、goal_id 校验、contract_branch guard、payload 完整性、幂等保护全部正确；同时将 harness_report 模型降级为 Haiku，并新增 brain test 保证回归不发生。

## 功能列表

### Feature 1: Report 触发时机修复
**用户行为**: 用户通过 harness 编排多 Workstream（WS1 → WS2 → WS3）串行执行
**系统响应**: harness_report 只在最后一个 WS 完成时创建（`currentWsIdx === totalWsCount`），中间 WS 完成时仅触发下一个 WS
**不包含**: 改变 WS 执行顺序或并行化

### Feature 2: goal_id 校验绕过
**用户行为**: 串行 WS 链创建新任务（WS2/WS3）时，系统自动传递 goal_id
**系统响应**: 串行 WS 链使用 `execution_callback_harness` 作为 trigger_source，绕过 actions.js 中 goal_id 必填校验白名单
**不包含**: 改变 goal_id 校验的核心逻辑

### Feature 3: contract_branch 空值 Guard
**用户行为**: harness_contract_review 返回 APPROVED 但 result 中无 contract_branch
**系统响应**: 系统打印 `[P0][execution-callback]` 错误日志并 return，不创建必然失败的 Generator 任务
**不包含**: 自动修复缺失的 contract_branch

### Feature 4: Report Payload 补全
**用户行为**: harness pipeline 走完 → 创建 harness_report 任务
**系统响应**: report 任务 payload 包含完整字段：`sprint_dir`, `planner_task_id`, `pr_url`, `project_id`, `goal_id`, `eval_round`, `harness_mode`
**不包含**: report 内容格式变更

### Feature 5: 串行链幂等保护
**用户行为**: 因网络重试或 callback 重复调用，同一 WS 的触发被发送多次
**系统响应**: 创建 WS{N+1} 前查 DB 检查是否已存在同 `planner_task_id` + `workstream_index` 且状态为 `queued`/`in_progress` 的任务，存在则跳过
**不包含**: 修改 execution-callback 顶层幂等（run_id + status 去重）

### Feature 6: harness_report 模型降级
**用户行为**: harness pipeline 完成后自动生成报告
**系统响应**: harness_report 使用 Haiku 模型（report 是汇总任务，不需要 Sonnet 级推理能力）
**不包含**: 改变其他 harness 任务的模型配置

### Feature 7: 回归测试
**用户行为**: 开发者修改 harness pipeline 代码
**系统响应**: `harness-pipeline.test.ts` 覆盖以上 6 个修复点，CI 自动回归校验：report 触发时机、goal_id 绕过、contract_branch guard、幂等检查、模型配置
**不包含**: 集成测试或端到端测试

## 成功标准

- harness_report 任务仅在 `currentWsIdx === totalWsCount` 时创建
- `execution_callback_harness` 在 actions.js goal_id 白名单中
- contract_branch=null 时打印 P0 日志并 return，不创建 Generator
- harness_report payload 包含 `sprint_dir`, `planner_task_id`, `pr_url`, `project_id`, `goal_id`
- 串行链创建 WS{N+1} 前有 DB 幂等查询（`status IN ('queued','in_progress')`）
- model-profile.js 中 harness_report 映射到 `claude-haiku-4-5-20251001`
- `harness-pipeline.test.ts` 通过且覆盖以上所有检查点

## 范围限定

**在范围内**:
- execution.js harness callback 链路修复（Feature 1-5）
- model-profile.js harness_report 模型配置（Feature 6）
- harness-pipeline.test.ts 回归测试（Feature 7）

**不在范围内**:
- harness-watcher.js（CI watch / deploy watch 链路不在本次修复范围）
- harness v4 架构变更
- sprint_* 系列任务（sprint_planner/sprint_generate/sprint_evaluate 等旧版本链路）
- 前端 dashboard 相关变更

## 预期受影响文件

- `packages/brain/src/routes/execution.js`：harness callback 链路核心，Feature 1-5 全部在此文件修复
- `packages/brain/src/model-profile.js`：harness_report 模型配置，Feature 6
- `packages/brain/src/actions.js`：goal_id 校验白名单，Feature 2
- `packages/brain/src/__tests__/harness-pipeline.test.ts`：回归测试，Feature 7
