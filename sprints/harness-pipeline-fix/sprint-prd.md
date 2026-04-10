# Sprint PRD — Harness Pipeline 编排 Bug 修复 + 稳定性保障

## 背景

Harness pipeline 在多 Workstream 场景下存在多个编排缺陷：report 被重复触发、串行链无幂等保护导致 WS 重复创建、关键字段（goal_id / contract_branch / payload）缺校验或缺失。这些问题会导致重复报告、孤岛任务、错误分支上的代码生成，影响 pipeline 可靠性。

## 目标

让 Harness pipeline 在多 WS 串行编排下稳定、幂等、数据完整，消除重复触发和字段缺失问题。

## 功能列表

### Feature 1: WS Report 触发去重
**用户行为**: 一个 WS 完成后，pipeline 自动触发 harness_report
**系统响应**: 同一个 WS 只生成一份 harness_report 任务，无论完成回调被触发几次（execution.js generate 完成、fix 完成、harness-watcher CI 通过、deploy 完成四个路径）
**不包含**: 不改变 report 的内容或格式

### Feature 2: goal_id 校验
**用户行为**: pipeline 创建 harness 子任务（report/generate/fix 等）
**系统响应**: 创建子任务前校验 goal_id 是否有效（非 null 且对应 objective 存在），无效时记录警告并使用 planner 任务的 goal_id 作为 fallback
**不包含**: 不修改 goal_id 的业务语义

### Feature 3: contract_branch Guard
**用户行为**: Reviewer 审批合同后，pipeline 创建 harness_generate 任务
**系统响应**: 校验 contract_branch 非 null 且非空字符串。若无效，记录错误日志并中止该 WS 的 generate 创建（而非传递 null 让 Generator 在错误分支上工作）
**不包含**: 不修改 contract_branch 的提取逻辑本身

### Feature 4: Report Payload 字段补全
**用户行为**: harness-watcher（CI 通过 / Deploy 完成）创建 harness_report
**系统响应**: 所有 harness_report 创建路径的 payload 统一包含：sprint_dir、pr_url、dev_task_id、planner_task_id、eval_round、harness_mode。缺失字段从关联任务链中回溯获取
**不包含**: 不增加新的 payload 字段

### Feature 5: 串行链幂等保护
**用户行为**: 一个 WS 的 harness_generate 完成后，pipeline 触发下一个 WS
**系统响应**: 创建下一个 WS 的 harness_generate 前，检查是否已存在同 sprint_dir + 同 workstream_index 的 queued/in_progress 任务。若已存在则跳过创建，记录日志
**不包含**: 不改变串行链的顺序逻辑

### Feature 6: harness_report 模型降级为 Haiku
**用户行为**: harness_report 任务被调度执行
**系统响应**: 使用 claude-haiku-4-5-20251001 模型执行（而非当前的 claude-sonnet-4-6），降低成本
**不包含**: 不影响其他 harness 任务类型的模型选择

## 成功标准

- 标准 1: 同一个 WS 的 harness_report 任务在任何路径下只创建一次（去重查询可验证）
- 标准 2: goal_id 为 null 的 harness 子任务不再被创建（有 fallback 或拒绝创建）
- 标准 3: contract_branch 为 null 时 harness_generate 不被创建，日志有明确错误信息
- 标准 4: harness-watcher 创建的 harness_report payload 包含 dev_task_id、pr_url、eval_round
- 标准 5: 串行链中同 workstream_index 的 generate 任务不会重复创建
- 标准 6: model-profile.js 中 harness_report 对应 claude-haiku-4-5-20251001
- 标准 7: 新增 brain test 覆盖以上 6 个场景，vitest 全部通过

## 范围限定

**在范围内**:
- packages/brain/src/routes/execution.js 编排逻辑修复
- packages/brain/src/harness-watcher.js payload 补全
- packages/brain/src/model-profile.js 模型配置修改
- packages/brain/src/__tests__/ 新增回归测试

**不在范围内**:
- Harness skill 文件（SKILL.md）的修改
- 前端 Dashboard 的修改
- harness_report skill 的报告内容/格式调整
- task-router.js 路由映射调整

## 预期受影响文件

- `packages/brain/src/routes/execution.js`：WS report 去重、goal_id 校验、contract_branch guard、串行链幂等保护（行 1835-2035 区域）
- `packages/brain/src/harness-watcher.js`：report payload 字段补全（行 130-144、332-349）
- `packages/brain/src/model-profile.js`：harness_report 模型从 sonnet 改为 haiku（行 77）
- `packages/brain/src/__tests__/harness-pipeline-stability.test.js`（新增）：覆盖 6 个修复场景的回归测试
