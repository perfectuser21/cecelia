---
branch: cp-03210510-8ebcbd42-99bc-4ab7-8cd6-eef3b6
date: 2026-03-21
pr: pending
---

# Learning: stop-dev.sh fallback spec_review 超时检查遗漏

## 根本原因

PR #1286 修复了三处 Pipeline 死锁：
1. devloop-check.sh: 合并失败 return 2
2. devloop-check.sh: codex review 15 分钟超时降级
3. 步骤文件写入 registered_at 时间戳

PR #1294 在 devloop-check.sh + 步骤文件中重新应用了这些修复。
PR #1296 在 stop-dev.sh fallback 中补齐了 code_review_gate 的 15 分钟超时。

但 stop-dev.sh fallback 路径完全遗漏了 spec_review 状态检查。
主路径（devloop-check.sh）通过 `_check_codex_review` 函数统一处理两者，
fallback 路径由于是手工维护，容易出现遗漏。

## 下次预防

- [ ] 每次在 devloop-check.sh 添加新的 Gate 检查时，同时检查 stop-dev.sh fallback 路径是否需要同步
- [ ] 对称原则：spec_review 和 code_review_gate 的处理逻辑应完全对称
- [ ] fallback 路径的 spec_review 检查（条件 1.5）现已补齐，与 code_review_gate（条件 2.5）完全对称
