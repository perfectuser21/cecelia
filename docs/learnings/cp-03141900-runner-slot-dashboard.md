---
id: learning-runner-slot-dashboard
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
changelog:
  - 1.0.0: 初始版本
---

# Learning: 实时 Runner/Slot 面板 + 动态 Slot 推荐器

**Branch**: cp-03141900-runner-slot-dashboard
**Date**: 2026-03-14

## 做了什么

1. 新增 migration 153：`task_execution_metrics` 表，记录每任务的 account_id/duration_ms/est_requests
2. 新增 `GET /api/brain/runner-status`：查询 in_progress 任务，按 zone 分组返回 slot 状态
3. 新增 `GET /api/brain/slot-recommendation`：基于账号剩余配额 + 任务历史消耗，动态推荐 slot 数
4. `execution-callback` 写入 `task_execution_metrics`（非阻塞，失败不影响主流程）
5. `LiveMonitorPage.tsx` 新增 `RunnerSlotPanel` 组件：3 区 slot 卡片 + 推荐数显示
6. `AccUsageRings` 增加 7d 用量显示

### 根本原因

之前 Dashboard 没有「谁在跑什么任务用哪个账号」的可视化，且 `task_execution_metrics` 数据缺失导致 `slot-recommendation` 只能用默认值。

### 下次预防

- [ ] execution-callback 写 account_id 时需确认 `req.body.account_id` 是否真实传入；若没有则从 `tasks.payload->>'dispatched_account'` 查询
- [ ] slot-recommendation 的 `REQUESTS_PER_5H = 80` 是估算值，随着 `task_execution_metrics` 积累数据后应调整
- [ ] RunnerSlotPanel 的 zone 分类逻辑与 `countCeceliaInProgress` 保持一致（decomposition/requires_cortex 字段）

## 技术决策

- `account_id` 写入方式：优先用 `req.body.account_id`（如果 brain 传入），fallback 到任务 payload 中的 `dispatched_account`
- slot 推荐公式：`floor(remaining_requests / remaining_hours / avg_requests_per_task)`，`remaining_requests` = `(1 - five_hour_pct/100) * 80 * accounts_count`
- 3区2列网格布局：user(2) + cecelia(2) + taskPool(≤6)，每个 SlotCard 紧凑显示账号+模型+任务名+时长
