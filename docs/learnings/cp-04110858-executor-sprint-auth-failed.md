# Learning: Sprint 任务 account1 强绑定未检查 auth_failed

**分支**: cp-04110858-69b92123-executor-sprint-auth-failed-fix
**日期**: 2026-04-11

### 根本原因

executor.js `SPRINT_ACCOUNT1_TASK_TYPES` 强绑定逻辑只检查 `isSpendingCapped`，
未检查 `isAuthFailed`。account1 token 过期（401）时仍被硬绑定，导致 harness sprint 任务持续 auth 失败。

### 下次预防

- [ ] Sprint 强绑定逻辑修改时，同时验证 spending-cap 和 auth-failed 两个 guard 都覆盖
- [ ] `isAuthFailed` 应与 `isSpendingCapped` 并列，作为标准账号过滤条件
