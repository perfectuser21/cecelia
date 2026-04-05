# Learning: monitor_loop 探针健壮性强化

**Branch**: cp-04050611-a45855b8-1a52-4f44-a51b-442d88
**Date**: 2026-04-05

## 问题描述

capability probe `monitor_loop` 报告 `running=false interval=30000ms`。
PR #1902 修复了核心问题（启动隔离 + self-heal）。本次 PR 补充了两个遗漏场景。

### 根本原因

1. **Self-heal 无 try-catch**：当 probe 检测到 `running=false` 并调用 `startMonitorLoop()` 时，若该函数本身抛出异常，错误会冒泡到 `runProbes` 的外层 catch，导致 probe 报 `error: err.message` 而非清晰的 `ok=false detail`。
2. **无 "循环卡死" 检测**：`getMonitorStatus().running` 只检查 timer 是否存在，不能检测 `_monitoring` 永久卡 `true` 导致所有周期被跳过的场景（计时器跑着但实际没有执行任何监控）。
3. **`capability-probe.test.js` 在 exclude 列表中**：PR #1902 已加了 `vi.mock('db.js')`，应该是纯单元测试，应从 exclude 列表移除。

### 下次预防

- [ ] Self-heal 调用任何外部函数前必须加 try-catch，确保 probe 的 `ok` 字段含义清晰
- [ ] Monitor loop 的 `getMonitorStatus()` 应暴露 `last_cycle_at` + `cycle_count`，允许探针检测"计时器在跑但没有实际执行"的卡死场景
- [ ] 新增 probe 的单元测试应同步从 vitest exclude 列表移除
- [ ] Probe 测试 mock 的 `getMonitorStatus` 返回值需包含新字段（`cycle_count`, `last_cycle_at`），避免未来新字段引入时测试与实现脱节
