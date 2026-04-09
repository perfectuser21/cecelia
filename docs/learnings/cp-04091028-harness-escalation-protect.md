# Learning: harness_* 任务未加入 escalation/cleanup 保护列表

**日期**: 2026-04-09
**PR**: cp-04091028-harness-escalation-protect

### 根本原因

`escalation.js::cancelPendingTasks()` 和 `task-cleanup.js::PROTECTED_TASK_TYPES` 只保护了 `sprint_*` 系列任务，但 `harness_*` 系列（harness_planner, harness_contract_propose 等9个类型）不在保护列表中。

当 escalation 系统触发 `cancelPendingTasks`（如队列积压、系统过载）时，所有 queued 的 harness 任务会被批量取消，导致 GAN pipeline 在第 N 轮突然中断（E2E v8/v9 测试中，P3 和 R2 在创建后立即被 escalation 取消）。

### 修复方案

在两处保护列表中同时补全 `harness_*` 全系列类型：
- `escalation.js` NOT IN 保护列表
- `task-cleanup.js` PROTECTED_TASK_TYPES 常量

### 下次预防

- [ ] 新增 pipeline task_type 时，必须同步检查 escalation.js / task-cleanup.js 保护列表
- [ ] 将保护列表集中为一个常量（SSOT），避免分散在两处
