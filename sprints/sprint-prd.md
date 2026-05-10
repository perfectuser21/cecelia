# Sprint PRD — Brain LangGraph 5 节点流水线最小闭环验证

## OKR 对齐

- **对应 KR**：KR-Harness-Reliability（Brain 自主交付链路稳定性）
- **当前进度**：[ASSUMPTION: 未知，Brain API 当前不可达，暂以 70% 估算]
- **本次推进预期**：+5%（一次端到端 happy-path 跑通即视为推进）

## 背景

Brain 已实装 5 节点 LangGraph 流水线（Planner → Proposer → Reviewer → Generator → Evaluator），但尚未在"最小可观测目标"上完整跑通一次 `completed + APPROVED + MERGED`。

父任务 W8 v18 generator (ws1) 派发本 child harness_initiative，目的是用一个**功能改动尽可能小、但 CI 可验证**的目标，证明 5 节点流水线在真实 GAN 对抗 + worktree + push + PR + Evaluator 验收 + 自动合入这条完整链路上能闭环。

不在本次范围：流水线**性能**优化、错误恢复路径加固、观测面板增强。本次只证明 happy path 走得通。

## Golden Path（核心场景）

系统从 [父任务 W8 派发 child harness_initiative] → 经过 [Brain LangGraph 5 节点完整执行] → 到达 [child PR 合入 main + 父任务收到 completed 回执]

具体：

1. **触发条件**
   - 父任务 W8 v18 generator (ws1) 已经把本 child task（id=fe91ce26-…）写入 brain.tasks，task_type=harness_initiative，status=pending
   - Brain tick 调度器在下一次 5 分钟 execute window 选中此任务

2. **系统处理**
   1. **Planner 节点**：读取本任务 description，产出 `sprints/sprint-prd.md`（即本文件），commit 到 child 分支
   2. **Proposer 节点**：基于 PRD 产出 `sprints/sprint-contract.md`（含 Golden Path 验证命令）+ 从 Golden Path 倒推的 task DAG（task-plan.json）
   3. **Reviewer 节点**：对 contract 多轮 GAN 对抗，达成共识后标记 APPROVED
   4. **Generator 节点**：在 worktree 内按合同 commit 1 (Red) / commit 2 (Green) 完成代码改动 + push 出 PR
   5. **Evaluator 节点**：对 PR 拉起 contract-verify，全部验证命令 exit 0 → 标 APPROVED → 触发自动合入

3. **可观测结果**
   - GitHub 上出现 child PR，title 带 harness 标记，状态为 MERGED
   - brain.tasks 中本 task 的 status=completed，result.merged=true，result.pr_url 指向已合入 PR
   - 父任务 W8 v18 ws1 通过 child 回执感知到 child completed
   - `git log main` 出现一条 child commit，内容是"最小可观测目标"的真实改动（不是空 commit）

## 边界情况

- **Reviewer 卡住多轮不收敛** → Reviewer skill 自身有"无实质漏洞必须 APPROVED"约束，最多 3-4 轮内收敛；若超出则视为流水线失败
- **CI 失败** → Evaluator 依据 contract-verify 反馈打回 Generator 修复，循环直至 PASS 或触发 watchdog 超时
- **worktree 创建失败 / push 凭据缺失** → 已由近期 H13/H16 修复（origin set-url 到 GitHub），本次依赖该修复已生效
- **空 commit** → 必须有真实可观测改动；Evaluator 的合同验证命令需能在改动**前**失败、改动**后**通过，证明确实有可观测变化
- **父任务回写失败** → child 完成后必须更新 brain.tasks status；若回写失败，父 W8 ws1 会卡住等不到 child 完成

## 范围限定

**在范围内**：
- 跑通一次 5 节点 LangGraph happy path
- 产生一个 minimal-but-real 改动并合入 main
- 父任务能感知 child completed

**不在范围内**：
- 流水线吞吐 / 延迟优化
- Reviewer / Evaluator 提示词调优
- 多 child 并发场景
- 失败恢复、retry 策略加强
- 观测 dashboard 增加新指标

## 假设

- [ASSUMPTION: Brain API localhost:5221 在 Brain 主进程节点上是可达的，仅本 Planner 执行环境隔离造成 unreachable，不影响 Proposer/Generator/Evaluator 在 Brain 主机上跑]
- [ASSUMPTION: harness-credentials.js 的 GH_TOKEN 已注入 worktree origin，能完成 push + PR + auto-merge（依据近期 H16 commit）]
- [ASSUMPTION: 父 W8 v18 ws1 在等 child 回执，child task_id=fe91ce26-... 是父预期的同一个]
- [ASSUMPTION: "最小可观测目标"由 Proposer 在 contract 阶段决定具体形态（例如新增一个常量 export + 单测断言），Planner 不在 PRD 里钉死实现]

## 预期受影响文件

- `sprints/sprint-prd.md`：本文件，Planner 产出
- `sprints/sprint-contract.md`：Proposer 后续产出
- `sprints/task-plan.json`：Proposer 从 Golden Path 倒推的任务 DAG
- `tests/ws1/*.test.{js,ts}`：Generator 在 commit 1 (Red) 写入的合同测试
- `packages/brain/src/**` 或 `packages/engine/src/**` 中**一个**最小目标文件：Generator 在 commit 2 (Green) 落地的真实改动（具体路径由 Proposer 在 contract 中钉死）
- `brain.tasks`（数据库）：task fe91ce26-... 的 status / result 字段被更新

## journey_type: autonomous
## journey_type_reason: 本任务是 Brain 内部 LangGraph 流水线的自验证，不涉及 dashboard UI、不依赖外部 agent，属于 Brain 自主闭环范畴
