---
branch: cp-04082227-09d000fa-e553-4afd-897d-21a75f
date: 2026-04-08
---

# Learning: GAN pipeline 分支参数断链修复

### 根本原因

GAN 对抗链路中，分支参数未随 payload 正确传递，导致三处断链：

1. **execution.js REVISION handler**：下一轮 Proposer payload 缺 `planner_branch`（P2+ Proposer 读不到 PRD）和 `review_branch`（不知道从哪读 Reviewer 反馈）
2. **execution.js review 创建**：Reviewer payload 缺 `propose_branch`（不知道从哪读 Proposer 写的 `contract-draft.md`）
3. **executor.js Reviewer**：硬编码从 `plannerBranch` 读 `contract-draft.md`，而 contract-draft 实际由 Proposer 写在自己的分支

### 下次预防

- [ ] GAN 链路中每个 agent 完成后，必须在 result 中返回 `branch` 字段，供下游 callback 提取传递
- [ ] 新增 harness 类型时，review 创建和 REVISION 两处 payload 都需要检查：**上游所有分支都传到了吗？**
- [ ] executor.js `_buildPromptForTask` 中：读文件时区分 plannerBranch（存 PRD）vs proposeBranch（存 contract-draft）
- [ ] 三处 `plannerBranch || 'main'` fallback 都是隐患：空分支 fallback 到 main 会静默读到旧/错误文件，不会报错
