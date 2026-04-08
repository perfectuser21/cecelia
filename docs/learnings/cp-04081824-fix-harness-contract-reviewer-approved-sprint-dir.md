# Learning: harness-contract-reviewer APPROVED 后 sprint-contract.md 文件可达性问题

**分支**: cp-04081824-fix-harness-contract-reviewer-approved-sprint-dir  
**日期**: 2026-04-08

---

### 根本原因

reviewer APPROVED 后，`sprint-contract.md` 只被 push 到独立分支 `cp-harness-review-approved-XXXX`，但后续的 `harness_generate`（走 /dev）和 `harness_evaluate` 都从 `planner_branch` 或 `main` 上读文件，导致找不到合同文件，整条 Harness pipeline 断链。

---

### 修复方案

在 APPROVED 分支的 Step 3 里，push review 分支之后，额外创建 `cp-harness-contract-XXXX` 分支（基于 `planner_branch`），将 `sprint-contract.md` 写入并 push，同时在最终 JSON payload 里增加 `contract_branch` 字段，让 harness_generate 和 harness_evaluate 知道从哪个分支读合同。

---

### 下次预防

- [ ] Harness pipeline 各阶段 Agent 产出文件时，必须同时考虑后续 Agent 从哪个分支读
- [ ] 分支间文件传递要在 payload 的 result 字段里显式声明 `*_branch` 字段
- [ ] 新增 Harness skill 时，在 SKILL.md 里明确说明"输出物写到哪个分支"
