---
branch: cp-04080530-5248c043-0eb8-4d74-88b5-f862b8
task: [SelfDrive] [紧急-P1] 基础设施认证层故障排查与修复
date: 2026-04-08
---

# Learning: auth 凭据主动过期检测

### 根本原因

Claude Code OAuth token 每 5-7 小时过期一次。`markAuthFailure()` 系统（PR #228）仅在收到 401 后才触发熔断，导致 token 过期到熔断之间的窗口期内多个任务被派发到失效账号并 quarantine，形成 auth_failed 级联（实测 183 次/24h）。

根因链：
1. token 过期 → Brain 继续派任务
2. 任务执行 → 401 → `execution-callback` 调 `markAuthFailure()`
3. 但已经有 N 个任务被 dispatch 并 quarantine 了

### 下次预防

- [x] 在 `selectBestAccount()` 调用前执行 `proactiveTokenCheck()`
- [x] `proactiveTokenCheck()` 读取 credentials.json 的 `expiresAt`：
  - 已过期 → 立即 `markAuthFailure(24h)` 阻断派发
  - < 30min 过期 → P1 告警（去重）
  - token 刷新后有效 → 自动清除 auth-failed 熔断
- [ ] 未来改进：为 Brain Dashboard 增加 token 过期倒计时显示
