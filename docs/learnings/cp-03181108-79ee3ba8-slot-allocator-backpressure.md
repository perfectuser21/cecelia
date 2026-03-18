# Learning: slot-allocator 积压感知降速

**分支**: cp-03181108-79ee3ba8-0f16-424e-aaaf-870e2c
**日期**: 2026-03-18

## 背景

为 slot-allocator.js 新增 backpressure 机制：当 queued 队列深度 > 5 时，tick.js 的 burst limit 从 2 压至 1，防止积压积累后连续多 tick 派发引发资源雪崩。

### 根本原因

tick.js 的 `MAX_NEW_DISPATCHES_PER_TICK=2` burst limiter 只限制单 tick 派发量，但对积压场景无感知。当 queued 队列积压 9-10 个任务时，每 tick 仍可派发 2 个，连续多 tick 后 N 个 agent 并发启动，引发内存/CPU 雪崩（历史 RCA 已记录）。

### 解决方案

1. **slot-allocator.js**：新增 `getQueueDepth()` 查询全量 queued 任务数，`calculateSlotBudget()` 末尾计算 `backpressure` 字段并返回
2. **tick.js**：Step 7 前读取 `backpressure.override_burst_limit`，用 `effectiveBurstLimit` 替代硬编码 `MAX_NEW_DISPATCHES_PER_TICK`

### 下次预防

- [ ] 新增 DB 查询函数后必须更新所有 `calculateSlotBudget` 测试的 mock 序列（本次需更新 7 处）
- [ ] `pool.query` 的 `mockResolvedValueOnce` 调用顺序与代码中 `await pool.query(...)` 顺序严格对应
- [ ] 插入新的 DB 查询时，优先放在 `applySlotBuffer` 之后、`countCeceliaInProgress` 之前，避免影响 Pool C 预算计算
