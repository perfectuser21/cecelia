# Learning: shouldRunDaily 5分钟窗口导致日级合成缺失

**分支**: cp-04030355-bacb9764-e3d8-41a3-a18e-5b6044  
**日期**: 2026-04-03

### 根本原因

`rumination-scheduler.js` 的 `shouldRunDaily()` 使用 5 分钟窗口（UTC 18:00-18:05）。
`synthesis_archive` 由两路写入：
1. `runRumination`（每 tick，受 `isSystemIdle()` 约束 — 要求 0 个 in_progress 任务）
2. `runSynthesisSchedulerIfNeeded`（仅在 UTC 18:00-18:05 窗口）

当系统繁忙（in_progress > 0）且同时错过 5 分钟触发窗口，整天无 synthesis 写入，
导致 `probeRumination` 48h 检查失败，触发自驱动诊断任务。

实测：2026-04-02 synthesis_archive 无 period_start='2026-04-02' 条目，系统活跃一天后
下次写入才在 2026-04-03，总时间差超过 24h 探针阈值（现已改 48h）。

### 修复

将 `shouldRunDaily()` 从 5 分钟窗口改为宽窗口（UTC 18:00 ~ 23:59）：

```js
// Before: 5 分钟窗口，Brain 重启/错位即丢失当天合成
return now.getUTCHours() === DAILY_HOUR_UTC && now.getUTCMinutes() < DAILY_WINDOW_MIN;

// After: 宽窗口，今日任何时间 >= UTC 18 都可触发（hasTodaySynthesis 防重复）
return now.getUTCHours() >= DAILY_HOUR_UTC;
```

`runDailySynthesis` 内部 `hasTodaySynthesis` 检查保证幂等：今日已完成则立即返回
`skipped:already_done`，不重复调用 NotebookLM。

### 下次预防

- [ ] 设计依赖时间窗口的调度逻辑时，优先使用"已完成检查"替代"精确时间窗口"
- [ ] synthesis_archive 这类每日必须写入的关键记录，其触发窗口应覆盖整个"可运行时段"
- [ ] `isSystemIdle()` 会阻断非计划外 rumination 路径，关键合成不能依赖此路径
