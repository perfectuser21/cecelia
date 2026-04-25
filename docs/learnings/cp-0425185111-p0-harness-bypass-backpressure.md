# Learning: P0 harness 跳过 backpressure（dispatch whitelist）

**日期**：2026-04-25
**分支**：cp-0425185111-p0-harness-bypass-backpressure
**Brain 任务**：1d904af8-0dd2-45d3-823c-1f18920a41a9

## 背景

bb245cb4 跑期间反复看到 `queue_depth=128 > 20 burst_limit=3` 卡 dispatch。
P0 harness_* 任务被 88 个 P1 content-pipeline 积压拖累，关键调度链被次要业务掐住。

## 根本原因

`getBackpressureState()` 是 task 无关的全局函数 — 一旦 queue_depth > BACKPRESSURE_THRESHOLD=20，
所有任务（包括 P0 harness_*）都被压到 BACKPRESSURE_BURST_LIMIT=3 个/tick 派发上限。
原设计假设 "队列深 → 一律降速保护"，但忽略了任务优先级语义：
P0 harness 是系统调度链的关键路径（initiative → planner → propose → review → fix → ci_watch → deploy_watch），
content-pipeline 是后台批量任务，性质完全不同。

## 修复

把 backpressure 从「全局开关」改成「按任务白名单短路」：

1. `slot-allocator.js` 加 `BACKPRESSURE_BYPASS_TASK_TYPES` 常量（8 个 `harness_*`）
2. 加 `shouldBypassBackpressure(task)` 工具函数（priority='P0' AND task_type 在白名单）
3. `getBackpressureState({task})` 接受可选 `task` 参数，匹配白名单时短路返回 `active=false, override_burst_limit=null, bypassed:true`
4. `dispatch-helpers.js::selectNextDispatchableTask` 给匹配候选打 `_bypass_backpressure: true` 标记，调用方可识别

## 关键决策

- 只放行 P0：避免 P1 harness 也跳过造成 backpressure 失效；P1 harness 依然受常规 burst limit 约束
- 不改 BACKPRESSURE_THRESHOLD / BURST_LIMIT 数值：保护机制对其它任务保留
- 不改 tick.js dispatch loop：本 PR 在数据结构层加标记，tick.js 改动留 follow-up，避免一次改动面太大
- mock 文件需要补 export：13 个测试文件 mock 了 `../slot-allocator.js`，4 个会触发 dispatch-helpers 调用 `shouldBypassBackpressure`，需要在这 4 个 mock 块里补 `shouldBypassBackpressure: vi.fn(() => false)`

## 下次预防

- [ ] 写新 backpressure / 节流类全局函数时，预留 task 入参口子（避免后续要补丁式短路）
- [ ] 给 `slot-allocator.js` 增加 export 时，全局搜 `vi.mock\(['"]\.\./slot-allocator['"]` 一并补 mock 导出（避免运行回归才发现）
- [ ] 关键调度链（harness_*）和后台批量任务（content-*）应分开计算 backpressure，未来可能需要进一步隔离 queue_depth 计数
