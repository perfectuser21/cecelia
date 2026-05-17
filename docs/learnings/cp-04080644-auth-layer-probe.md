# Learning: 认证层故障后遗症排查 — auth 失败率探针

## 根本原因

Brain 的凭据保护体系有两层：
1. `proactiveTokenCheck` — 读取 token 文件的 `expiresAt`，提前熔断
2. `checkAndAlertExpiringCredentials` — 同样检查文件过期时间，提前4h告警

**盲点**：两者都只看 token 文件，无法感知"executor 运行时 auth 失败率爆增"的场景（例如 codex provider 的 API key 失效、网络问题导致认证不稳定）。

**本次故障**：account3 在24小时内出现 166 次 `failure_class = 'auth'` 的任务失败，
而 `is_auth_failed` 熔断机制虽然最终触发，但在熔断恢复后失败仍持续发生（失败率探针的缺失导致无法及时告警）。

## 修复

新增 `scanAuthLayerHealth(pool)` 函数，从 `tasks` 表实时统计近1小时 auth 失败率：
- 任意账号近1小时失败 ≥ 5 次 → 创建 P1 告警任务
- 防重逻辑：6小时内已有同类告警则跳过
- 在 `tick.js` 的 credential-check 块中集成（每30分钟运行一次）

## 下次预防

- [ ] 凭据保护需要两层：静态检查（文件 expiresAt）+ 动态检查（运行时失败率）
- [ ] auth 失败率探针阈值 `AUTH_FAIL_RATE_THRESHOLD = 5` 可通过环境变量调整
- [ ] Pipeline Rescue 类任务因 worktree 路径不存在导致大量堆积是正常现象，不需要手工清理
- [ ] `recoverAuthQuarantinedTasks` 只恢复 `failure_class = 'auth'` 的任务，其他隔离类型不会被误操作
