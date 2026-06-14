# PRD — inferTaskPlan 坏产物改 terminal 失败，止住无限 fresh-start

## 背景

生产 run 4225330d 取证（#3380 复盘的遗留②）：GAN 收敛后 inferTaskPlanNode 读 proposer 分支的
task-plan.json，但 proposer 产物坏（解析失败 / tasks 为空）。旧码：
- parse-fail → `return {}`（透传）→ dbUpsertNode 抛 `taskPlan.tasks required`
- 解析成功但空 tasks → 透传 → 同样 dbUpsert 抛错

dbUpsert 的 error 是**非终态**（无 terminal 标记），task 留 `status='in_progress'`。
harness-watchdog 只扫 `task_type='harness_initiative' AND status='in_progress'`，于是把它反复
fresh-start，重跑 planner+GAN，烧穿 execution_attempts（实测 3 次 attempt 全废，每次重跑 planner 容器）。

重跑解决不了「proposer 产物坏」——必须 terminal fail loud，让人介入，而不是无限重试。

## 方案

inferTaskPlanNode 对**不可恢复**失败（无 propose_branch / task-plan.json 解析失败 / tasks 为空）：
1. 标 `tasks.status='failed'`（+ initiative_runs.phase='failed'）→ 移出 watchdog 的 in_progress 扫描范围
   （对齐 ganLoop catch 既有的 failed-marking 模式）。
2. 返回 `error.terminal=true` → executor resume 路径（`existing.channel_values.error.terminal`）也判终态。

保留 git-show/网络 I/O 失败为**非终态**（可能瞬时，fresh-start 重试合理，由 MAX_FRESH_STARTS 兜底）。
只把「proposer 产物坏」这类重跑无益的失败改 terminal。

## 范围

仅改 packages/brain/src/workflows/harness-initiative.graph.js 的 inferTaskPlanNode + 新增 regression test。
不动 watchdog、dbUpsert、GAN graph。

## 成功标准

- inferTaskPlanNode 遇 tasks 为空 / task-plan.json 解析失败 / 无 propose_branch → 返回 error.terminal=true 且标 task status='failed'。
- tasks 非空时正常返回 taskPlan，不标 failed。
- 已有 taskPlan.tasks 时短路 passthrough，不读分支不标 failed。
- git-show/网络 I/O 失败保持非终态（既有行为不回归）。
