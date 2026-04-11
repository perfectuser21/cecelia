### 根本原因

harness-watcher.js 和 execution.js 在创建下游 harness 任务（harness_report / harness_fix）时，payload 构建对象未包含 `contract_branch` 字段，导致 Report skill 无法感知当前合同所在的 branch，pipeline 上下文断裂。涉及 4 条路径：CI通过→report、CI失败→fix、harness_fix→report、harness_generate(最后WS)→report。

### 下次预防

- [ ] 新增 harness 任务创建点时，检查 payload 是否透传了 contract_branch、planner_task_id、sprint_dir 三元组
- [ ] harness pipeline 相关 payload 字段变动时，更新 sprint-contract.md Feature 1 中的路径清单
