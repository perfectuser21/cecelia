# Sprint PRD — W8 LangGraph v18 真端到端验证

## OKR 对齐

- **对应 KR**：KR-W8（Harness LangGraph 化 — 真端到端跑通到 status=completed）
- **当前进度**：H7/H8/H9/H10/H11 已合入主干（PR #2852/#2853/#2854/#2856/#2857），但尚未验证一次完整 Initiative 真实跑到 `task.status = "completed"`
- **本次推进预期**：完成「真跑一次、跑到底、状态落库」的闭环验证，KR-W8 推进到 100%

## 背景

W8 LangGraph 重构在前序 v14–v17 多次撞墙：
- v14 evaluator 找不到 DoD 产物（H13 修复）
- v15 stdout 丢失（H7 修）
- v16 evaluator 走错 worktree（H8 修）/ proposer 不验证 origin push（H10 修）
- v17 子任务 worktree key 冲突（H11 修）/ planner SKILL 推送噪声（H9 修）

至此，5 个 H 系列治本补丁全部合入。但**没有任何一次端到端真实运行**证明：从 Initiative 派发 → Planner → Proposer GAN → Generator → Evaluator → Reporter，最后 Brain DB 中对应任务 `status = completed`。本 Sprint 就是这一次「真跑」的实证 Sprint，不引入新功能、不再修补丁，只用现有代码、真实账户、真实容器、真实 GitHub，把闭环走通一次并把证据钉死。

[ASSUMPTION: Brain API（localhost:5221）当前在本会话的 worktree 容器里不可达；验证将在 Brain 主进程实际运行的宿主环境中进行]

## Golden Path（核心场景）

操作者从 [对一个小型 Initiative 调用 `/api/brain/tasks` 派发 `harness_initiative`] → 经过 [Brain LangGraph 自动执行 Planner → Proposer GAN → Generator → Evaluator（必要时回环）→ Reporter，全程容器化、调真账户、真 GitHub PR] → 到达 [Brain `tasks` 表中该 Initiative 任务行 `status = "completed"`，且 `result` 字段含 `pr_url` / `report_path` / `evaluator_verdict = APPROVED`]

具体：
1. **触发条件**：操作者通过 `POST localhost:5221/api/brain/tasks` 创建一条 `task_type = harness_initiative` 的任务，PRD 描述选用本 Sprint 指定的"小目标 Initiative"（见下方"范围限定"）。
2. **系统处理**：
   - Brain Tick 拾取任务，进入 LangGraph 状态机
   - Planner 节点产出 `sprint-prd.md`（Golden Path 格式）+ commit + push
   - Proposer 节点 GAN 多轮，产出 `sprint-contract.md` + `task-plan.json`，Reviewer APPROVED
   - 按 `task-plan.json` 派发 `harness_generate` 子任务（每 workstream 一个），各子任务在独立 worktree（key = `<init8>-<logical>`）跑 Generator → 产 commit/push → 开 PR
   - Evaluator 节点切到对应子任务 worktree，跑 DoD 验证命令，逐条 PASS
   - Reporter 节点汇总产出 `harness-report.md`，commit/push
   - 整个流程的 stdout 全部 tee 到 `STDOUT_FILE`（H7），可回溯
3. **可观测结果**：
   - `curl localhost:5221/api/brain/tasks/<initiative_id>` 返回 `status: "completed"`
   - `result.pr_url` 指向真实 GitHub PR（HTTP 200）
   - `result.report_path` 指向 repo 中 `sprints/<run-id>/harness-report.md`（已合入或可见于 PR diff）
   - `result.evaluator_verdict = "APPROVED"`
   - 所有子任务（`harness_generate` / `harness_evaluate` / `harness_report`）的 `status` 均为 `completed`，无 `failed` / `stuck`
   - Brain 日志中无 `PROBE_FAIL_*` / `BREAKER_OPEN` / `WORKTREE_KEY_COLLISION` / `STDOUT_LOST` / `EVALUATOR_DOD_NOT_FOUND` 等已知失败模式

## 边界情况

- **GAN 不收敛**：若 Proposer/Reviewer 多轮无收敛，Brain 现有"收敛检测取代 MAX_ROUNDS"机制（PR #2834）应触发 force APPROVED；本 Sprint 验证此机制在真跑中确实生效。
- **账户配额耗尽**：H14 已移除 account3，剩余 account1/2 + 5 个 codex team 应满足一次小型 Initiative；若中途配额耗尽，Sprint 视为 BLOCKED 而非 FAIL，需在报告中如实说明。
- **GitHub push 失败**：H10 已在 proposer 节点验证 origin push；若仍失败，应保留容器日志和分支本地状态供调查，不得静默吞掉。
- **冷启动 race**：H6（PR #2862/#2863/#2866）已修 cold-start probe-vs-consolidation race；验证开始前确认 Brain 已就绪（`/api/brain/context` 200）。
- **子任务 worktree 串台**：H11 已用复合 key；验证中若发现两个 workstream 在同一 worktree 互相覆盖 commit，立即终止并报告。
- **Reporter 失败**：若 Reporter 节点本身失败但代码已合并、Evaluator APPROVED，则视为 PARTIAL（KR 推进 80%），需手工补 report 后才标 completed。
- **空 Initiative**：若选定的"小目标 Initiative" Proposer 拆出 0 子任务，视为退化路径，需重新选目标。

## 范围限定

**在范围内**：
- 在真实环境（Brain 主进程 + Docker + 真账户 + 真 GitHub）跑一次完整 `harness_initiative`
- 选定的 Initiative 必须是「小目标」：单一 workstream，预期 1–2 个 PR，DoD 命令可在 < 10 分钟内跑完
- 全程不人工干预（不允许中途手改 task 状态、不允许手动重派子任务、不允许手动开 PR）
- 收齐证据：Brain task 行 JSON 快照 + GitHub PR URL + repo 中 report 文件 + 关键节点 stdout 片段
- 输出 `sprints/w8-langgraph-v18/harness-report.md` 总结这次真跑的全部观测

**不在范围内**：
- 不再写新的 H 系列补丁（如真跑暴露新缺陷，记录在报告"residual issues"，开后续 Initiative 处理，本 Sprint 不修）
- 不重构 LangGraph 拓扑
- 不调整 ACCOUNTS 名单
- 不改 SKILL.md 内容
- 不做性能调优
- 不验证 dashboard 可视化（W8 范围之外）
- 不做大型 Initiative 真跑（多 workstream / 跨 package 的留给后续 Sprint）

## 假设

- [ASSUMPTION: 本会话所在 worktree 容器内 Brain API 不可达；真验证由 Brain 宿主进程负责执行，本 Sprint 产出的 PRD/contract 走 harness 自身派发回宿主环境]
- [ASSUMPTION: H7/H8/H9/H10/H11 在 main 分支（HEAD = 3767c9937）已全部生效，无需再次 cherry-pick]
- [ASSUMPTION: account1/account2 + 5 个 codex team 当前可用配额足以跑一次小型 Initiative]
- [ASSUMPTION: GitHub remote `origin` 凭据在 Brain 容器内已挂载]
- [ASSUMPTION: 本 Sprint 选定的"小目标 Initiative"由 Proposer 在合同 GAN 阶段最终敲定具体内容；候选范围 = 文档微调 / 单文件 lint 修复 / 一行 schema 默认值变更 / 单元测试新增]
- [ASSUMPTION: 验证期间不并行触发其他 `harness_initiative`，避免容器资源争抢]

## 预期受影响文件

- `sprints/w8-langgraph-v18/sprint-prd.md`：本 PRD（Planner 产出）
- `sprints/w8-langgraph-v18/sprint-contract.md`：Proposer 产出的 Golden Path 合同
- `sprints/w8-langgraph-v18/task-plan.json`：Proposer 从 Golden Path 倒推的子任务 DAG
- `sprints/w8-langgraph-v18/harness-report.md`：Reporter 产出的最终报告，含真跑全部观测证据
- `sprints/w8-langgraph-v18/eval-round-*.md`：Evaluator 每轮 DoD 验证记录
- `packages/brain/src/**`：**只读**，本 Sprint 不修改，仅验证现有行为
- 选定小目标 Initiative 涉及的具体文件：由 Proposer 在合同阶段确定（候选见"假设"段）

## journey_type: autonomous
## journey_type_reason: 本任务在 Brain 主进程内自主跑 LangGraph harness pipeline，全程无 dashboard UI、无远端 agent 协议、不修 engine hooks/skills，只验证 packages/brain/ 既有代码在真实环境的端到端行为
