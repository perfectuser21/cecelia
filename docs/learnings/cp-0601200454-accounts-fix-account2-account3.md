## account1 无凭据导致双账号系统实际只有单账号运行（2026-06-01）

### 根本原因
Brain 的 ACCOUNTS 列表包含 account1 和 account2，但 account1 从未有有效的 `.credentials.json` 文件（或文件被删除）。每次 Brain 尝试用 account1 发起 API 调用时都得到 401，auth-circuit-breaker 反复封禁 account1 达 24 小时。这导致：
1. 实际上只有 account2 单独承担所有任务
2. account2 频繁打满 5 小时窗口
3. account3 虽有有效凭据（MAX 20x），但在 H14 时因 403 被错误移除，一直闲置

`getTokenExpiryInfo` 函数在 `.credentials.json` 不存在时返回 `{ isExpired: false }`，masking 了真实问题——proactiveTokenCheck 认为 token 没问题，直到实际 API 调用 401 才发现。

### 下次预防

- [ ] `getTokenExpiryInfo` 应在文件不存在时返回 `{ isMissing: true }`，触发 P1 告警"account1 credentials 文件丢失，请重新登录"
- [ ] 部署前 smoke 测试应验证所有 ACCOUNTS 列表账号均有有效 `.credentials.json`
- [ ] 账号从 ACCOUNTS 移除时，应记录原因和是否可恢复（account3 的 H14 记录不够清晰）
- [ ] 定期检查 ACCOUNTS 里每个账号的 credentials 文件是否存在
