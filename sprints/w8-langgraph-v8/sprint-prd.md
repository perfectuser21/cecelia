# Sprint PRD — W8 Acceptance v8（LangGraph 修正全套 14 节点 + sub_task spawn 验收）

## OKR 对齐

- **对应 KR**：管家闭环可靠性 KR（harness_initiative 端到端无人干预跑通率）
- **当前进度**：W1-W7.x、Layer 3 重构、Stream 1-5、sub_task callback 修复均已合并 main（PR #2841-#2850）
- **本次推进预期**：从"组件级各自通过"提升到"端到端集成证明 14 节点全过 + sub_task spawn 闭环 + PR 自动合并"，把 KR 推进到验收完成态

## 背景

LangGraph 修正全套（W1 thread_id 版本化 / W2 RetryPolicy / W3 watchdog / W4 streamMode / W5 interrupt / W6 docker-executor OOM / W7.1-7.7 运维 / Layer 3 spawn-and-interrupt / Stream 1-5 / sub_task credentials & callback）已全部合并。但每条改动都是组件级单测 + 局部 integration test 验证，**从未在一个真实 harness_initiative 里端到端串起来跑过**。最近合并的 PR #2847（Layer 3 resolveAccount）、#2850（HARNESS_CALLBACK_URL env）说明 sub_task spawn 路径仍有未暴露的 wiring 问题——只有完整跑一次才能把残余 bug 全部逼出来。

W8 是这一系列改造的最后一个 Work Stream：以一个最小 Walking Skeleton（thin feature = `GET /api/brain/harness/health` 返回 langgraph_version + last_attempt_at）为载体，让 Brain 派一个 `harness_initiative` 任务，14 节点 LangGraph 全程跑通到 PR 合并 + acceptance task 终态 completed，并叠加 3 个故障注入（Docker SIGKILL / 凭据失效→max_fix_rounds 触发 interrupt / deadline 逾期）证明可靠性原语真实生效。

## Golden Path（核心场景）

主理人（或 Brain 调度）从 [向 Brain 注册一个 W8 Acceptance harness_initiative 任务] → 经过 [Brain dispatch → 14 节点 LangGraph 编排 → sub_task 容器 spawn → 子任务回调 → PR 自动开 → CI 过 → PR 合并 → final_evaluate → report] → 到达 [acceptance task 状态 completed、final_e2e_verdict=PASS、health endpoint live、3 个故障注入场景全部自愈或正确暂停、acceptance 报告归档]

具体：

1. **触发条件**
   - 主理人执行 W8 注册命令（spec §Work Stream 8）：`POST /api/brain/tasks` task_type=`harness_initiative`，payload 含 `initiative_id=harness-acceptance-2026-05-06`、`sprint_dir=sprints/harness-acceptance`、`walking_skeleton.thin_features=["F1-health-endpoint"]`、`walking_skeleton.e2e_test_path=tests/e2e/harness-acceptance-smoke.spec.ts`、`budget_usd=5`、`timeout_sec=1800`。
   - 调用 `POST /api/brain/tasks/:id/dispatch` 立即派发（不等 5min tick）。

2. **系统处理（14 节点端到端）**
   - Brain executor 创建版本化 thread_id（`harness-initiative:<id>:attempt1`）启动 `harnessInitiativeGraph`。
   - 14 节点按依赖顺序执行：`prep → planner → parsePrd → ganLoop → inferTaskPlan → dbUpsert → pick_sub_task → run_sub_task → evaluate → advance → (循环回 pick_sub_task 直到 task_index 用完) → final_evaluate → report → END`，附 conditional edge 进入 `retry`/`terminal_fail`。
   - 每个 node 进入/离开都通过 `emitGraphNodeUpdate` 写 `task_events.event_type='graph_node_update'`，LiveMonitor 实时可见。
   - `run_sub_task` 走 spawn-and-interrupt：`spawnGeneratorNode` 调 `resolveAccount` 挂载凭据 → docker-executor 起 `cecelia-task-<id>` 容器跑 `/dev` skill → 容器通过 `HARNESS_CALLBACK_URL` 回调 Brain `/api/brain/harness/sub-task-callback` → Brain 用 LangGraph `Command/resume` 把 verdict 注入 graph 继续推进。
   - sub_task 子任务在 worktree 里完成 thin feature（health endpoint 改动）→ 走 /dev workflow → 开 PR → CI 过 → PR 自动合并到 main。
   - `final_evaluate` 跑 e2e 验证命令（curl health endpoint 200 且 body 含 `langgraph_version`），失败则 fix_round +1，若达 `max_fix_rounds` 触发 W5 `interrupt()` 暂停在 `final_evaluate`。
   - `report` 节点写 acceptance 报告草稿 → graph 走到 `END`。

3. **故障注入 A — Docker SIGKILL**（验证 W6 + W2）
   - acceptance 跑到子任务 `evaluate`/`run_sub_task` 时手动 `docker kill cecelia-task-<...>`。
   - 期望：W6 修复让 docker-executor Promise 立即 reject（不 hang）；W2 RetryPolicy（LLM_RETRY）自动 retry ≤3 次；子任务最终 PASS。
   - 验证：`task_events` 表对应 nodeName 有多次 attempt + 最终 success。

4. **故障注入 B — final E2E 持续 FAIL → max_fix_rounds → interrupt**（验证 W5）
   - 改动 W8 acceptance 的 e2e_acceptance 命令为故意失败的检查（或临时让 health endpoint 返回 500）→ `final_evaluate` fix_round 累积撞到 max_fix_rounds → W5 interrupt 暂停在 `final_evaluate`。
   - 验证：`GET /api/brain/harness-interrupts` 返回一条 pending interrupt；`POST /api/brain/harness-interrupts/:thread_id/resume {action:"abort"}` → graph 转 END error 状态。
   - 恢复：让 e2e 通过后用 W1 升 attempt 重派，期望 fresh start 跑通。

5. **故障注入 C — Deadline 逾期**（验证 W3）
   - `psql -d cecelia -c "UPDATE initiative_runs SET deadline_at = NOW() - INTERVAL '1 minute' WHERE initiative_id='harness-acceptance-2026-05-06'"`，等下次 watchdog scan（≤5min）。
   - 期望：W3 watchdog 标 `phase=failed`、`failure_reason=watchdog_overdue`，AbortSignal 注入到 graph 取消进行中节点；下次重派 → W1 attemptN+1 → fresh start。
   - 验证：`initiative_runs` 行落到 failed + failure_reason=watchdog_overdue；重派后新 thread_id 带 attempt2。

6. **可观测结果（Step 7 验证清单）**
   - `task_events` 含 14 种不同 nodeName 的 graph_node_update（健康跑那次至少各 1 条）。
   - GitHub 上 `harness acceptance health endpoint` PR 已 merged（`gh pr list --search ... --state merged` 命中）。
   - `curl localhost:5221/api/brain/harness/health | jq` 返回 200 + body 含 `langgraph_version`。
   - `curl localhost:5221/api/brain/okr/current` 中"管家闭环"KR 进度被本次推进。
   - LiveMonitor 浏览器截屏显示 14 节点流式更新（W4 streamMode 生效）。
   - acceptance task `GET /api/brain/tasks/<id>` 返回 `status=completed`、`final_e2e_verdict=PASS`、`sub_tasks` 数组完整。
   - `docs/superpowers/reports/2026-05-06-harness-langgraph-acceptance.md` acceptance 报告已写。

## 边界情况

- **GAN 收敛检测**：planner 写 PRD → proposer 起合同 GAN 时若 reviewer 无实质漏洞必须 APPROVED（不卡死轮数），W8 acceptance 用最 thin feature，预期 GAN 1-2 轮即 APPROVED。
- **凭据冷启动**：sub_task 容器首次 spawn 时 `resolveAccount` 必须能从 1Password CS Vault 拉到 Anthropic key 并挂入容器；若失败必须直接抛错 fail-fast，不静默退化。
- **PostgresSaver 失败**：`runGanLoopNode` 已加 getPgCheckpointer 兜底（PR #2846），断网/DB 抖动时仍能用兜底保存 checkpoint，不允许退化到 MemorySaver。
- **callback 404**：HARNESS_CALLBACK_URL env 已优先生效（PR #2850），容器回调必须 200；若 Brain 重启过则下次 dispatch 用 W1 attemptN+1 fresh start。
- **三个故障注入互不污染**：A/B/C 必须各自独立的 acceptance run（建议各注册一个独立 initiative_id 或 attemptN 隔离），不要在同一 run 里叠加注入。
- **空状态 / 并发**：watchdog scan 与 graph 正在执行同一节点的并发——AbortSignal 必须能干净中断（不留半完成 worktree）。
- **CI 等待**：sub_task 开的 PR 必须等 CI 完成，禁止 `gh pr merge --admin` 绕过；若 CI 红则触发 retry node。

## 范围限定

**在范围内**：
- 一个最小 thin feature（health endpoint）作为 walking skeleton 载体
- 一次健康跑（14 节点全过、PR merged、acceptance completed）
- 三个独立故障注入 run（A Docker SIGKILL / B max_fix_rounds interrupt / C deadline 逾期）
- 写 acceptance 报告 `docs/superpowers/reports/2026-05-06-harness-langgraph-acceptance.md` 含截屏与验证命令输出
- 把 KR 进度推进到验收完成态

**不在范围内**：
- 不改 LangGraph 引擎本身（@langchain/langgraph 1.2.9 不动）
- 不重写 14 节点中任何一个的实现逻辑（只在跑通过程中暴露的 wiring bug 才允许 hotfix，且必须走独立 /dev PR，不在 W8 PRD 内承诺）
- 不上 LangGraph Platform、不上 LangSmith
- 不做新功能开发（health endpoint 只是 acceptance 载体，不承诺任何业务能力）
- 不重构 spawn / docker-executor（已在 W6 / Layer 3 完成）
- 不动 Dashboard 视觉/交互（LiveMonitor 已在 W4 接 streamMode）
- 不引入新的 KR 或新 initiative

## 假设

- [ASSUMPTION: 批次 1-4 全部 PR 已合并 main，运行环境 Brain 启动后 selfcheck 通过、tick loop 正常、PostgresSaver schema 已 migrate]
- [ASSUMPTION: 1Password CS Vault 中 Anthropic / OpenAI 凭据有效且 sync-credentials.sh 已成功 sync 到 ~/.credentials/]
- [ASSUMPTION: GitHub 远端 main 分支保护规则允许 harness PR 走 CI 通过自动合并（不需要人工 review approval）]
- [ASSUMPTION: 故障 B 改造场景"让 final E2E 一直 FAIL 撞 max_fix_rounds"通过临时改 e2e 验证命令实现，acceptance 报告会注明这是受控注入]
- [ASSUMPTION: docker daemon / cecelia-task- container runtime 在 acceptance 期间不被外部清理（startup-recovery 已加活跃 lock 保护，PR #2812/#2831）]
- [ASSUMPTION: Brain 调用 `/api/brain/context` 接口可用——本次 Planner 执行时该接口实测不可达（curl exit 7），故未取在线上下文，PRD 内容基于代码与最近 git log/spec 文档归纳]

## 预期受影响文件

> 注：W8 是 acceptance，本身**不写新业务代码**；以下是 acceptance 跑通过程中**会被读取/触发执行**的关键文件，以及 thin feature health endpoint 唯一允许的新增点。

- `packages/brain/src/workflows/harness-initiative.graph.js`：14 节点 LangGraph 主图，acceptance 全程驱动它执行
- `packages/brain/src/workflows/harness-task.graph.js`、`harness-gan.graph.js`：子图，pick_sub_task / run_sub_task / final_evaluate 路径会触达
- `packages/brain/src/executor.js`（约 2820-2847）：thread_id 版本化 + invoke→stream + AbortSignal 注入入口
- `packages/brain/src/harness-watchdog.js`：故障注入 C 验证目标
- `packages/brain/src/docker-executor.js`、`packages/brain/src/spawn/middleware/docker-run.js`：故障注入 A 验证目标
- `packages/brain/src/routes/harness-interrupts.js`：故障注入 B GET/POST resume 验证目标
- `packages/brain/src/tick.js`：watchdog 5min/次 tick 注册
- `packages/brain/src/events/taskEvents.js`：emitGraphNodeUpdate 写入 task_events
- `apps/dashboard/src/pages/LiveMonitor.tsx`、`HarnessInterrupts.tsx`：W4/W5 可观测性页面，acceptance 期间手动浏览器观察
- `tests/e2e/harness-acceptance-smoke.spec.ts`：acceptance 配套 e2e 验证脚本（thin feature 配套，新增）
- `packages/brain/src/routes/harness-health.js` 或现有路由扩展：thin feature `GET /api/brain/harness/health` 端点（新增，仅返回 langgraph_version + last_attempt_at）
- `docs/superpowers/reports/2026-05-06-harness-langgraph-acceptance.md`：acceptance 报告（新增）
- `packages/brain/scripts/sync-credentials.sh`、1Password CS Vault：故障注入 B 临时坏掉/恢复凭据涉及

## journey_type: autonomous
## journey_type_reason: harness_initiative 全流程由 Brain（packages/brain/）内 LangGraph 编排自驱，外部仅靠 Brain dispatch 触发；sub_task 容器 spawn 虽走 cecelia-run bridge 但属内部子步骤，按"起点最靠前 (UI > tick > task dispatch > bridge)"取 task dispatch → autonomous。
