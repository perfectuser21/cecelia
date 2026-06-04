## account1 误从 ACCOUNTS 移除导致单账号 429（2026-06-04）

### 根本原因

B53 时 account1 凭据失效，被从 `account-usage.js` 的 `ACCOUNTS` 数组移除。
后来凭据恢复（`~/.claude-account1/.credentials.json` Jun 2026 重新登录），
但代码注释未同步，`ACCOUNTS = ['account2']` 一直没改回来，
导致所有请求压 account2 单账号 → 频繁 429。

### 下次预防

- [ ] 移除账号时同步写入 `accounts-config-smoke.sh`，让 CI 持续验证池的组成
- [ ] 账号凭据恢复后，必须检查 `ACCOUNTS` 数组是否需要同步更新
- [ ] `account-usage.js` 的 `ACCOUNTS` 常量注释要写明"为什么不在"，不要只写"不在"
- [ ] regression test 已加：`getAccountUsage()` 验证两个账号都被查（PR #3288）
