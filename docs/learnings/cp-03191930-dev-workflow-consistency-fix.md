# Learning: /dev 工作流步骤命名不一致导致流程永远无法终止

### 根本原因

2026年3月重构将 /dev 从 11 步模型合并为 6 步模型时，只更新了步骤文件（01-taskcard.md 到 05-clean.md），
但没有同步更新 devloop-check.sh（SSOT）、stop-dev.sh、cleanup.sh 和 8 个测试文件。
导致 .dev-mode 中写入的 step_4_learning / step_5_clean 字段名
与 devloop-check.sh 检查的 step_10_learning / step_11_cleanup 不匹配，
工作流永远无法检测到完成状态。

### 下次预防

- [ ] 重命名任何跨文件引用的常量/字段时，先 grep 全仓库找到所有引用处
- [ ] 建立跨文件引用一致性检查器（cross-ref-registry.yaml + check-cross-ref.mjs）
- [ ] 在 CI L2 Consistency Gate 中添加 cross-reference check job
