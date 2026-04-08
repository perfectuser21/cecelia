# Learning: auth circuit breaker 固定 2h 熔断导致 21h 级联失败

## 根本原因

account3 OAuth token 于 2026-04-07 ~08:00 UTC 失效，Brain 的 `markAuthFailure` 固定
2h 熔断。每次 2h 窗口解除后，新任务又被派发到 account3 → auth 失败 → 再熔断 2h。
这个循环持续 21h，累积 155 次 auth 失败（全部为 pipeline_rescue 类型）。

## 修复

- `markAuthFailure` 引入指数退避：第 1 次 2h → 第 2 次 4h → 第 3 次 8h → 第 4+ 次 24h（封顶）
- `_authFailureCountMap` 跟踪连续失败次数（内存，Brain 重启后重置）
- `resetAuthFailureCount` 在 `proactiveTokenCheck` 确认 token 有效时重置
- `credential-expiry-checker.js` 预警阈值 4h → 8h，提供更多响应窗口

## 下次预防

- [ ] auth 失败触发应检查是否与 pipeline_rescue 批量任务叠加，避免计数膨胀
- [ ] 如需更精确的退避恢复，可持久化 failureCount 到 DB（当前内存方案重启后重置，可接受）
- [ ] 凭据过期前 8h 应已收到告警，如未响应，24h 熔断可阻止大部分重复失败
