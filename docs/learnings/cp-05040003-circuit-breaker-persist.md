# Learning: circuit-breaker PostgreSQL 持久化

**分支**: cp-circuit-breaker-persist  
**任务**: Wave1-B — 重启后熔断器状态自动恢复  
**日期**: 2026-05-04

### 根本原因

Brain 重启后 circuit-breaker.js 内存 Map 清零，已 OPEN 的熔断器立即"复活"并重新派发给失败的 executor，导致循环失败。

### 修复方案

- `migration 261`: 新建 `circuit_breaker_states` 表（key/state/failures/last_failure_at/opened_at）
- `circuit-breaker.js`: 启动时 `loadFromDB()` 从 DB 恢复所有状态到内存 Map；状态变更时 `_persist()` 异步 upsert；成功后 `_delete()` 清除记录
- DB 写失败只 warn（fail-degraded），不影响内存运行时
- `server.js`: 启动时调用 `loadCircuitBreakerStatesFromDB()`

### 下次预防

- [ ] 任何持久化 in-memory 状态的 module 都应有 DB 对应表和 startup load
- [ ] fail-degraded 模式：DB 写失败 warn 不 throw，避免 fail-open/fail-close
- [ ] Brain 重启测试：验证 OPEN 状态在重启后仍然 OPEN
