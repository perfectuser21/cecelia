# PRD — harness_task 默认 P0 + alertness 白名单双保险

## 背景

Harness v2 DAG 调度器 `upsertTaskPlan` 创建 harness_task 子任务时默认 `priority='P2'`。
Alertness 模块在 AWARE/ALERT 状态下会触发 `pause_low_priority(P2, P3)` 动作，把所有
queued 的 P2/P3 task 改成 `status='paused'`。

**2026-04-22 真机事故**：Initiative 2303a935 的 4 个 Generator 子任务 ws1-4 被创建为
P2 → alertness 立刻 pause → Dispatcher 看 paused 不派 → E2E 卡住，需手动改 priority
到 P0 才恢复。

## 目标

- harness_task 默认以 P0 创建，与 parent harness_initiative 同等重要（它就是 active
  Initiative 的子工作，不是背景噪音）
- alertness `pause_low_priority` 白名单兜底保护 harness_* 全家桶，防止未来有人再把
  默认 priority 改回 P2 时又踩坑

## 成功标准

- [x] `upsertTaskPlan` INSERT SQL 默认写 `'P0'`（不再是 `'P2'`）
- [x] `pauseLowPriorityTasks` 的 `task_type NOT IN (...)` 白名单加入 11 个 harness_* type
- [x] 新增单元测试 `harness-dag-upsert-priority.test.js` 覆盖 A 点，vitest 通过
- [x] 新增单元测试 `alertness-harness-whitelist.test.js` 覆盖 B 点，vitest 通过
- [x] 既有 `harness-dag.test.js` / `alertness/escalation.test.js` 回归全绿
- [x] facts-check DevGate 通过

## 非目标

- 不改 alertness 触发阈值 / 响应级别 / escalation 节奏
- 不改 harness_task 以外的默认 priority
- 不做数据库历史数据修复（现有已 pause 的 P2 harness_task 由 Brain 重启 / 下一轮
  Planner 自愈即可）
