# Sprint PRD — W8 v13 真端到端验证（post H7/H9/H8/H10/H11）

## OKR 对齐

- **对应 KR**：Harness LangGraph 重构 / W8 端到端实证（继 W7.3 worktree 保护后的最终闭环）
- **当前进度**：H7（entrypoint stdout tee）、H8（evaluator 切 generator worktree）、H9（planner SKILL push 静默）等多个 Stage 1/4 修正已合并到 main；尚未做过一次"从触发到 status=completed"的完整连贯验证。
- **本次推进预期**：完成一次端到端实证，把"LangGraph harness 能跑完一条 Initiative 并真实落库 status=completed"从口头承诺变成可复现观测。

## 背景

H7/H9/H8/H10/H11 是过去几次 Stage 1/4 巡检暴露的系统性缺陷修补：

| 修正 | 关键问题 |
|------|---------|
| H7 (#2852) | entrypoint.sh stdout 没 tee 到 STDOUT_FILE，远端 agent 输出丢失，回调内容空 |
| H8 (#2854) | Evaluator 没切到 Generator 的 task worktree，验证跑在错的代码上 |
| H9 (#2853) | harness-planner SKILL push 把"无 creds"变成 fatal noise，污染日志 |
| H10/H11 | 并入 #2851 (runSubTaskNode 注入 logical_task_id + 不共享 initiative worktree) 与 #2855 (absorption_policy 触发逻辑诚实化)，把"假装成功"路径堵死 |

每次修正之后系统都"看起来好了"，但从未做一次跨节点完整跑通的端到端验证；W8 v13 就是补这个空白：以现存 main 分支为基准，跑一条最简 Initiative，亲眼看 graph 节点全部命中、Generator/Evaluator 真实通过、最终 task 在 brain 数据库里落 `status=completed` 且 `result.merged=true`。

本次为"final"——若此次跑通，W8 LangGraph 重构线收尾；若失败，必须暴露下一个 Hotfix 编号（H12...）而不是再次假装通过。

## Golden Path（核心场景）

系统从 [Brain 收到一条 harness_initiative 任务] → 经过 [LangGraph 全节点（plan→propose→review→spawn→generator→evaluator→absorption→complete）] → 到达 [brain.tasks 行 status=completed 且 PR 已合并 / 或被显式标记 NO_CHANGE 完成]

具体：

1. **触发条件**：通过 `POST localhost:5221/api/brain/tasks` 创建一条最简 harness_initiative 任务（描述：一个微改动，例如往某文档加一行版本戳，便于 Generator 必有 diff 可生成）。
2. **系统处理**（按 Layer 顺序，每步必须有可观测信号）：
   - Layer 1 Planner SKILL 跑通：返回 `{"verdict":"DONE","branch":"cp-...","sprint_dir":"sprints/..."}` 且无 push noise（H9 验证点）。
   - Layer 2 Proposer/Reviewer GAN 跑通：sprint-contract.md + task-plan.json 生成，GAN 收敛 APPROVED（无 MAX_ROUNDS 硬 trip）。
   - Layer 3 spawn-and-interrupt 模式正确：runSubTaskNode 注入 logical_task_id，sub_task 走自己 worktree，不污染 initiative 主目录（#2851 验证点）。
   - Generator 远端 agent 容器输出全程 tee 到 STDOUT_FILE，回调能拿到非空 stdout（H7 验证点）。
   - Evaluator 在 Generator 的 task worktree 上运行（H8 验证点），不在 initiative 根 worktree。
   - Absorption policy 真实触发：要么报告 `applied=true` 并附 PR 合并证据，要么报告 `applied=false` 并说明原因；不允许出现"假装 applied"路径（#2855 验证点）。
3. **可观测结果**：
   - `GET /api/brain/tasks/{task_id}` 返回 `status=completed`，且 `result` 字段含本次 PR URL 或 NO_CHANGE 说明。
   - LangGraph checkpoint 表里此 thread 的最终节点是 complete/end，无 interrupted/error 状态遗留。
   - 整条 Initiative 在 brain 容器日志里能拉出一条线性 trace，覆盖上面 7 个节点签名，无 ENOENT/breaker OPEN/credentials 缺失等已修复故障。
   - 所有 sub_task 的 owner_session 与触发它的 launcher session 一致（W7.3 + #2851 联合验证）。

## 边界情况

- **Generator 真无 diff（NO_CHANGE 路径）**：必须命中 absorption_policy 的"诚实 not_applied"分支并仍以 status=completed 收尾，不能被强制走"假装合并"。
- **Evaluator 验证失败**：合规路径是 GAN 多轮直至收敛或 force APPROVED；不允许 Evaluator 因 worktree 错位（H8 旧病）而误判。
- **Brain 容器中途重启**：在 spawn 后 / Generator 跑到一半 kill brain，应能 resume（Stream 5 已实证 1node skeleton 行为，本次需在多节点真实场景下复测一次）。
- **回调 race**：Generator 完成 → POST callback 到 router endpoint（Stream 1）→ 状态机推进；同 task_id 重复回调必须幂等（Stream 4 节点幂等门）。
- **远端 agent 无 credentials**：应触发优雅 skip / 明确错误，不能让 cecelia-run breaker OPEN 拖垮整条线（#2839、#2833）。

## 范围限定

**在范围内**：

- 创建 1 条端到端 harness_initiative，跑通 Layer 1→2→3→Evaluator→Absorption→Complete 全链路
- 收集每个节点的 stdout/log/checkpoint 三份证据
- 在 sprints/w8-langgraph-v13/ 落 evidence 目录（trace.txt / db-snapshot.json / pr-link.txt）
- 若失败：定位是哪一节点哪一假设破裂，命名为 H12（依次递增），输出后继 hotfix PRD 草案

**不在范围内**：

- 任何新功能（不改 graph 拓扑、不加新节点）
- 性能/吞吐压测（单条 Initiative 即可，不做并发）
- 跨账号 / 跨远端机器的多 agent 验证（用主开发账号 + 默认 codex agent）
- UI Dashboard 上的可视化（Brain API + 数据库证据足够）

## 假设

- [ASSUMPTION: H10/H11 即 #2851 与 #2855 这两次提交，目前没有更早或更晚的独立 H10/H11 PR；若用户 task 描述指的是其他 PR，须在执行前澄清。]
- [ASSUMPTION: 验证用的最简 Initiative 描述允许由 Proposer 自由选择一个安全微改动（如 docs 加版本戳），不强约束具体修改内容。]
- [ASSUMPTION: 测试在主 Brain 实例（端口 5221）上跑，不开新 sandbox 数据库；测试任务的 task_id 会被打 `verification=true` 标签便于事后过滤。]
- [ASSUMPTION: brain checkpoint Postgres 已通 #2843（durability:'sync'）配置，不再回退 MemorySaver；本次只验证不回归不重写。]

## 预期受影响文件

- `sprints/w8-langgraph-v13/sprint-prd.md`：本 PRD（本次新增）
- `sprints/w8-langgraph-v13/evidence/`：trace / DB 快照 / PR 链接（执行阶段产出）
- `sprints/w8-langgraph-v13/result.md`：最终验证结果（PASS / 暴露 H12+）
- 不预期改动 `packages/brain/`、`packages/engine/`、`packages/workflows/` 任何源代码——若验证发现需修代码，应作为 H12+ 独立 Hotfix Initiative，不在本 sprint 范围内

## journey_type: agent_remote
## journey_type_reason: 验证流程穿透 Brain LangGraph 调度 + 远端 codex agent（cecelia-run/bridge）执行 + 回调闭环，起点最靠前的可观测路径在 agent 远端协议层。
