# Learning: harness_task 不应被 alertness auto-pause — 默认 P0 + 白名单双保险

**Branch**: cp-04240815-harness-task-p0
**Task**: manual-harness-task-p0
**Date**: 2026-04-24

### 根本原因

`packages/brain/src/harness-dag.js::upsertTaskPlan` 创建 harness_task 子任务时，
INSERT SQL 硬编码 `priority='P2'`。Alertness 模块在 AWARE/ALERT 状态下调用
`pause_low_priority(P2, P3)` 会把所有 queued 的 P2/P3 任务改成 `status='paused'`，
Dispatcher 跳过 paused 不派。

harness_task 是 **当前 active Initiative 的子工作流**，跟 parent harness_initiative
同等重要；把它默认标为 P2 违反了"紧急路径不降级"的原则，直接导致 Initiative
2303a935 今晚 E2E 卡住、手动改 priority 到 P0 才恢复。

另一个潜在根因：`alertness/escalation.js::pauseLowPriorityTasks` 原本有 task_type
白名单（sprint_* / content-* / arch_review），但漏了 harness_*。就算 upsertTaskPlan
未来被人改回 P2，白名单应该兜底。

### 解决方案

**A（根因修复）**：`upsertTaskPlan` 默认 priority 从 `'P2'` 改为 `'P0'`，与 parent
Initiative 同等重要。

**B（一般化保险）**：`pauseLowPriorityTasks` 的 `task_type NOT IN (...)` 白名单补
11 个 harness_* type（harness_initiative / harness_task / harness_planner /
harness_contract_propose / harness_contract_review / harness_generate /
harness_evaluate / harness_fix / harness_ci_watch / harness_deploy_watch /
harness_report）。

两层保护：即使未来有人再把 priority 改回 P2，task_type 层白名单也拦得住。

### 下次预防

- [ ] 新建"紧急路径" task_type 时，必须同步评估：① upsert 默认 priority ②
  alertness 白名单是否覆盖（两处必须双写）
- [ ] Harness 类 task_type 进入 task-router.js 时，同步进入
  `pauseLowPriorityTasks` / `cancelPendingTasks` 白名单（目前 cancelPendingTasks
  已含 harness_*，pauseLowPriorityTasks 此前漏了 — 今后白名单要同步维护）
- [ ] upsertTaskPlan 若未来要支持按 Initiative priority 继承，应从
  `harness_initiative` row 读 priority 写入子 task，而不是硬编码默认值
- [ ] 真机事故手动修 DB 后，必须在 24h 内写 regression test 锁住（本次就是这个
  SOP）
