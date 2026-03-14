---
id: learning-token-budget-scheduler
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
changelog:
  - 1.0.0: 初始版本
---

# Learning: 动态 Token 预算调度器 — 7day 配额感知（2026-03-14）

## 问题背景

上周 Claude 3账号（account1/2）在断续运行中提前耗尽 7-day Sonnet 配额（均达 100%），
原因是 Brain 的 `getTokenPressure()` 只检查 5h 滚动窗口，完全不感知周级别配额剩余。
结果是系统爆发式跑满后突然断电，而不是稳定持续运行。

## 根本原因

- `slot-allocator.js` 的 Pool C 基于 `token_pressure`（5h 维度）限流
- 5h 窗口每 5 小时重置，不反映 7-day 总体消耗趋势
- 3个账号同时冲击，周末就把 7-day Sonnet 全跑光

## 解法

新增 `token-budget-planner.js`：
- 基于 `seven_day_sonnet_pct` 和 `seven_day_pct` 计算"剩余"
- 取两者中较高者（更保守）
- 四种状态：abundant/moderate/tight/critical
- Pool C × POOL_C_SCALE 缩放（1.0/0.7/0.3/0.0）
- 30% 保留给用户手动使用（USER_RESERVE_PCT）
- tight/critical 时 dev/code_review 自动降级给 Codex

## 关键陷阱

### slot-allocator.test.js 被 pool.query 消耗顺序干扰

`calculateBudgetState()` 调用 `getAccountUsage()` → `pool.query`（cache check），
消耗了测试里 `mockResolvedValueOnce` 设置的 DB 调用顺序，导致 3 个已有测试失败。

**修复**：在 slot-allocator.test.js 顶部添加 `vi.mock('../token-budget-planner.js', ...)` mock，
防止真实实现消耗 DB mock 调用。
