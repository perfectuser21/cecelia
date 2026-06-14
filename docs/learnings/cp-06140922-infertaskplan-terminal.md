# Learning — inferTaskPlan 坏产物改 terminal 失败，止住无限 fresh-start

分支: cp-06140922-infertaskplan-terminal
日期: 2026-06-14

### 根本原因

生产 run 4225330d（#3380 复盘遗留②）：GAN 收敛后 inferTaskPlanNode 读 proposer 分支的
task-plan.json，proposer 产物坏（解析失败 / tasks 为空）。旧码 parse-fail `return {}`、空 tasks 透传
→ dbUpsertNode 抛 `taskPlan.tasks required`。该 error **非终态**（无 terminal 标记），task 留
`status='in_progress'`。harness-watchdog 只扫 `task_type='harness_initiative' AND status='in_progress'`，
于是反复 fresh-start，重跑 planner+GAN，烧穿 execution_attempts（3 次 attempt 全废）。

**重跑解决不了「proposer 产物坏」**——非终态 error + watchdog in_progress 扫描 = 无限重试坏产物。
错误的「软失败」（return {} / 非终态 error）让坏产物在 pipeline 里反复循环，伪装成「还在跑」。

### 修复

inferTaskPlanNode 对不可恢复失败（无 propose_branch / 解析失败 / 空 tasks）：
1. 标 `tasks.status='failed'`（+ initiative_runs.phase='failed'）→ 移出 watchdog in_progress 扫描范围
   （对齐 ganLoop catch 既有 failed-marking 模式）。
2. 返回 `error.terminal=true` → executor resume 路径也判终态。
保留 git-show/网络 I/O 失败为非终态（瞬时可重试，MAX_FRESH_STARTS 兜底）——只把重跑无益的坏产物改 terminal。

### 下次预防

- [ ] 「重跑解决不了」的失败（坏 LLM 产物 / 解析失败 / 缺必填产出）必须 terminal + 标 task failed，不得用
      非终态 error / return {} 软失败，否则 watchdog 的 in_progress 扫描会无限 fresh-start。
- [ ] 新增/修改 graph 节点的失败返回时，分清「瞬时可重试」（I/O/网络 → 非终态）与「确定性坏」（产物坏 → terminal）。
- [ ] 标 terminal 的同时必须把 task 移出 watchdog 扫描范围（status='failed'），仅设 error.terminal 不够——
      Phase A watchdog 走 fresh-start 不看 error.terminal，只看 status='in_progress'。
