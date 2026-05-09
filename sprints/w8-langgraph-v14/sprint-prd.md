# Sprint PRD — W8 v14 LangGraph 真端到端验证（status=completed）

## OKR 对齐

- **对应 KR**：W8 — Brain LangGraph harness pipeline 端到端可达
- **当前进度**：85%（Streams 1-5 + Layer 3 重构 + H7/H8/H9 已合并；H10/H11 假设已落地）
- **本次推进预期**：100%（首次出现 sub_task 在 tasks 表中 status=completed 即视为达成）

## 背景

W8 是把 harness pipeline 从旧 module 调度迁到 LangGraph StateGraph 的初始化。前序工作已完成：

- Stream 1：callback router endpoint + runner POST（PR #2841）
- Stream 2：durability:'sync' + 删 MemorySaver fallback（PR #2843）
- Stream 3：git-fence helper（PR #2840）
- Stream 4：节点幂等门审计（PR #2842）
- Stream 5：Walking Skeleton 1 node + brain kill resume（PR #2844）
- Layer 3：spawnGeneratorNode 重构成 spawn-and-interrupt（PR #2845）
- H7：entrypoint.sh tee stdout 到 STDOUT_FILE（PR #2852）
- H8：evaluator 切到 generator 的 task worktree（PR #2854）
- H9：planner SKILL push noise 静默（PR #2853）
- H10、H11：本次任务派发前已落地的 hardening fix（具体编号外部维护）

历次 v3-v13 真端到端跑都在某一个节点卡住（inferTaskPlan / planner / proposer / generator / evaluator 等），每次卡住产出一个 H 编号 hotfix。v14 是首次假设所有已知卡点已修后的全链路实证。

## Golden Path（核心场景）

Brain 派发一个 harness sub_task → 经过 LangGraph pipeline 全节点 → tasks 表中该 sub_task 行 `status = 'completed'`。

具体：

1. **入口**：调用 `POST /api/brain/tasks` 注册一个 `task_type=harness_initiative` 的任务（最简 PRD 描述，例如"加一个 hello-world 文件"），由 Brain consciousness loop 触发 harness LangGraph 启动。

2. **planner 节点**：harness-planner SKILL 跑通，产出 sprint-prd.md，commit 并推到远端，状态从 PLANNER → PROPOSER。

3. **proposer 节点**：harness-contract-proposer 起草 sprint-contract.md + 拆 task-plan.json，commit 并推到远端。

4. **GAN 收敛**：reviewer 与 proposer 多轮对抗直至 APPROVED（或 GAN 收敛检测自动 force APPROVED），状态进 GENERATOR。

5. **generator 节点**：spawn-and-interrupt 模式启动子 agent 容器跑 harness-generator，写代码、commit、push 一个 PR，sub_task 通过 callback 通知 Brain 完成。

6. **evaluator 节点**：在 generator 的 task worktree（H8 修复后）跑 sprint-evaluator 验证命令，全部 PASS。

7. **出口（核心可观测结果）**：在 PostgreSQL `tasks` 表中查到至少一行 `task_type IN ('harness_generator','harness_evaluator','harness_initiative')` 且 `status = 'completed'`，且对应的 PR 已被合并或处于 ready-to-merge 状态。

## 边界情况

- **GAN 不收敛**：到达发散判定阈值后由 GAN 收敛检测 force APPROVED（PR #2834 已实现），不应卡住 pipeline。
- **某节点偶发失败**：LangGraph PgCheckpointer 应能从中断点续跑，不需要从头重启 pipeline。
- **codex CLI 无 credentials**：本次验证假设 codex agent 有 1Password 凭据；若无应在 spawn 时 fail-fast 而非死循环。
- **callback 404**：H7 + entrypoint.sh 的 HARNESS_CALLBACK_URL env 变量已修，本次假设 callback 链路通畅。
- **worktree 串扰**：H8 已修 evaluator 切到 generator 的 task worktree；不再共享 initiative worktree。
- **status 假阳性**：absorption_policy 不再假装 applied（PR #2855），所以 status=completed 必须真正源自 evaluator 通过。

## 范围限定

**在范围内**：
- 通过一次最简 harness sub_task 实证 LangGraph pipeline 全链路可达 status=completed
- 验证 PostgreSQL tasks 表写入正确
- 验证 PR 落地（commit/push/merge 任一可达）
- 收集本次跑中节点耗时、GAN 轮数、failure points 形成数据点

**不在范围内**：
- 性能基准（耗时优化留给后续 sprint）
- 多 sub_task 并发（本次仅一条单 path 实证）
- harness-planner / proposer / evaluator SKILL 内部逻辑修改（已冻结）
- Dashboard UI 改动
- 修复任何**新发现**的 bug（若 v14 又卡住，应停下回到 hardening loop 起 H12，不在本 sprint 内即兴修）

## 假设

- [ASSUMPTION: H10/H11 在派发本任务前已合并到 main，本任务只跑验证不修代码]
- [ASSUMPTION: codex agent 容器、Brain Postgres、git remote 三方都正常可用]
- [ASSUMPTION: "真端到端" = 没有 mock，没有手工 status update，全部状态写入由 Brain LangGraph pipeline 驱动]
- [ASSUMPTION: 验证标的 sub_task 内容可以是最简单的"创建一个文件 / 改一行字"，重点是 pipeline 跑通而非任务复杂度]

## 预期受影响文件

- `sprints/w8-langgraph-v14/sprint-prd.md`：本 PRD
- `sprints/w8-langgraph-v14/sprint-contract.md`：Proposer 后续产出
- `sprints/w8-langgraph-v14/task-plan.json`：Proposer 后续产出
- `sprints/w8-langgraph-v14/run-evidence.md`：Evaluator 后续产出（记录 tasks 表状态、PR 链接、节点耗时）
- 一个或多个由 generator 创建的演示 PR（内容微不足道，目的为驱动 pipeline）

注：本任务**不修改** packages/brain / packages/engine / packages/workflows 任何代码。验证型 sprint。

## journey_type: autonomous
## journey_type_reason: W8 LangGraph pipeline 由 Brain consciousness loop 自主驱动，整链路无 UI 介入也无远端 agent 协议改动，落点在 packages/brain 运行时行为。
