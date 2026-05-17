# Learning — fleet heartbeat 可信度修复 (B7)

task_id: B7-fleet-heartbeat
branch: cp-05111005-fleet-heartbeat
date: 2026-05-11

### 根本原因

`fleet-resource-cache.js` 的 `collectServerStats()` 在 catch 块中静默返回
`{ online: false, pressure: 1 }` 而不区分"从未成功"和"已超时"两种失败模式，
也不记录最后一次成功时间，导致：
1. 诊断信息为零（用户无法判断是"机器挂了"还是"从没连上过"）
2. `effectiveSlots` 被错算为 0，dispatcher 误判产能紧张

### 下次预防

- [ ] 凡新增监控/采集逻辑，必须同时新增 `reason` 字段，区分 failure 类型
- [ ] 凡可配置阈值，必须从 env var 读取（不能 hardcode），且命名 `*_MIN/*_MAX/*_THRESHOLD`
- [ ] 新增 fleet 相关字段时，确保 `getFleetStatus()` 返回值完整暴露新字段

### 方案摘要

- `last_ping_at`：记录每台机器最后一次成功采集的时间戳（null 表示从未成功）
- `offline_reason`：`null`（在线）/ `'fetch_failed'`（本次失败且无历史成功）/ `'no_ping_grace_exceeded'`（超出宽限期）
- `HEARTBEAT_OFFLINE_GRACE_MIN` env：控制宽限阈值（默认 10 分钟）
- 宽限期内失败仍视为 `fetch_failed`（short transient failure），超出则 `no_ping_grace_exceeded`
