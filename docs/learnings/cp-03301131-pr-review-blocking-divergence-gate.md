# Learning: PR Review 阻塞门禁 + Divergence 可执行检查

**Branch**: cp-03301131-pr-review-blocking-divergence-gate  
**Date**: 2026-03-30

## 变更摘要

1. `pr-review.yml` 从 `hustcer/deepseek-review@v1` 改为直接调 OpenRouter API + `detect-review-issues.js`（🔴 → exit 1 阻塞合并）
2. `devloop-check.sh` 新增 `check_divergence_count()` 函数 + 在条件 1.5 中调用（divergence_count=0 → 橡皮图章检测）
3. 新增 20 个单元测试（pr-review-blocking.test.ts + devloop-check-divergence.test.ts）

### 根本原因

`hustcer/deepseek-review@v1` Action 只发布 review comment，job 总是 exit 0。即使加入 required check，审查内容有🔴也不会阻塞合并。需要换成能 exit 1 的实现。

divergence_count 检查只在 SKILL.md 文字描述中，无法被 devloop-check.sh 执行，可被绕过。

### 下次预防

- [ ] 使用第三方 Action 做门控时，先确认该 Action 是否会根据审查内容改变 exit code
- [ ] 质量约束必须在可执行代码（.sh/.js）中，SKILL.md 中的文字说明不是门禁
- [ ] Engine 版本 bump 时要先 fetch main 确认当前版本，避免版本冲突（本次：13.62.0 被 PR#1699 占用，改为 13.63.0）
- [ ] `feature-registry.yml` 两行格式要统一（`type+description` vs `change+scope`），本次保持两种共存
