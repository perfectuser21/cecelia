# PRD: Harness v3.1 — 修复 GAN 链路 4 个断链问题

## 背景

Harness v3.0 流水线运行中发现 4 个关键断链问题，导致 GAN 对抗无法完整端到端跑通：

1. **sprint_report 路由缺失**：task-router 已映射 sprint_report，但 /sprint-report skill 未部署到 headless account 目录
2. **Contract GAN 无保护机制**：contract_propose ↔ review 对抗循环无截断保护（v3.1 目标：无上限，直到 APPROVED）
3. **Contract Draft 跨 worktree 不可见**：Proposer 写完 contract-draft.md 未 git push，Reviewer 在另一 worktree 读不到
4. **v3.1 测试覆盖空白**：现有测试仍是 v2.0 流程（arch_review 结尾），不覆盖 GAN 层和 sprint_report

## 目标

修复上述 4 个断链，确保整个 Planner → Contract 对抗 → Generator → Evaluator → Report 流程可稳定端到端跑通。

## 成功标准

- sprint_report task_type 在 task-router 和 skills-index 中均有映射
- Contract GAN 无上限对抗（不设 MAX_CONTRACT_ROUNDS，只有 APPROVED 才停）
- contract-draft.md 写完后立即 git push，Reviewer 可跨 worktree 读取
- harness-sprint-loop-v3 测试覆盖 10 个链路节点
