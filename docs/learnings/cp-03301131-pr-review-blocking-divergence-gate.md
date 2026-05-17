# Learning: PR Review 阻塞门禁 + Divergence 可执行检查

**Branch**: cp-03301131-pr-review-blocking-divergence-gate  
**Date**: 2026-03-30

## 变更摘要

1. `pr-review.yml` 从 `hustcer/deepseek-review@v1` 改为直接调 OpenRouter API + `detect-review-issues.js`（🔴 → exit 1 阻塞合并）
2. `devloop-check.sh` 新增 `check_divergence_count()` 函数 + 在条件 1.5 中调用（divergence_count=0 → 橡皮图章检测）
3. 新增 20 个单元测试（pr-review-blocking.test.ts + devloop-check-divergence.test.ts）

### 根本原因

`hustcer/deepseek-review@v1` Action 只发布 review comment，job 总是 exit 0。即使将该 check 加入 branch protection required checks，审查内容包含🔴严重问题时也不会阻塞合并——因为 job 本身不失败。

门禁必须在可执行代码层实现。第三方 Action 若不提供内容感知的 exit code，只能做展示用途，不能做门禁用途。需要换成直接调 API + 脚本检测的方式，用 exit 1 让 job 失败。

divergence_count 检查只在 SKILL.md 文字描述中，无法被 devloop-check.sh 执行，可被绕过。任何质量约束必须写成可执行函数（.sh/.js），而不是文字说明。

### 下次预防

- [ ] 使用第三方 Action 做门控时，先确认该 Action 是否会根据审查内容改变 exit code
- [ ] 质量约束必须在可执行代码（.sh/.js）中，SKILL.md 中的文字说明不是门禁
- [ ] Engine 版本 bump 时要先 fetch main 确认当前版本，避免版本冲突（本次：13.62.0 被 PR#1699 占用，改为 13.63.0）
- [ ] `feature-registry.yml` 两行格式要统一（`type+description` vs `change+scope`），本次保持两种共存
