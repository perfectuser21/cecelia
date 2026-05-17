---
branch: cp-04080544-7fdf70bf-597c-40df-acfd-38d335
date: 2026-04-08
task: auth 凭据有效期告警机制
---

# Learning: auth 凭据失效的根因与预防

### 根本原因

1. **凭据静默失效**：Claude 账号 OAuth token（`~/.claude-accountX/.credentials.json`）有约 7 天有效期，无任何前置告警机制，到期前不提醒。account3 token 在 2026-04-07 过期，造成大批任务被标记 `failure_class=auth`，引发自我诊断告警任务，消耗资源。

2. **liveness_dead 误标为 auth**：`requeueTask()` 在 watchdog 触发 quarantine 时，使用 `COALESCE(payload, ...) || new_data` 模式 — 新数据中若无 `failure_class`，旧值（可能是之前设的 `auth`）会继续保留。导致实际是 `liveness_dead` 的任务被 `getTaskStats24h()` 误计入 `auth_failed`，形成虚假告警。

3. **无可见性**：Brain 没有 API 端点可以查询各账号 token 剩余有效期，只有出错后才能发现问题。

### 下次预防

- [ ] OAuth token 即将过期前 4h → Brain 自动创建 P1 告警任务（已实现：`credential-expiry-checker.js` + tick.js 每30分钟检查）
- [ ] 新增 `GET /api/brain/credentials/status` 端点，随时可查账号 token 状态（已实现）
- [ ] `requeueTask()` quarantine 时：用 `payload - 'failure_class'` 删除旧分类，再写入新的 `failure_class: 'liveness_dead'`（已修复）
- [ ] 每次系统维护时手动运行 `curl localhost:5221/api/brain/credentials/status` 检查 token 健康状态
