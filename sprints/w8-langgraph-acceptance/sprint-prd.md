# Sprint PRD — W8 Acceptance · LangGraph 14 节点端到端验证

## OKR 对齐

- **对应 KR**：管家闭环 KR — 手动派 harness_initiative 任务能在无人干预的前提下跑完 14 节点交付 PR 合并。
- **当前进度**：[ASSUMPTION: ~70%]（W1-W7 已合并；W8 是收口的"端到端跑通"证据）
- **本次推进预期**：跑通后到 100%；端到端证据写入 `docs/superpowers/reports/2026-05-06-harness-langgraph-acceptance.md`。

## 背景

Harness LangGraph 1.2.9 落地的 14 个节点（prep → planner → parsePrd → ganLoop → inferTaskPlan → dbUpsert → pick_sub_task → run_sub_task → evaluate → advance/retry/terminal_fail → final_evaluate → report）已通过 W1（thread_id 版本化）、W2（节点 RetryPolicy）、W3（AbortSignal + watchdog）、W4（streamMode → LiveMonitor）、W5（interrupt 关键决策点）、W6（docker-executor OOM Promise reject 修复）、W7.x（运维 7 项）一系列 PR 落地。

但"全部 unit/integration 测试通过"不等价于"真任务派下来能从头跑到 PR 合并"。W8 通过派一条最薄的 Walking Skeleton 任务（在 Brain 加 `GET /api/brain/harness/health` 健康端点）来强制 14 节点全链路真实运转一次，作为 W1-W7 联调的端到端验收证据。

参考：`docs/superpowers/specs/2026-05-06-harness-langgraph-reliability-design.md`、`docs/superpowers/plans/2026-05-06-harness-langgraph-reliability.md` §Work Stream 8。

## Golden Path（核心场景）

主理人（或 Brain dispatcher）派发 `harness_initiative` 任务 [入口] → 14 节点 LangGraph 全链路自动跑完 [关键步骤] → 新增的 `GET /api/brain/harness/health` 端点在 staging 上返回 200 且 body 含 `langgraph_version` + `last_attempt_at`，`initiative_runs.phase='done'`，`task_events` 表对该 initiative_id 至少记录到 14 个 distinct `nodeName` 的 `graph_node_update` 事件 [出口]。

具体：

1. **触发条件**：本 Initiative 任务（`task_type=harness_initiative`，`payload.initiative_id=w8-langgraph-acceptance-20260507`，`sprint_dir=sprints/w8-langgraph-acceptance`，`budget_usd=5`，`timeout_sec=1800`）通过 Brain dispatch endpoint 入队。
2. **系统处理**：
   - `executor.runHarnessInitiativeRouter` 计算 `thread_id=harness-initiative:w8-langgraph-acceptance-20260507:1`（W1 版本化）。
   - LangGraph `compileHarnessFullGraph` 启动 stream 模式（W4），逐节点 emit `graph_node_update` 事件到 `task_events`。
   - **prep / planner / parsePrd / ganLoop / inferTaskPlan / dbUpsert** 完成阶段 A：写出本 PRD + task-plan.json（即此文件），GAN 合同审过 → `initiative_contracts.status='approved'`、`initiative_runs.phase='B_task_loop'`。
   - **pick_sub_task → run_sub_task → evaluate → advance** 串行执行 T1：在 worktree 改 `packages/brain/src/routes/harness.js` 加 health 端点 + `tests/integration/harness-health.test.ts` 覆盖 → 子 graph 跑 verify-step → push 分支 → CI 全绿 → PR 合并。
   - 单 task 失败时走 retry（fix_round ≤ 3，W2 RetryPolicy + W5 interrupt 兜底），fix_round 超 3 → terminal_fail。
   - **final_evaluate**（IS_FINAL_E2E=true）跑 e2e_acceptance scenarios（curl staging Brain、psql 查 task_events、psql 查 initiative_runs）。
   - **report** 写 `initiative_runs.phase='done'`（PASS）或 `'failed'`（FAIL）。
3. **可观测结果**：
   - `curl -fsS http://localhost:5222/api/brain/harness/health` 返回 HTTP 200，body JSON 包含字段 `langgraph_version`（字符串）+ `last_attempt_at`（ISO 8601 或 null）。
   - `task_events` 中 `event_type='graph_node_update' AND payload->>'initiativeId'='w8-langgraph-acceptance-20260507'` 至少存在 14 个 distinct `payload->>'nodeName'`。
   - `initiative_runs WHERE initiative_id='w8-langgraph-acceptance-20260507'` 行 `phase='done'`、`completed_at IS NOT NULL`、`failure_reason IS NULL`。
   - GitHub 上至少一个 PR 含路径 `packages/brain/src/routes/harness.js` 已 merge 到 main。

## 边界情况

- **重派同 initiative_id**：W1 强制 attemptN+1 → 新 thread_id `:2`，旧 checkpoint 保留诊断；不是错误。
- **某节点瞬时网络抖动**：W2 LLM_RETRY maxAttempts=3 + 指数 backoff，自动恢复；不视为 verdict FAIL。
- **某节点永久错误（401 / schema parse）**：retryOn 立即抛 → state.error → 路由到 END，`initiative_runs.phase='failed'`。
- **deadline_at < NOW()**：W3 watchdog（Brain tick 5min/次）置 `phase='failed' failure_reason='watchdog_overdue'`，发 P1 alert。
- **fix_round = 3 且 final_evaluate FAIL**：W5 `interrupt()` 暂停 graph，通过 `POST /api/brain/harness-interrupts/:taskId/resume` 让主理人决策 abort / extend_fix_rounds / accept_failed。
- **staging Brain 未起或端口被占**：bootstrapE2E 退出非 0 → final_evaluate FAIL，归因到 T1 covered_tasks（迫使 retry 或 terminal_fail）。
- **Walking Skeleton 子任务 PR 已 merge 但 Brain 未重启**：staging bootstrap 脚本默认会重启 Brain 容器拉新代码，因此 health 端点应可见；若 staging 脚本未重启，记为 [ASSUMPTION] 由运维 W8.5 兜底验证。

## 范围限定

**在范围内**：

- 阶段 A 全流程（PRD + task-plan + GAN + DB upsert）真实跑出。
- 阶段 B 串行执行 T1（health 端点 + smoke test），1 个 PR 合 main。
- 阶段 C final_evaluate + report 真实写库。
- e2e_acceptance scenarios 在 staging（`scripts/harness-e2e-up.sh` 起的环境）跑 curl + psql 校验。
- `task_events` 表 `graph_node_update` 至少 14 distinct `nodeName` 是必要观测。

**不在范围内**：

- W7 运维 7 子项各自的实施（已在 W7.1-W7.7 各自 PR 中完成，不在本 Initiative 重做）。
- 故障注入 A（Docker SIGKILL）/ B（凭据失效 + interrupt resume）/ C（deadline 逾期）由主理人观测验证后写入 acceptance 报告，不由 final_evaluate 自动注入；理由：注入需要 root/docker 权限、改 1Password、psql 改 deadline_at，超出 e2e_acceptance scenarios（execSync）能干净表达的范围。
- 14 节点的并发 fanout 重新引入（当前是串行 pick→run→evaluate 循环；FullInitiativeState 仍保留 fanoutSubTasksNode 但本 Initiative 不走该路径）。
- LangGraph Platform 上线 / SaaS 化（明确 spec §架构原则：Brain 单进程 + PostgresSaver）。
- 修改 14 节点拓扑或新增节点（本 Initiative 是验证现状，不改图）。

## 假设

- [ASSUMPTION: KR "管家闭环" 当前进度估为 70%，本 Initiative PASS 后置 100%；具体 KR 编号由 Brain `/api/brain/okr/current` 在派发时回写，PRD 不写死。]
- [ASSUMPTION: `scripts/harness-e2e-up.sh` 已能拉 main 最新代码起 staging Brain（5222）+ Postgres（55432），并把 PR merge 后的 health 端点纳入构建。]
- [ASSUMPTION: 当前 main 分支上 `packages/brain/src/routes/harness.js` 文件存在或可新建（路由注册由 `packages/brain/src/server.js` 的 router mount 集中管理）。]
- [ASSUMPTION: `langgraph_version` 取自 `@langchain/langgraph` package.json `version` 字段（动态 `import.meta` 或 `require('@langchain/langgraph/package.json').version`）；`last_attempt_at` 取 `initiative_runs.updated_at MAX()` 或 NULL（无任何运行时）。]
- [ASSUMPTION: 故障注入 A/B/C 的真实结果由主理人在 acceptance 报告中以截图 + 日志摘录形式记录，不阻塞本 Initiative `phase='done'` 写入。]
- [ASSUMPTION: 本任务 1800s（30min）超时充裕跑完 14 节点 + 1 个 PR + final E2E，依据 Brain harness Walking Skeleton 历史耗时 ~12-18min。]

## 预期受影响文件

- `packages/brain/src/routes/harness.js`：新增（或在已有路由文件中追加）`GET /api/brain/harness/health` handler，返回 `{ langgraph_version, last_attempt_at, nodes: [14 个 nodeName 字符串数组] }`。
- `packages/brain/src/server.js`：若新建 routes 文件，需 mount router；若复用既有 harness routes，本文件无需改。
- `tests/integration/harness-health.test.ts`：新增 vitest 集成测试，启 staging Brain 后 curl `/api/brain/harness/health` 校验状态码 + body shape。
- `sprints/w8-langgraph-acceptance/sprint-prd.md`：本文件（Planner 产出）。
- `sprints/w8-langgraph-acceptance/task-plan.json`：Planner 产出（v2 兼容输出）；正式 task DAG 由 Proposer 在 GAN 合同审过后从 Golden Path 倒推（v8 主路径）。
- `sprints/w8-langgraph-acceptance/sprint-contract.md`：Proposer 阶段产出，本任务不涉及。
- `docs/superpowers/reports/2026-05-06-harness-langgraph-acceptance.md`：acceptance 报告（运维事后写，不在本 Initiative 自动产出）。

## journey_type: autonomous
## journey_type_reason: 本 Initiative 仅改 packages/brain/（新增 health 路由 + 集成测试），不触 apps/dashboard、packages/engine、远端 agent 协议；属于 Brain 单进程内 LangGraph 自驱的"管家闭环"验收，按 SKILL §0.5 路径优先级落入 autonomous。
