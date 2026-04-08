# Learning: auth 凭据失败监控 — 熔断无告警导致 185 次级联失败

### 根本原因

account3 Claude API 凭据 401（Invalid authentication credentials），触发大量 Pipeline Rescue 任务
以 auth 失败级联。关键问题：`markAuthFailure()` 只写日志，不触发 `raise()` 告警，导致问题在
24h self-drive 巡检前无法被立即感知。

### 下次预防

- [ ] auth 失败时立即 `raise('P0', 'infra_auth_failure_${account}', ...)` — 已在 execution.js 实现
- [ ] `/api/brain/credentials/health` 端点可随时查询账号熔断状态 — 已在 infra-status.js 实现
- [ ] Pipeline Rescue dedup/cap 已在 PR #2004/#2019/#2026/#2032 修复，不再复现大量级联
- [ ] 1Password 凭据轮换时，需同步更新 `~/.credentials/` 并验证 auth 成功后再重启依赖服务
