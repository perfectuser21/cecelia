# Learning: GAN pipeline P2+ 缺失 planner_branch/review_branch/propose_branch

## 根本原因

execution.js 的 REVISION handler 创建下一轮 Proposer 任务时，未传递 `planner_branch`（导致 P2+ 读不到 PRD）和 `review_branch`（导致 P2+ 读不到反馈），GAN 陷入盲目循环——Proposer 每轮写的合同雷同，Reviewer 永远 REVISION。

executor.js 的 Reviewer prompt 从 `plannerBranch` 读 `contract-draft.md`，但合同草案在 `proposeBranch`（Proposer push 的分支），Reviewer 看不到合同。

## 下次预防

- [ ] 每次 harness pipeline 任务创建时，检查 payload 中所有"前序分支"字段（planner_branch/propose_branch/review_branch/contract_branch）是否完整传递
- [ ] executor.js 的 `_fetchSprintFile` 调用必须使用正确分支：PRD 在 planner_branch，contract-draft 在 propose_branch，review-feedback 在 review_branch
- [ ] 任务 payload 设计原则：每个任务需要读哪个分支，就必须在 payload 里带哪个分支名
