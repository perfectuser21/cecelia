# Learning: 移除 Stage 3 Playwright Evaluator

**分支**: cp-03300729-remove-playwright-evaluator
**日期**: 2026-03-30

## 背景

从 /dev pipeline Stage 3 移除 Playwright Evaluator 步骤，简化开发流程。

### 根本原因

Playwright Evaluator 作为 Stage 3 的 pre-merge gate 增加了流程复杂度，且 DoD [BEHAVIOR] 验证可以在 post-merge 阶段触发，不需要阻塞 PR 合并流程。

### 下次预防

- [ ] 新增 devloop-check.sh 条件时，确保有对应的移除路径文档
- [ ] 流程步骤变更时，同步更新 SKILL.md 中的流程图描述
