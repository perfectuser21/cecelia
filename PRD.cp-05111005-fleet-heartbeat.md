# PRD — fleet heartbeat 可信度修复 (B7)

## 背景

Brain fleet 监控误报：西安 2 台机器（xian-mac-m1 + xian-mac-m4）SSH 不通时，
`fleet-resource-cache.js` 静默返回 `online=false, pressure=1`，无任何诊断信息，
导致 `effectiveSlots` 被错算少，dispatcher 误判产能紧张。

## 目标

让 fleet heartbeat 结果可信、可诊断，不改远程 agent 发送端。

## 需求

1. **可配置 offline 阈值**：`HEARTBEAT_OFFLINE_GRACE_MIN` env var（默认 10 分钟），超过此时间无成功采集 → offline
2. **last_ping_at 字段**：记录最后一次成功采集的时间戳，暴露到 fleet status API
3. **offline_reason 字段**：区分两种失败模式
   - `fetch_failed`：从未成功过（或本次直接失败）
   - `no_ping_grace_exceeded`：曾经成功，但超出宽限期
4. **不修远程 agent**：xian 机器的 heartbeat 发送端不在本 PR scope

## 成功标准

- 5 分钟内有成功采集 → `online=true, offline_reason=null`
- 10+ 分钟无成功采集 → `online=false, offline_reason='no_ping_grace_exceeded'`
- 首次采集失败 → `online=false, offline_reason='fetch_failed'`
- `HEARTBEAT_OFFLINE_GRACE_MIN` 可覆盖 grace 阈值
- `getFleetStatus()` 返回值含 `last_ping_at` + `offline_reason` 字段
