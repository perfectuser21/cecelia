# Sprint PRD — Harness Pipeline 编排 Bug 修复 + 回归测试

## 背景

Harness v4.0 pipeline 在多 Workstream 场景下暴露出多个编排缺陷：Report 提前触发导致 PR 信息缺失、goal_id 校验阻断 harness 任务创建、contract_branch 为 null 时 Generator 崩溃、Report payload 字段不完整、串行链 callback 重复触发造成任务重复。此外 harness_report 使用 Opus 模型成本过高，应降级为 Haiku。这些问题在生产运行中已被观察到，需要系统性修复并建立回归测试防护网。

## 目标

消除 harness pipeline 多 Workstream 编排中的 7 个已知 Bug，将 harness_report 模型降级为 Haiku，并通过 brain test 保证这些修复不会回归。

## 功能列表

### Feature 1: WS Report 触发时机修复
**用户行为**: 用户启动一个包含多个 Workstream 的 harness sprint
**系统响应**: harness_report 任务仅在最后一个 Workstream（WS_n/WS_n）完成后创建，中间 Workstream 完成时只记录日志，不触发 report
**不包含**: 不改变单 Workstream sprint 的行为

### Feature 2: goal_id 校验绕过
**用户行为**: harness pipeline 自动创建子任务（generate/evaluate/report 等）
**系统响应**: harness 链式任务使用 `execution_callback_harness` trigger 绕过 goal_id 校验，因为 harness 任务不挂靠 OKR goal
**不包含**: 不影响非 harness 任务的 goal_id 校验逻辑

### Feature 3: contract_branch null guard
**用户行为**: Reviewer APPROVED 合同后，系统创建 Generator 任务
**系统响应**: 当 contract_branch 为 null 时，系统终止链式触发并记录 P0 级错误日志，而非崩溃或创建无效任务
**不包含**: 不自动重试或修复 null branch 问题

### Feature 4: Report payload 完整性
**用户行为**: pipeline 到达 report 阶段
**系统响应**: harness_report 任务的 payload 包含所有必需字段：sprint_dir、pr_url、dev_task_id、planner_task_id、project_id、eval_round、harness_mode
**不包含**: 不改变 report 生成模板本身

### Feature 5: 串行链幂等保护
**用户行为**: execution callback 因网络重试或其他原因被重复调用
**系统响应**: 系统在创建下一个 Workstream 任务前检查是否已存在同 project_id + task_type + workstream_index 的 queued/in_progress 任务，存在则跳过
**不包含**: 不改变 decision_log 层面的幂等逻辑

### Feature 6: harness_report 模型降级为 Haiku
**用户行为**: harness_report 任务被调度执行
**系统响应**: Brain 路由 harness_report 任务时使用 Haiku 模型，而非默认的 Opus
**不包含**: 不影响其他 harness 任务类型的模型选择

### Feature 7: Brain 回归测试
**用户行为**: 开发者修改 execution.js 后运行测试
**系统响应**: 新增的 brain test 覆盖以上 6 个场景的关键路径，任一修复被意外回退时测试失败
**不包含**: 不做端到端集成测试，只做单元级关键路径验证

## 成功标准

- harness pipeline 多 WS（>=2）场景下，report 仅在最后一个 WS 完成后触发一次
- harness 链式任务创建不因 goal_id 缺失而被拒绝
- contract_branch 为 null 时 pipeline 优雅终止，不产生无效 Generator 任务
- harness_report payload 包含 sprint_dir/pr_url/dev_task_id/planner_task_id/project_id/eval_round/harness_mode 全部 7 个字段
- 重复 callback 不产生重复的 Workstream 任务
- harness_report 任务使用 Haiku 模型执行
- `vitest packages/brain/src/__tests__/harness-pipeline.test.ts` 全部通过，覆盖上述 6 个场景

## 范围限定

**在范围内**:
- `packages/brain/src/routes/execution.js` 中 harness callback 处理逻辑的修复
- harness_report 模型路由配置变更
- `packages/brain/src/__tests__/harness-pipeline.test.ts` 回归测试新增/补充
- BRAIN_QUIET_MODE 降噪（如与上述修复有耦合）

**不在范围内**:
- Harness SKILL.md 模板内容修改
- 前端 Dashboard 展示变更
- Sprint 流程（planner/proposer/reviewer）逻辑变更
- CI workflow 变更

## 预期受影响文件

- `packages/brain/src/routes/execution.js`：核心修复文件，包含 WS Report 触发、goal_id 绕过、contract_branch guard、payload 完整性、串行链幂等保护
- `packages/brain/src/task-router.js`：harness_report 模型路由配置（改为 Haiku）
- `packages/brain/src/__tests__/harness-pipeline.test.ts`：回归测试新增/补充
- `packages/workflows/skills/harness-report/SKILL.md`：可能需要声明模型偏好（待 Proposer 确认）
