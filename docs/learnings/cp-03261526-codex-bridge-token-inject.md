---
id: learning-codex-bridge-token-inject
version: 1.0.0
created: 2026-03-26
updated: 2026-03-26
changelog:
  - 1.0.0: 初始版本
---

# Learning: codex-bridge 账号无状态化 — US Brain 注入 token（2026-03-26）

## 问题背景

Xi'an 机器的 Codex auth token 需要定期重新登录，每次都要 SSH 到 Xi'an 执行 `CODEX_HOME=~/.codex-teamX codex`，运维成本高。且 Xi'an 机器换机时需要重新同步 5 个账号的 auth.json。

## 解法

将账号管理集中到美国 M4：

1. **executor.js**：新增 `selectBestAccountFromLocal(maxAccounts=3)` — 并发查询本地 5 个账号的 `wham/usage`，按 5h 使用率升序排序，注入到发往 Xi'an bridge 的 `/run` request body（`accounts` 字段）
2. **codex-bridge.cjs**：收到 `accounts` 字段时，写临时目录 `/tmp/codex-inj-{taskId}-{ts}/{id}/auth.json`（目录权限 700，文件权限 600），用临时目录作 CODEX_HOME；`finally` 块清理
3. 无 `accounts` 字段时两侧均降级到原有本地选账号逻辑（向后兼容）

## 效果

- Xi'an 成为纯执行节点，本地无需维护 auth.json
- 账号 token 到期只需在美国重新登录，然后 `scp ~/.codex-teamX/auth.json xian-mac:~/.codex-teamX/auth.json` 同步
- 换机器时 Xi'an 零配置成本

## 下次预防

- [ ] 测试文件中避免使用 JWT 格式的 mock token（gitleaks 会误报），改用非 JWT 格式字符串
- [ ] 临时目录命名加上 taskId + timestamp 双重唯一性，避免并发冲突（已实现）
- [ ] prd_content 更新需直接连 cecelia PostgreSQL（`host: localhost, database: cecelia, user: cecelia`），PATCH API 不支持直接更新该字段
