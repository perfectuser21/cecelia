# Learning: Sprint Contract CI 兼容性约束

**分支**: cp-03300729-evaluator-ci-align
**日期**: 2026-03-30

## 变更摘要
为 spec-review SKILL.md 的 Sprint Contract 双向协商机制新增 CI 兼容性硬约束，限制 Evaluator 独立生成的测试方案只能使用 CI 环境可执行的命令。

### 根本原因
Sprint Contract 双向协商机制中，Evaluator 独立生成测试方案时缺少 CI 环境约束。
具体表现：Evaluator 可能写出"打开浏览器点击按钮确认"、"在 UI 上查看结果"等人工操作描述。
这些验证方案在 ubuntu CI runner 上无法执行，导致 Sprint Contract 约定的标准与 CI 实际能力脱节。
根源在于 Sprint Contract 执行流程只要求"遵循测试层规则"，但没有约束验证形式必须是 CI 可执行的命令。

### 下次预防
- [ ] 新增 prompt 约束时，检查是否与现有维度 D/E 的规则一致（本次一致）
- [ ] packages/workflows/ 子目录开发时需在 packages/workflows/ 目录也放 PRD/Task Card（branch-protect 的 find_prd_dod_dir 从文件路径向上查找）
- [ ] feat PR 必须带 .test.ts 文件，即使改动只是 prompt 文本
