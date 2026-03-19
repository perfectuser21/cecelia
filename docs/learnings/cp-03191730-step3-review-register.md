# Learning: Step 3 Push 后自动注册审查任务

## 任务概要
在 03-prci.md 中 push 成功后、创建 PR 前，自动向 Brain API 注册 cto_review/code_quality_review/prd_coverage_audit 三个 P0 审查任务。

### 根本原因
devloop-check.sh 的条件 2.5/2.6/2.7 能检查审查状态，但没有代码负责创建这些审查任务。门禁装好了但门铃没接线。

### 下次预防
- [ ] 新增 devloop-check 条件时，同时在 /dev 步骤中添加对应的任务注册代码
- [ ] DoD 文件记得标记 [x]，否则 CI DoD Verification Gate 会失败
