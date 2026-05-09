# Sprint PRD — W8 v15 真端到端验证（status=completed）

## OKR 对齐

- **对应 KR**：Harness 自驱免疫系统稳定性 KR（LangGraph 改造收官 → 端到端可信）
- **当前进度**：H7（stdout tee）/ H9（planner push 静默）/ H8（evaluator worktree 切换）/ H10 / H11 / absorption_policy 诚实化 已逐个落地
- **本次推进预期**：从"零散修复后单点回归通过"推进到"一条 Initiative 完整跑通 LangGraph harness 并 status=completed"，关闭 v15 这一轮的不确定性

## 背景

W8（LangGraph 改造）经过 v1–v14 多轮迭代，已经合入一连串关键修复：

- H7（PR #2852）：Brain 容器 entrypoint.sh 把 stdout 同步 tee 到 STDOUT_FILE，让 evaluator 能稳定读到 generator 输出
- H8（PR #2854）：evaluator 切到 generator 创建的 task worktree，不再在错误目录上运行验证命令
- H9（PR #2853）：harness-planner SKILL 的 push 噪音静默，避免在无凭据 worktree 里炸日志
- H10 / H11：（依据 git log 推断为 LangGraph 后续小修，列入 PRD 末尾假设）
- absorption_policy（PR #2855）：触发逻辑诚实化，不再假装 applied

每一个修复都通过了局部回归，但 v15 之前**没有任何一次完整的 initiative 真正跑到 status=completed**。本 sprint 的存在目的就是闭环这件事：**真端到端跑一次，亲眼看到 status=completed**。

如果 v15 失败，根因要被准确归到具体节点（planner / proposer / generator / evaluator / absorption），而不是再次"模糊地不通过"。

## Golden Path（核心场景）

系统/运维者从 [向 Brain 派发一个 harness Initiative] → 经过 [LangGraph 全流程节点运转] → 到达 [Brain 中该 initiative 的 status 字段稳定显示 completed]

具体：

1. **触发条件**：Brain 收到一个真实 harness Initiative 任务（非 mock、非干跑），描述足够小、目标足够清晰，能被 planner 一次产出可批准的 PRD
2. **系统处理**：
   - planner 节点产出 sprint-prd.md 并 commit/push（H9 后无噪音）
   - proposer/reviewer GAN 收敛产出 approved sprint-contract.md 并倒推 task-plan.json
   - 每个 sub-task 在独立 task worktree 中由 generator 跑通（H7 stdout 完整捕获）
   - evaluator 在同一 task worktree 里执行合同验证命令（H8）并产出 PASS/FAIL
   - 所有 task PASS 后 Initiative 进入 absorption 阶段，absorption_policy 诚实地报告 applied/skipped（不再假阳性）
   - Initiative 写回 status=completed
3. **可观测结果**：
   - Brain DB 中该 initiative 行 `status='completed'`
   - 该 initiative 的所有 sub-task 行 `status='completed'`，没有 `failed`/`stuck` 残留
   - 关联的 LangGraph checkpointer 记录显示流程一次性走完，没有 resume/retry 风暴
   - sprint 目录下 sprint-prd.md / sprint-contract.md / task-plan.json 三件齐全且彼此一致

## 边界情况

- **GAN 长时间不收敛**：v15 之前已用收敛检测取代硬 MAX_ROUNDS（PR #2834），如果出现 force APPROVED 必须显式记录在最终报告里，不能藏在日志深处
- **某个 sub-task evaluator FAIL**：必须能进入 generator fix 循环并最终 PASS；如果走到 fix 上限仍 FAIL，本次 v15 视为失败，但失败必须有明确节点定位（不是"不知道为什么没 completed"）
- **Brain 容器中途崩溃 / 被 kill**：LangGraph durability:'sync'（PR #2843）应保证 resume 后从最近 checkpoint 续跑，不应回到起点
- **absorption 阶段没有可吸收的产物**：absorption_policy 必须如实标 skipped，initiative 仍可 completed（不能因为没东西吸收就阻塞）
- **同一 initiative 已有历史 worktree 残留**：H8 之后 evaluator/generator 各自 task worktree，不应共享 initiative worktree（PR #2851）

## 范围限定

**在范围内**：
- 真实派发一个 harness Initiative，全程使用本仓库实际的 brain / langgraph / harness skills 链路
- 观察并验证 initiative 与所有 sub-task 在 Brain 中最终状态
- 失败时给出可定位的节点级归因（哪个 node 卡住 / 错在哪）
- 把 v15 通过/未通过的事实落到 sprint 报告中

**不在范围内**：
- 不新增 LangGraph 节点能力，不重构 graph 结构
- 不改 absorption_policy / GAN 收敛 / evaluator 等核心算法（H7-H11 已合入，本 sprint 只验证）
- 不引入新的 user_facing UI / dashboard 改动
- 不做性能优化、不调 timeout 阈值（除非 v15 失败且根因明确指向 timeout）

## 假设

- [ASSUMPTION: H10 与 H11 已合入 main，且性质与 H7-H9 类似——LangGraph harness 链路上的小型 honesty/wiring 修复，不需要在本 sprint 重新设计]
- [ASSUMPTION: 验证用的 Initiative 任务规模足够小，能在合理 wall clock 内（≤ 30 分钟）跑完 planner→proposer→generator→evaluator→absorption 全链路]
- [ASSUMPTION: Brain 容器、Postgres checkpointer、外部 agent bridge 在执行期间持续在线；本 sprint 不负责修任何基础设施级中断]
- [ASSUMPTION: "status=completed" 在当前 Brain schema 中是一个稳定的、可被外部脚本/curl 直接读到的最终状态，不是中间瞬态]
- [ASSUMPTION: 真端到端意味着不打 mock、不跳节点、不走 dry-run；验证脚本只读 Brain DB 与 sprint 目录文件]

## 预期受影响文件

- `sprints/w8-langgraph-v15/sprint-prd.md`：本 PRD 自身
- `sprints/w8-langgraph-v15/sprint-contract.md`：Proposer 阶段产出的合同
- `sprints/w8-langgraph-v15/task-plan.json`：Proposer 从 Golden Path 倒推出的 task DAG
- `sprints/w8-langgraph-v15/run-report.md`：执行结果报告（PASS/FAIL + 节点级归因）
- 可能涉及只读：`packages/brain/src/**/*`（验证 LangGraph 节点行为，不修改）
- 可能涉及只读：Brain DB 的 `harness_initiatives` / `harness_tasks` 行（查询 status）

## journey_type: autonomous
## journey_type_reason: 全流程在 Brain 内部 LangGraph 上跑，无 dashboard UI、无外部 agent 远端协议变更、无 dev pipeline hooks 改动；仅观察 Brain 自治运转能否真到 completed
