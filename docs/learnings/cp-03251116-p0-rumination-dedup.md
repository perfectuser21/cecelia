# Learning: P0 修复 — Rumination 洞察去重，防 Desire 自循环

**Branch**: cp-03251116-p0-rumination-dedup
**Date**: 2026-03-25

## 做了什么

在 `rumination.js` 的 `digestLearnings` 函数中加入洞察去重机制：

1. 新增 `computeInsightHash(insight)` — SHA256 前 32 字符 hex
2. 新增 `isInsightDuplicate(db, hash)` — 查 `cecelia_events`（24h 窗口），DB 异常降级为 `false`
3. `digestLearnings` 写洞察前检查去重，重复则 `dedup_skipped` 跳过
4. 正常写入后向 `cecelia_events` 插入 `rumination_output` 事件（含 `content_hash`）

### 根本原因

PR13 完成后反刍系统开始正常产出洞察，但每次产出都写入 `suggestions` 表，`suggestion-dispatcher` → 丘脑 → 创建任务，没有去重。如果调度器频繁运行，同一洞察会被反复消费形成 Rumination→Desire 死循环。

### 下次预防

- [ ] 任何"产出信号→消费信号"的路径，在产出侧设置幂等性保护（hash 去重或 DB UNIQUE 约束）
- [ ] 新建的事件驱动链路在设计时明确"谁去重、在哪去重"（建议：产出侧去重，消费侧做到幂等）
- [ ] `cecelia_events` 表是去重查询的标准位置，不要另建去重表
