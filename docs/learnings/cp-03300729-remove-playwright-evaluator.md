# Learning: 移除 Stage 3 Playwright Evaluator

**分支**: cp-03300729-remove-playwright-evaluator
**日期**: 2026-03-30

## 背景

从 /dev pipeline Stage 3 移除 Playwright Evaluator 步骤，简化开发流程。

### 根本原因

Playwright Evaluator 作为 Stage 3 的 pre-merge gate 增加了流程复杂度。
具体问题：每次 /dev 都需要等 evaluator 运行并生成 seal 文件，增加了 10-30s 延迟。
DoD [BEHAVIOR] 条目的验证可以在 post-merge 阶段异步触发，不需要阻塞 PR 合并流程。
涉及文件：03-integrate.md（步骤定义）、devloop-check.sh（条件 4.5 检查逻辑）。

### 下次预防

- [ ] 新增 devloop-check.sh 条件时，确保有对应的移除路径文档
- [ ] 流程步骤变更时，同步更新 SKILL.md 中的流程图描述
