# Learning — cp-04112334-pipeline-step-detail

**Branch**: cp-04112334-pipeline-step-detail  
**Task**: Pipeline 全链路详情页 Input/Prompt/Output 三栏视图

### 根本原因

harness 各任务的"产出分支"不存储在自身的 `task.result.branch` 字段，而是分散在：
- propose 任务 → `result.propose_branch`
- review 任务 → `result.review_branch`
- planner 任务 → 不直接存，需从第一个 propose 任务的 `payload.planner_branch` 反向查找

同理，review 任务的 `payload.propose_branch` 常为 null，需通过 `payload.propose_task_id` 再查该 propose 任务的 `result.propose_branch`。

### 下次预防

- [ ] Harness executor 写 propose/review 结果时，统一通过 `result.branch` 字段暴露产出分支（现在是 propose_branch/review_branch 两个不同字段）
- [ ] Harness executor 在创建 review 任务时，总是将 `propose_branch` 填入 `payload.propose_branch`（当前为 null）
- [ ] pipeline-detail API 读分支时，优先用 `result.propose_branch || result.review_branch`，planner 走 `plannerBranchFromPropose` 反向查找
