# Sprint PRD — W8 v17 LangGraph 真端到端验证（status=completed 收官）

## OKR 对齐

- **对应 KR**：KR-langgraph-harness-reliability（Brain 派 harness initiative 任务每次跑通交付，全程无人干预）
- **当前进度**：v14 跑出 PR / v15-v16 暴露 H10/H11/H13/H15 修补轮，**`tasks.status` 仍未稳定走到 `completed`**
- **本次推进预期**：在 H7/H8/H9/H10/H11（含已合并的 H12/H13/H14/H15）全部上线后，端到端跑一次完整 harness initiative，让 PostgreSQL `tasks` 表对应行 `status='completed'` 由 Brain 自身在 Brain → docker → callback → executor 全闭环里写入，宣告 W8 收官

## 背景

W8 是把 LangGraph 1.2.9 已有但未启用的可靠性原语 + docker-executor 边界 bug + sub-task worktree 协议一并补齐的 sprint（spec: `docs/superpowers/specs/2026-05-06-harness-langgraph-reliability-design.md`）。

v14 跑出 PR 但 evaluator 没真验副作用 → v15 hotfix → v16 暴露 H10 (proposer verify+push) / H11 (sub-task worktree key) / H13 (import contract artifacts) / H15 (contract-verify SSOT)。截至今天（2026-05-10），相关 PR 已合：
- #2862, #2863, #2866, #2864, #2867（H10/H11/H12/H13/H14/H15 chain，git log 可见）

**剩余唯一悬而未决的事情**：在所有补丁都进 `main` 之后，Brain 派一个真实 harness initiative，让它自然走到 `tasks.status='completed'`，没有任何人手撕 SQL、没有 Docker stuck、没有 worktree key 冲突、没有 contract 假绿灯。**v17 = 收官实证**。

参考：
- `docs/learnings/w8-langgraph-v14-e2e.md`（v14 skeleton 任务样板）
- `docs/superpowers/specs/2026-05-09-h11-subtask-worktree-key-design.md`
- `docs/superpowers/specs/2026-05-10-h15-contract-verify-design.md`
- `docs/superpowers/reports/2026-05-06-harness-langgraph-reliability-progress.md`

## Golden Path（核心场景）

Brain 从 [tasks 表 `status='pending'` 的 harness initiative 任务] → 经过 [executor 调 LangGraph full graph (planner → proposer GAN → reviewer → generator → evaluator) + docker 子容器执行 + contract-verify 真验副作用 + callback 写库] → 到达 [`tasks` 表对应行 `status='completed'` 且 `result` JSON 含 PR URL]

具体：

1. **触发条件**
   - 在 PostgreSQL `tasks` 表插入一条 `task_type='harness_initiative'`、`status='pending'` 的初始任务
   - payload 内含 sprint dir 指向本 sprint（`sprints/w8-langgraph-v17`），任务目标是产出一个 walking skeleton learnings 文件并推 PR（沿用 v14 noop-PR 模式）
   - Brain tick loop（5s 轮询）发现该 task → executor 路由到 harness_initiative 分支

2. **系统处理**（Brain 全自动，零人工干预）
   - executor 用 `harness-initiative:<initId>:1` 作 thread_id 调编译好的 LangGraph，PostgresSaver checkpointer 落 checkpoint
   - planner 节点产 PRD（即本文件的等价物，由 Brain 内部跑）
   - proposer GAN 多轮 + reviewer 收敛，proposer 节点末尾经 H15 `contract-verify.js` 的 `verifyProposerOutput` 真验 origin 上 propose_branch 已存在
   - fan-out 创建 sub_task，每个 sub_task worktree 走 H11 的 `harnessSubTaskWorktreePath(initiativeId, logicalTaskId)` 协议（`task-<init8>-<logical_id>`）
   - generator sub_task 容器在隔离 worktree 起，产出 learnings 文件并推 sub_task 分支到 origin
   - generator 节点末尾经 contract-verify 验 sub_task 分支上目标文件真存在（H13 import contract artifacts 路径）
   - evaluator 节点切到 sub_task worktree（H8）拉对应分支跑 DoD 校验，PR 在 GitHub OPEN 即合规
   - 每个 sub_task callback 回写 `tasks` 子行 `status='completed'`
   - 主 initiative graph 收所有 sub_task 完成后，executor 把主 task 行 `status` 写为 `completed`，`result` JSON 内含 PR URL

3. **可观测结果**
   - PostgreSQL：`SELECT status, result FROM tasks WHERE id='<initiative_task_id>'` → `status='completed'`，`result->>'pr_url'` 是合法 GitHub PR URL
   - GitHub：上述 PR URL 可访问，状态 OPEN（不要求合并），diff 仅含 `sprints/w8-langgraph-v17/` 与 `docs/learnings/w8-langgraph-v17-e2e.md` 这类 skeleton 文件
   - Brain 日志：从 task 入库到 status=completed 全程无 `manual SQL`、无 `force kill docker`、无 `delete from checkpoints`，无 stuck 90 min 超时
   - 同 task_type 再派一次（task fresh 入库）应在合理时间内（≤ 30 min wall clock）再次走到 completed，证明非偶然成功

## 边界情况

- **Brain 重启在中途**：thread_id 版本化（W1）必须按设计生效——同一 initiative 第二次执行 attempt 自动 +1，新 thread_id，不无脑续旧 stuck checkpoint
- **docker 容器 OOM/SIGKILL**：W6 docker-executor 边界修复必须正确 reject Promise，invoke 链不 hang
- **proposer push 失败**：H10 + H15 的 contract-verify 必须 throw `ContractViolation`，由 retryPolicy 触发节点级 retry 而不是整 graph 失败
- **sub_task logical_id 短**（如 `ws1`）：H11 的 wtKey 协议必须生效，不再触发"taskId must be ≥8 chars"
- **callback 错过窗口**：sub_task 完成回写如果 callback 队列卡住，executor 必须有兜底（callback-queue-persistence 已有机制）让主 graph 不无限挂起
- **多 sub_task 并发同分支冲突**：每 sub_task 独立 worktree + 独立分支（H11），不互相覆盖
- **PR rate limit / origin 推送瞬时失败**：retryPolicy 应吸收瞬时错，最终 push 成功

## 范围限定

**在范围内**：
- 跑一次真实 W8 v17 harness initiative，目标 walking skeleton noop-PR（同 v14 模式，写一个 `docs/learnings/w8-langgraph-v17-e2e.md`）
- 验证 `tasks.status='completed'` 由 Brain 自动写入
- 验证 PR 在 GitHub OPEN
- 收集节点级 duration / GAN 轮次 / sub_task 数量等运行时证据，回填进 learnings 文件
- 失败时记录 root cause + reproducer 而不是再补一个 hotfix（再补就开 v18）

**不在范围内**：
- 不重新设计 LangGraph 节点拓扑
- 不引入新的可靠性原语（W1-W6 已是 W8 全集）
- 不改 H7/H8/H9/H10/H11/H13/H15 已落地的代码（除非 v17 实证暴露新 bug，那再开 H16+）
- 不要求 PR 被合并，OPEN 即可
- 不验证 LiveMonitor stream / interrupt() 这类 v18+ 议题
- 不做性能压测（≤30 min wall clock 是 sanity check，非 SLA）

## 假设

- [ASSUMPTION: H7/H8/H9/H10/H11/H13/H15 对应 PR 全部已 merge 到 main，main HEAD 含全部修复（git log 顶部 5 commit 已含 H14/H15，待真跑前确认 H7-H11 也已落）]
- [ASSUMPTION: PostgreSQL `cecelia` 库 + Brain 5221 服务在执行环境中均可用]
- [ASSUMPTION: Docker daemon 健康，能拉/起 Claude Code 子容器，cgroup 限额未撞上 host OOM]
- [ASSUMPTION: GitHub origin 凭据在 host 已配置，能 push 与 ls-remote]
- [ASSUMPTION: 跑测过程中 30 min 内 Brain 不会被外部重启（如真重启，按 W1 thread_id 版本化覆盖）]
- [ASSUMPTION: walking skeleton noop-PR 本身不触碰 `packages/brain` `packages/engine` `packages/workflows` 运行时代码——只动 sprints/ 与 docs/learnings/]

## 预期受影响文件

- `sprints/w8-langgraph-v17/sprint-prd.md`：本文件（Planner 产出）
- `sprints/w8-langgraph-v17/sprint-contract.md`：Proposer 在合同 GAN 后产出
- `sprints/w8-langgraph-v17/task-plan.json`：Proposer 在合同 APPROVED 后倒推 DAG
- `docs/learnings/w8-langgraph-v17-e2e.md`：Generator sub_task 在执行期产出（含填好的 run_date / node_durations / pr_url 等真实数据）
- PostgreSQL `tasks` 表：本 initiative_id 对应行最终 `status='completed'`（不是文件，但是核心可观测信号）
- 不修改任何运行时代码（packages/brain, packages/engine, packages/workflows 均零变更）；本 sprint 的"产物"主要是**真实运行轨迹证据**

## journey_type: autonomous
## journey_type_reason: 整个 sprint 验证 Brain 内部 LangGraph harness 全自动闭环（tick loop → executor → docker → callback → status update），不涉及 dashboard UI，docker 子容器虽是 agent 但入口和收口都在 Brain，属于 autonomous 路径起点
