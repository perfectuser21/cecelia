# Learning: Sprint Contract CI 兼容性约束

**分支**: cp-03300729-evaluator-ci-align
**日期**: 2026-03-30

## 变更摘要
为 spec-review SKILL.md 的 Sprint Contract 双向协商机制新增 CI 兼容性硬约束，限制 Evaluator 独立生成的测试方案只能使用 CI 环境可执行的命令。

### 根本原因
Evaluator（spec_review subagent）在独立生成测试方案时，可能写出浏览器点击行为、UI 交互描述等 CI 环境无法执行的验证标准。这导致 Sprint Contract 中约定的验证标准与 CI 实际执行的检查不一致。

### 下次预防
- [ ] 新增 prompt 约束时，检查是否与现有维度 D/E 的规则一致（本次一致）
- [ ] packages/workflows/ 子目录开发时需在 packages/workflows/ 目录也放 PRD/Task Card（branch-protect 的 find_prd_dod_dir 从文件路径向上查找）
- [ ] feat PR 必须带 .test.ts 文件，即使改动只是 prompt 文本
