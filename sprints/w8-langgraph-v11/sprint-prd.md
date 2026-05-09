# Sprint PRD — W8 v11 真端到端验证 status=completed (post H7/H9/H8/H10)

## OKR 对齐

- **对应 KR**：免疫系统 KR — Harness 自调度链路稳定性（Brain LangGraph 修正后端到端可信）
- **当前进度**：Stream 1-5 + H7/H8/H9/H10 单点修复均已合并，但尚未在真实派发场景下完成"端到端跑到 completed"的实证
- **本次推进预期**：把"理论应已修复"提升为"真实派发实证 status=completed"，作为 W8 LangGraph 修正收尾的验收锚点

## 背景

W8 阶段对 Brain LangGraph 链路做了五条修正流（Stream 1-5）+ 四个收尾热修：
- **H7**（PR #2852）：entrypoint.sh 把 stdout tee 到 STDOUT_FILE，让 Brain 能读到 SKILL 真实输出
- **H8**（PR #2854）：evaluator 切换到 generator 的 task worktree，避免读到旧分支
- **H9**（PR #2853）：harness-planner SKILL push 静默化，避免 stdout 噪音污染 verdict 解析
- **H10**（PR #2855）：absorption_policy 触发逻辑诚实化，不再假装 applied

每个热修都过了单元/集成层验证，但合在一起跑一条真实的 harness Initiative，是否能从 `harness_initiative` 派发一路走到 evaluator 通过、最终在 Brain `tasks` 表里把该 task 的 status 写为 `completed`，仍未实证。本 Sprint 的 Golden Path 就是这条真实流水线本身。

## Golden Path（核心场景）

**入口**：Brain tick loop 在 `tasks` 表中拿到一条 `task_type=harness_initiative` 且 `status=pending` 的任务（即本任务自身或同形态的真实任务）

**关键步骤**：
1. Brain 派发 → 进入 LangGraph Layer 1（planner）→ 生成 `sprint-prd.md` 并 push 分支（H9 静默生效）
2. Layer 2a/2b（contract proposer + reviewer GAN）→ APPROVED → 产出 sprint-contract.md + task-plan.json
3. Layer 3 spawn generator sub_task → entrypoint.sh stdout 全量 tee 到 STDOUT_FILE（H7 生效）→ generator 在自己的 task worktree 写代码并 push（PR #2851 logical_task_id 注入）
4. Layer 4 evaluator 切到 generator 的 task worktree（H8 生效）执行验证命令
5. 若 absorption_policy 命中且未真实 applied，状态如实标 `not_applied`（H10 生效），不阻塞 verdict
6. evaluator 给出 PASS → harness 主图把该 initiative task 的 `status` 写为 `completed`，`result` 字段含最终分支/PR 信息

**出口**：
- `tasks` 表中该任务行 `status='completed'` 且 `completed_at IS NOT NULL`
- `result` JSON 含 `branch`、`final_verdict='PASS'`（或同义字段）
- Brain 的 harness 调度日志没有 stuck 状态（无 in_progress 残留、无 callback 404）

## 边界情况

- **GAN 不收敛**：proposer/reviewer 多轮仍发散 → 走 PR #2834 的收敛检测自动 force APPROVED，不挂死
- **generator 子任务失败**：evaluator 给 FAIL → harness 主图标 `status='failed'` 也算端到端走通（completed 与 failed 都是终态，本 PRD 的核心是"链路不再卡 in_progress"，但本任务期望 PASS）
- **Brain 进程中途重启**：依赖 Stream 2 `durability:'sync'` + Stream 5 资源恢复，重启后能 resume，不要求人工介入
- **absorption_policy 触发但未实际应用**：如实标 `not_applied`（H10），verdict 不受影响
- **stdout 含非预期噪音**：JSON 解析需找到最后一个合法 JSON 块，不被中间 push 输出干扰（H9 已收敛主要噪音源）

## 范围限定

**在范围内**：
- 验证从 `harness_initiative` 派发到 `tasks.status='completed'` 终态的整条链路
- 验证 H7/H8/H9/H10 四个修复在真实派发场景下叠加生效
- Brain `tasks` 表写回的 `status` / `completed_at` / `result` 字段正确性

**不在范围内**：
- 修复任何在验证过程中新发现的 bug（这些应作为新的 hot-fix initiative 单独立项）
- 重新设计 LangGraph 架构（Stream 1-5 已收敛）
- 修改 H7/H8/H9/H10 的实现细节（仅做实证）
- Dashboard UI 显示层验证（autonomous journey 不涉及 UI）

## 假设

- [ASSUMPTION: 本 Sprint 自身就是用于验证的"真实任务"——它从被派发到这一刻，已经走过了 planner（即本 SKILL 当前正在跑），后续流水线会自动接管并最终把本任务的 `tasks` 行写到 `completed`]
- [ASSUMPTION: H7/H8/H9/H10 对应的 PR (#2852/#2854/#2853/#2855) 均已并入 main 且 Brain 容器已加载到这些 commit]
- [ASSUMPTION: Brain tick loop 与 PostgreSQL checkpointer 在测试期间保持可用；如 Brain 进程崩溃，期望 Stream 2/5 的恢复机制接管而非 PRD 内显式处理]
- [ASSUMPTION: 端到端"通过"的判定权在 evaluator，本 PRD 只声明终态不卡住，不预判 PASS/FAIL]

## 预期受影响文件

- `sprints/w8-langgraph-v11/sprint-prd.md`：本 PRD 自身（Planner 阶段产物）
- `sprints/w8-langgraph-v11/sprint-contract.md`：Proposer 后续产出
- `sprints/w8-langgraph-v11/task-plan.json`：Proposer 在合同 GAN 通过后倒推产出
- `packages/brain/src/**`：**不期望修改**——任何此处变更都意味着发现新 bug，应单独立项
- 数据库 `tasks` 表：当前 task 行 `status` / `completed_at` / `result` 字段（运行时变更，非代码改动）

## journey_type: autonomous
## journey_type_reason: 验证 Brain tick → harness 派发 → LangGraph 各层 → tasks.status=completed 的自主调度闭环；起点为 Brain tick，无 UI / 无 engine hook / 无远端 agent 协议改动
