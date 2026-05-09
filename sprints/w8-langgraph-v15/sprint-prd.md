# Sprint PRD — W8 v15 LangGraph Harness 真端到端验证

## OKR 对齐

- **对应 KR**：Harness LangGraph 端到端可达 `status=completed`（W8 系列的收官 KR）
- **当前进度**：v14 尝试受 H7/H8/H9/H10/H11/H12/H13 阻断，未真正抵达 `completed`；当前进度 ≈ 80%（修复已合，但未在真实 pipeline 上闭环验证）
- **本次推进预期**：到 100%——一次真实 harness 全链路跑完，PostgreSQL `tasks` 表对应 sub_task 行 `status='completed'` 由 evaluator 通过 callback 写入

## 背景

W8 「LangGraph 修正」分 5 个 Stream（callback router、durability sync、git-fence、节点幂等门、Walking Skeleton 1node）已合并；v14 e2e 验证启动后陆续暴露 7 个 P0 缺陷，编号 H7–H13：

- H7：entrypoint stdout 没 tee 到 STDOUT_FILE → callback 体丢失
- H8：evaluator 切到 generator 的 task worktree 失败
- H9：harness-planner SKILL push 噪声打乱 verdict 解析
- H10：proposer verify origin push 收官缺口
- H11：sub-task worktree key 用 `<init8>-<logical>` 复合（PR #2851 P0）
- H12：docker-executor cecelia-prompts mount ro→rw（让 H7 真生效）
- H13：spawnGeneratorNode import contract artifacts（v14 evaluator 找不到 DoD）

补充修复 #2862（consolidation 闸门改 elapsed-time，修 PROBE_FAIL_CONSOLIDATION）也已合入。所有 7 个 H 修复 + consolidation 修都已落 main，但**没有任何一次真实 e2e run 跑完整链 reach `status=completed`**。v15 的唯一目的就是补上这一次「真闭环」实证：跑一个 Walking Skeleton noop PR 任务，全链路通过 LangGraph harness（planner → proposer → reviewer → generator → evaluator → callback → DB writeback），最终 DB 里看到 `tasks.status='completed'`。

不引入任何新 LangGraph 行为变更——这是验收 sprint，不是开发 sprint。

## Golden Path（核心场景）

**触发方**：人工通过 Brain API 派发一个 Walking Skeleton 噪声 PR 任务（task_type=`harness_initiative`，journey_type=`dev_pipeline`，目标是「写一个 noop 学习笔记 md 文件并 PR」）→ **入口**：Brain consciousness-loop 接到任务，spawn LangGraph harness 状态机 → 经过 **关键步骤**：planner 写 PRD（commit & push）→ proposer GAN 提合同（commit & push）→ reviewer GAN 审合同 APPROVED → generator 在 sub-task worktree 实现 noop 文件并 PR → evaluator 在同一 sub-task worktree 验证 DoD → evaluator 通过 callback 把 `tasks.status='completed'` 写回 PostgreSQL → **出口**：

1. 人工通过 SQL 查询确认目标 sub_task 行 `status='completed'`、且 `result` 字段含 `pr_url`
2. GitHub 上能看到 generator 推出的 PR（OPEN 即可，不要求合并）
3. Brain 日志显示 LangGraph 状态机走完所有节点，没有 ERROR 或 fail-fast 抛出
4. evaluator callback 命中的是真实 endpoint（不再是 H7 之前丢 stdout 的状态）

具体步骤（人观察的事件序列）：

1. 通过 `POST localhost:5221/api/brain/tasks`（或既定派发渠道）注册一个 W8 v15 Walking Skeleton 任务，参数包括 sprint_dir、journey_type、initiative_id
2. Brain consciousness-loop 在下一个 tick 拿到任务，触发 LangGraph harness state machine
3. 各节点依次推进，并在 PostgresSaver 留下 checkpoint；任何节点中途无错退出
4. evaluator 节点对 generator 推送的分支跑 DoD 验证（4 条：文件存在、首行匹配、PR OPEN、DB 行 status=completed）
5. evaluator 通过 callback 把 status 写回 DB；DB 状态由 `pending`/`in_progress` 翻到 `completed`
6. 整个 run 在 30 分钟以内完成（保守上限，超过则视为退化）

## 边界情况

- **重启续跑**：若 run 中途 Brain 容器重启，PostgresSaver 续跑应该让流程从最后 checkpoint 继续；本次验证不**主动**杀容器，但若意外发生需能恢复（已由 W8 Stream 2 + Stream 5 实证过 1node 场景，本次扩到全链路）
- **空状态/重复触发**：同一 `(initiative_id, logical_task_id)` 复合 key 已存在 worktree 时（H11 修复后），不应重建，应复用
- **callback 网络异常**：若 callback POST 失败，evaluator 节点应抛错并被 LangGraph 捕获（不可静默成功）
- **PROBE_FAIL_CONSOLIDATION**：consolidation 闸门已在 #2862 改成 elapsed-time，本次 run 不应再因为它阻塞
- **Codex/SKILL push 静默失败**：H9 已静默 noisy push；本次 verdict JSON 解析需稳

## 范围限定

**在范围内**：
- 派发一个 Walking Skeleton noop PR 任务（任务内容是写 `docs/learnings/w8-langgraph-v15-e2e.md`，首行包含 `W8 v15 LangGraph E2E 实证`）
- 观察 LangGraph 全链路真实跑完
- 用 SQL 查询、GitHub PR 截图/链接、Brain 日志三类证据共同证明 `status='completed'` 真实抵达
- 收集 node_durations、gan_proposer_rounds、pr_url、run_date 等实证字段，落地到 `docs/learnings/w8-langgraph-v15-e2e.md`
- 失败分析：若任一节点失败，记录失败位置、错误链、是否需要 H14 类修复

**不在范围内**：
- 改 LangGraph 节点逻辑、改 harness skill、改 evaluator DoD 模板（这些是开发任务，不是验收任务）
- 跑两次或多次 run 求平均（一次成功即可视作 KR 完成；失败则触发后续修复任务，不在本 PRD 范围内）
- 性能优化、并发跑多个 sub-task、压力测试
- 派 PR 后做 PR 合并/部署（DoD 只要求 OPEN）
- 改 consciousness-loop 调度策略

## 假设

- [ASSUMPTION: H7–H13 + consolidation 修复 #2862 已全部进入 main 分支并随 Brain 容器最新 build 部署到运行环境。如未部署，需要先 deploy 再跑 e2e]
- [ASSUMPTION: PostgreSQL `tasks` 表 schema 与 v14 一致，`status` 字段允许从 `in_progress` 转 `completed`，`result` 字段为 JSONB 可写入 `{pr_url}`]
- [ASSUMPTION: GitHub credentials 在 Brain 容器内可用，generator 节点能 push 到 `cp-*` 分支并以 `gh pr create` 开 PR]
- [ASSUMPTION: harness-planner / proposer / reviewer / generator / evaluator 五个 SKILL 当前 main 版本与 LangGraph 节点契约一致（v14 e2e 后未做破坏性修改）]
- [ASSUMPTION: Walking Skeleton 模式仍受 LangGraph 状态机识别，generator 不会因为「不修改 packages/brain | engine | workflows」而 fail-fast]
- [ASSUMPTION: 一次成功的 e2e run 足以宣告 KR 完成，无需复跑两次取均值]

## 预期受影响文件

- `docs/learnings/w8-langgraph-v15-e2e.md`：generator 节点产出的实证笔记（首行 `W8 v15 LangGraph E2E 实证`），DoD 1/2 的物证
- `sprints/w8-langgraph-v15/sprint-prd.md`：本文件
- `sprints/w8-langgraph-v15/sprint-contract.md`：Proposer 合同 GAN 后产出
- `sprints/w8-langgraph-v15/run-evidence.md`（或同名）：跑完后落地的证据卡（node_durations / gan rounds / pr_url / DB 截图 / Brain 日志关键行）

不预期改动 `packages/brain/`、`packages/engine/`、`packages/workflows/` 任何运行时代码。**若验证过程中确实需要改动这些目录，意味着发现了 H14+ 缺陷，应另开新 sprint**，本 sprint 直接 fail 并记录原因。

## journey_type: dev_pipeline
## journey_type_reason: 任务跑的是 LangGraph harness 自身的端到端链路（planner→proposer→reviewer→generator→evaluator），属 packages/engine + packages/brain 共同构成的开发流水线验证，目标是闭环 dev pipeline 自证可达 `status=completed`，不涉及 dashboard UI 也不涉及远端 agent 协议变更
