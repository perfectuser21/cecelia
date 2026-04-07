# Sprint PRD: 优化并稳固 Harness v3.1 流水线

**Planner Task**: 3217cdf0-e3b3-416e-af46-2a4d8bcdc609
**目标**: 用 Harness v3.1 自身来优化 Harness v3.1，找出流水线中不稳定的地方，加固断链逻辑，补充测试，让整个 Planner→Contract 对抗→Generator→Evaluator→Report 流程能稳定跑通并可在 CI 中验证。

---

## 识别出的 4 个断链/不稳定点

| # | 问题 | 根因 |
|---|------|------|
| Feature 1 | Sprint Report skill 缺失 | `/sprint-report` skill 存在于 `packages/workflows/skills/sprint-report/` 但未部署到 `~/.claude-account1/skills/`，task-router 已映射但执行时找不到 skill |
| Feature 2 | Contract 防死循环缺失 | `execution.js` 中 `sprint_contract_review REVISION → sprint_contract_propose` 循环无最大轮次保护（`MAX_REVISION_ROUNDS` 只在 initiative_verify 层有，GAN 层完全没有）|
| Feature 3 | Contract Draft 跨 worktree 不可见 | Proposer 写完 `contract-draft.md` 后不 git push，Reviewer 在另一个 worktree 中读不到此文件 |
| Feature 4 | v3.1 测试覆盖不足 | 现有 `harness-sprint-loop.test.js` 仍是 v2.0 流程（以 arch_review 结尾），不覆盖 GAN 层（contract propose/review 循环）和 sprint_report |
