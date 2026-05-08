# Sprint PRD — W8 Acceptance v8（LangGraph 修正全套 14 节点 + sub_task spawn 验收）

## OKR 对齐

- **对应 KR**：W8 LangGraph 修正收官（Brain 工作流持久化与 sub_task 并发执行能力）
- **当前进度**：Stream 1-5 + Layer 3 spawn-and-interrupt + Layer 3 credentials mount 已合（commit 50f8a958 / 9e733b00 / 79b36bca / 90df1996 / 0ebf0080 / 669794d0 / ca0f9ad1 / 8b0750f7），单点修复完成
- **本次推进预期**：从"单点修复全绿"推进到"端到端 Initiative 跑完全 14 节点 + sub_task 容器 spawn 真实落地"——W8 收官验收

## 背景

LangGraph 修正在过去两周走完 5 个 Stream + 3 个 Layer 3 修复，每个 PR 单独证明了局部正确性（callback router、durability:'sync'、git-fence、节点幂等门、Walking Skeleton 1node、spawn-and-interrupt、ganLoop pgCheckpointer 兜底、sub_task 容器 credentials mount）。但截至 commit 8b0750f7，没有一次端到端验证证明：

1. 14 个节点（spawn / await_callback / parse_callback / poll_ci / merge_pr / fix_dispatch / pick_sub_task / run_sub_task / evaluate / advance / retry / terminal_fail / final_evaluate / report）能在一次真实 Initiative 任务里按顺序走完不卡。
2. sub_task 容器 spawn 真的拿到了 resolveAccount 注入的凭据并能进入 harness pipeline 子流程。
3. brain 进程被 kill 后从 PostgreSQL checkpoint resume，状态完整不漏节点。

W8 收官需要把这三件事压成一次可观测、可重复的验收，作为 LangGraph 修正这条 Journey 的 Done 信号。

## Golden Path（核心场景）

系统从 [Brain 派发一个 harness Initiative 任务] → 经过 [LangGraph 14 节点全路径 + 至少一次 sub_task 容器 spawn + 一次 brain kill/resume] → 到达 [Initiative 状态 completed，dev_records 记录完整节点轨迹，sub_task 容器执行可观测]

具体：

1. **触发条件**：Brain 收到一个 task_type=harness_initiative 的任务（手动 POST 或 fixture 派发），含合法 PRD。
2. **系统处理**：
   - `spawnGeneratorNode` 以 spawn-and-interrupt 模式启动 Generator 容器，注入 resolveAccount 给出的 CECELIA_CREDENTIALS，立即 interrupt 进入 await_callback。
   - Generator 容器跑完后通过 callback router endpoint 回写，`parseCallbackNode` 解析回执，`pollCiNode` 等 CI 绿，`mergePrNode` 合并 PR。
   - `pickSubTaskNode` 从 task_plan 取下一个 sub_task，`runSubTaskNode` 用 spawn-and-interrupt 启子任务容器（同样走 resolveAccount），完成后 `evaluateNode` 判 PASS/FAIL → `advanceNode` 推进或 `retryNode` 重跑（≤2 轮，失败进 `terminalFailNode`）。
   - 所有 sub_task 走完后 `finalEvaluateNode` 做 E2E Golden Path 验证，`reportNode` 写最终回执。
   - 中途至少触发一次 brain 进程 kill（手动 docker restart 或 SIGKILL），系统从 PgCheckpointer 恢复，从最近 interrupt 点继续，不重复执行已完成节点。
3. **可观测结果**：
   - Brain `tasks` 表对应 task `status=completed`，`result.merged=true`。
   - `dev_records` 表能查到该 Initiative 的全部 14 节点轨迹（按时间顺序），其中至少 1 条是 sub_task 容器执行记录。
   - PostgreSQL checkpoints 表中存在该 thread_id 的多个 checkpoint，最后一个状态 `final`。
   - Sub_task 容器日志显示 CECELIA_CREDENTIALS 被正确读到（不是 undefined / 空字符串）。
   - kill/resume 前后 dev_records 不出现重复节点条目。

## 边界情况

- **Generator callback 超时**：await_callback 超过阈值（如 30 分钟）应进入 retry 或 terminal_fail，不卡死。
- **CI 红 / merge 冲突**：pollCi 红或 mergePr 冲突应路由到 fix_dispatch，不直接 terminal_fail。
- **sub_task 容器 spawn 失败**（resolveAccount 返回空 / docker spawn ENOENT）：runSubTaskNode 应捕获并走 retry，不让整个 Initiative 异常退出。
- **kill 发生在节点执行中途**：从上一个 interrupt 点恢复，正在执行的节点应被识别为未完成并重跑（durability:'sync' 保证）。
- **task_plan 为空**：pickSubTask 应直接跳到 finalEvaluate，不要进入死循环。

## 范围限定

**在范围内**：
- 端到端跑通一次真实 harness Initiative，覆盖 14 节点全路径。
- 至少一次 sub_task 容器 spawn 实证（带 credentials 注入）。
- 至少一次 brain kill/resume 实证。
- 验收脚本 / 集成测试落库 packages/brain/src/__tests__/ 或 sprints/w8-langgraph-v8/ 下。
- 验收报告写入 sprints/w8-langgraph-v8/acceptance-report.md，含节点轨迹、checkpoint 数、resume 证据。

**不在范围内**：
- 不修单点 bug（已在 Stream 1-5 + Layer 3 PR 修完，只做验收）。
- 不重构 graph 节点拓扑。
- 不接入新 journey_type，不动 user_facing / dev_pipeline / agent_remote 路径。
- 不优化性能 / 不改 SLA，只验证功能正确性。
- 不做 Dashboard 可视化。

## 假设

- [ASSUMPTION: 测试环境的 Brain 容器、PostgreSQL、worktree 目录、docker socket 已可用，验收人不需要额外搭基础设施]
- [ASSUMPTION: 用于派发的 fixture Initiative PRD 走最短 Golden Path（1-2 个 sub_task），节省验收时间]
- [ASSUMPTION: Generator 容器和 sub_task 容器使用同一套 resolveAccount 凭据池，本次只验证注入路径而非账号轮转策略]
- [ASSUMPTION: kill/resume 验证可用 `docker restart brain` 模拟，不必触发 OOM 或硬件级故障]

## 预期受影响文件

- `sprints/w8-langgraph-v8/acceptance-report.md`：验收报告（新增）
- `sprints/w8-langgraph-v8/acceptance-fixture.json` 或 `.md`：派发用的 fixture Initiative（新增，可选）
- `packages/brain/src/__tests__/integration/w8-acceptance.integration.test.js`：端到端集成测试（新增，可选）
- `packages/brain/src/workflows/harness-task.graph.js`：仅做必要的可观测性补丁（如节点轨迹日志），不动逻辑
- `packages/brain/src/workflows/__tests__/`：可能补一份 14 节点路径的 graph-level 测试

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 的 LangGraph 工作流与 sub_task 容器 spawn，无 dashboard UI、无 engine hooks、无远端 agent 协议变更，属于 Brain 自主流转能力的收尾验收。
