## CI DB 密码改用 GitHub Secrets（2026-05-26）

### 根本原因

PR #3133 修复 `claimed_by` 僵尸锁时，为让 `real-env-smoke` 能连接测试 Postgres，
在 `ci.yml` 里直接写入了明文密码 `DB_PASSWORD: cecelia_test`。
这触发了 DeepSeek Code Review 的 🔴 硬编码凭据告警，属于真实安全问题（非假阳性）。

### 下次预防

- [ ] 任何 CI 步骤需要 DB 密码，必须通过 GitHub Secrets 注入（`${{ secrets.CI_DB_PASSWORD }}`）
- [ ] 明文密码禁止出现在 `ci.yml` 任何位置（含 env block、matrix、container options）
- [ ] `scripts/devgate/check-ci-no-hardcoded-secrets.sh` 已作为 lint 门禁，push 前自动检测
- [ ] GitHub Secret `CI_DB_PASSWORD` / `CI_DB_USER` 已注册，后续 CI 统一引用
- [ ] 凭据变更时同步更新 1Password CS Vault（SSOT）
