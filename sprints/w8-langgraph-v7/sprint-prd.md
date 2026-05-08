# Sprint PRD — W8 Acceptance v7：LangGraph 修正全套 14 节点端到端验证

## OKR 对齐

- **对应 KR**：KR-Harness-Reliability（LangGraph harness 在生产配置下能稳定执行完整 Initiative 闭环）
- **当前进度**：Stream 1-5 + Layer 3 + ganLoop checkpointer hotfix 均已合并（PR #2841-#2846），但尚未做 hotfix 后的全图实证
- **本次推进预期**：从「单点修正都已合并」推进到「14 节点端到端在 PgCheckpointer 真持久化下走通一次」

## 背景

过去两周对 harness LangGraph 图（`packages/brain/src/workflows/harness-initiative.graph.js`）做了多 Stream 修正：
- Stream 1（#2841）callback router endpoint + runner POST
- Stream 2（#2843）durability:'sync' + 删除 MemorySaver fallback
- Stream 3（#2840）git-fence helper（修 refspec bug）
- Stream 4（#2842）节点幂等门审计
- Stream 5（#2844）Walking Skeleton 1node + brain kill resume 实证
- Layer 3（#2845）spawnGeneratorNode 重构为 spawn-and-interrupt 模式
- Hotfix（#2846）runGanLoopNode 自动 getPgCheckpointer 兜底

每个 Stream 都自带局部测试，但没有把 hotfix 后的"完整 14 节点图"在真实 Pg 持久化下完整跑一次。本 W8 是验收门：跑完后才能宣称 LangGraph 修正阶段收尾。

## Golden Path（核心场景）

Brain 接到一个 Initiative 任务请求 → 经过 14 节点 LangGraph 图依次执行 → 到达 Initiative 终态（成功 report 或 terminal_fail），并在 PgCheckpointer 留下完整可恢复的 checkpoint 链路。

具体：

1. **触发条件**：在测试环境（docker-compose）以 `harness_initiative` task_type 派发一条最小 Initiative 任务，PRD 描述足够触发任务推断（inferTaskPlan 至少切出 1 个子任务）。

2. **系统处理**（按图顺序，14 个节点必须全部命中或合法跳过）：
   1. `prep` — 准备 Initiative 上下文，校验 task 字段
   2. `planner` — 调 Planner skill 产出 sprint-prd.md
   3. `parsePrd` — 解析 PRD 拿到 journey_type 等字段
   4. `ganLoop` — Proposer/Reviewer GAN 对抗到 APPROVED（hotfix 兜底确认 PgCheckpointer 自动注入生效）
   5. `inferTaskPlan` — 从合同倒推 task DAG，至少 1 个子任务
   6. `dbUpsert` — 子任务写 brain_tasks 表
   7. `pick_sub_task` — 取下一个待跑子任务（首次进入循环）
   8. `run_sub_task` — spawn Generator 远端执行（Layer 3 spawn-and-interrupt 模式）
   9. `evaluate` — Evaluator 判 PASS/FAIL（至少跑一轮 PASS）
   10. `advance` — 子任务索引推进（PASS 路径必经）
   11. `retry` — FAIL 路径合法跳过即可（不强制必须命中）
   12. `terminal_fail` — 同上，合法跳过即可
   13. `final_evaluate` — 所有子任务完成后总验收
   14. `report` — 写 dev-records、回写 task 状态

3. **可观测结果**：
   - Brain task 状态最终为 `completed` 或 `failed`（不能停在 in_progress）
   - PgCheckpointer 中有完整 checkpoint 链路，14 节点 each at least one entry，可通过 thread_id 查询到
   - dev-records 表至少 1 条新增记录关联本次 Initiative
   - 整个执行过程不依赖 MemorySaver fallback（Stream 2 删除已生效）
   - kill brain 进程后用同 thread_id resume 能从最近 checkpoint 续跑（Stream 5 实证延伸）

## 边界情况

- **GAN 不收敛**：合同 GAN 多轮无法 APPROVED → 应触发 force APPROVED 收敛检测（PR #2834），不允许进 dead loop
- **Generator 远端 spawn 失败**：spawn-and-interrupt 模式下，远端进程未回调 → 应被 callback 超时机制捕捉，进 retry 或 terminal_fail
- **节点幂等性**：在 ganLoop / dbUpsert / inferTaskPlan 等节点，重启 brain 后 resume 不应重复副作用（Stream 4 幂等门已审计，本次复检）
- **PgCheckpointer 不可用**：DB 连接失败时 ganLoop 不再 fallback 到 MemorySaver（Stream 2），应直接 fail-fast 报错（不静默降级）

## 范围限定

**在范围内**：
- 14 节点完整端到端执行的实证（at least one full run）
- PgCheckpointer 真持久化（不允许 MemorySaver）
- 节点幂等性的运行时复检（resume 不重复副作用）
- kill-resume 在 14 节点图上的实证（不只是 1 节点 walking skeleton）
- 失败路径的合法跳过验证（retry/terminal_fail 不被命中也算合法）

**不在范围内**：
- LangGraph 框架本身的升级
- 新增节点或修改图结构
- Generator/Evaluator skill 内部实现的优化
- UI 可视化（autonomous journey，无 UI）
- 性能基准（只看正确性，不看 latency）

## 假设

- [ASSUMPTION: 测试环境的 docker-compose 已就绪，Pg + Brain + Bridge 都能起来]
- [ASSUMPTION: 至少有 1 个可用的 Generator 远端 agent 配置（claude-code 或等价）能响应 spawn 请求]
- [ASSUMPTION: GAN 收敛检测（PR #2834）和本图配合工作，不需要单独再调]
- [ASSUMPTION: 14 节点中 retry / terminal_fail 在本次最小 Initiative 任务中可合法跳过——只要 happy path 全部命中即视为通过]
- [ASSUMPTION: thread_id 查询接口已在 brain 暴露（或可通过 Pg 直查 checkpoints 表）]

## 预期受影响文件

- `packages/brain/src/workflows/harness-initiative.graph.js`：被验证的主图，本次不修改源码，只产生新测试
- `packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js`：现有 full 测试，可能补强
- `packages/brain/src/workflows/__tests__/`（新增）：可能新增 e2e 验收测试文件，覆盖 14 节点完整路径 + kill-resume 场景
- `sprints/w8-langgraph-v7/`：本 sprint 的 PRD / 合同 / 评估报告产物
- 不修改图结构，不修改节点函数实现；只新增/补强测试与可观测性

## journey_type: autonomous
## journey_type_reason: 任务仅涉及 packages/brain/ 的 LangGraph harness 图运行时验证，由 Brain Initiative 调度链触发，无 UI / 无 dev pipeline / 无 agent 协议变更
