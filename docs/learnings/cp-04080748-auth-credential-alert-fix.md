# Learning: 认证层凭据告警修复

**分支**: cp-04080748-5248c043-0eb8-4d74-88b5-f862b8  
**日期**: 2026-04-08

## 根本原因

过去24h auth凭据问题实际包含两个独立问题：

1. **account3 历史 auth 失败（139次）**：来自 token 过期前的历史任务积压，SelfDrive 已于 2026-04-08 08:57 UTC 完成恢复，circuit breaker 正常（`is_auth_failed: false`）。这是已解决的历史问题。

2. **三账号同时 EXPIRING_SOON**：account1（3h22m）、account2（6h8m）、account3（6h8m）全部接近过期，但仅 account1 有告警任务。account2/3 缺少告警的根因：
   - `checkAndAlertExpiringCredentials` 内部 dedup 只检查 `queued/in_progress`，与 `createTask` 内部 dedup（额外检查 `completed in 24h`）不一致
   - 缺少针对 token < 3h 的紧急升级机制 — 即使常规告警未处理，也无法二次告警

## 修复内容

1. **两层告警机制**：
   - 常规告警（8h~3h）：dedup 窗口与 `createTask` 对齐（同时检查 completed 24h）
   - 紧急升级告警（< 3h）：`[URGENT]` 前缀 + 2h dedup 窗口，确保临期不漏报

2. **`POST /api/brain/credentials/check` 端点**：手动触发凭据检查，不必等待 30 分钟 tick 周期

3. **增加了详细日志**：checker 发现 EXPIRING 账号时明确输出，便于后续排查

## 下次预防

- [ ] 凭据类告警的 dedup 逻辑必须与 `createTask` 内部 dedup 完全一致，否则会有静默漏报
- [ ] 关键基础设施告警应有多层机制：首次告警 + 升级告警（不依赖第一次告警被处理）
- [ ] OAuth token 过期是不可自动修复的问题（需人工重新登录），告警窗口应至少 12h
- [ ] 多账号同时过期是高风险场景（CI runner + 主力机同时失联），需要人工监控
