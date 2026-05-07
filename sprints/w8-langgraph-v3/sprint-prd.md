# Sprint PRD — [W8 Acceptance v3] LangGraph 14 节点端到端验证（post-deploy）

## OKR 对齐

- **对应 KR**：管家闭环（Harness 自驱跑通无人干预）—— Harness LangGraph 可靠性打通 initiative 的最终 acceptance gate
- **当前进度**：W1–W7 子工作流已合 main（见 d3561e97d / df1fc7ab9 / 990cbaebb 等），acceptance 此前 v1/v2 未跑通
- **本次推进预期**：Acceptance 跑通 → KR "管家闭环 14 节点全过 + 故障自愈 + 全程无人干预" 第一次拿到证据，KR 进度从"代码就绪"推进到"行为已验证"

## 背景

`docs/superpowers/specs/2026-05-06-harness-langgraph-reliability-design.md §4` 定义了端到端 acceptance：派一个 walking skeleton initiative → 14 节点全过 → 注入 3 类故障（Docker SIGKILL / 凭据失效 / Deadline 逾期）→ 验证系统自愈 + 全程无人介入。

v1/v2 acceptance 失败原因为代码侧 bug（W6 Promise 不 reject、harness_initiative status 不回写、task-plan.json 误生成等），均已分别合并 main（PR #2807/#2813/#2816/#2819/#2820/#2834）。

v3 的关键差异是 **post-deploy**：本次 acceptance 必须跑在「最新 main 已部署到 Brain 容器」之后，验证已合 PR 在真实部署环境中协同生效，而不是在 dev branch 或 stale 容器里。

## Golden Path（核心场景）

主理人/Brain 从 [触发 acceptance initiative] → 经过 [graph 14 节点全过 + 3 次故障注入自愈] → 到达 [出 acceptance 报告 + KR 进度更新 + PR merged]

具体：

1. **触发条件**：当前 main HEAD 已部署进 Brain 容器（image digest 与 main HEAD commit 对得上），所有 W1–W7 PR 已 merged，无残留 stuck task 占用 docker 资源
2. **派发**：以 `task_type=harness_initiative`、`priority=P1`、`payload.initiative_id=harness-acceptance-v3-2026-05-07`、`sprint_dir=sprints/harness-acceptance-v3` 注册 walking skeleton initiative（thin feature = `GET /api/brain/harness/health` 返回 langgraph_version + last_attempt_at；e2e_test_path = `tests/e2e/harness-acceptance-smoke.spec.ts`），随后调用 dispatch endpoint 立即派发
3. **14 节点跑通**：Brain 在该 initiative 的 thread 上跑完 full graph 14 节点，每个节点至少产生一条 `task_events.event_type='graph_node_update'`（节点列表：prep / planner / parsePrd / ganLoop / inferTaskPlan / dbUpsert / pick_sub_task / run_sub_task / evaluate / advance / retry / terminal_fail / final_evaluate / report）
4. **故障注入 A — Docker SIGKILL**：在某子任务 `run_sub_task` 节点跑中时 `docker kill <container>`；期望 W6 Promise 立即 reject + W2 LLM_RETRY 自动重试 ≤3 次，子任务最终 PASS，无需人工 SQL/重启
5. **故障注入 B — 凭据失效（max_fix_rounds 触发）**：在 `final_evaluate` 让 E2E 一直 FAIL 直到撞 max_fix_rounds → W5 `interrupt()` 暂停，写一条 `harness_interrupts` pending；主理人通过 `POST /api/brain/harness-interrupts/:id/resume {action:"abort"}` 决定，graph 干净走到 END(error)
6. **故障注入 C — Deadline 逾期**：`UPDATE initiative_runs SET deadline_at = NOW() - INTERVAL '1 minute'`；期望 W3 watchdog 5 分钟内扫到 → 标 `phase=failed, failure_reason=watchdog_overdue`；下次重派同 initiative_id 时 W1 `attemptN+1` → fresh thread 启动
7. **最终验证**：health endpoint live、acceptance initiative 关联的 PR merged、KR 进度 +1% 或更多、LiveMonitor 浏览器侧能看到节点事件、acceptance 报告写入 `docs/superpowers/reports/2026-05-07-harness-langgraph-acceptance-v3.md`
8. **可观测出口**：报告必须给出每个故障注入的"注入时刻 → 系统反应时刻 → 自愈终态"时间线，以及 14 节点 events 表 `node × count` 截图/SQL 输出

## 边界情况

- **CI 久等子任务**：W8 acceptance 自身派出的子 dev task 走完整 dev pipeline（worktree + Stop Hook + verify-step），CI 可能跑 10–30 min；acceptance task 的 `timeout_sec` 必须 ≥ 1800 否则 watchdog 会先于子任务 PR merge 把 acceptance 自己判 deadline。Note：场景 C 的故意逾期需绕开 acceptance 主任务，只对 `initiative_runs.deadline_at` 做精确 UPDATE
- **W5 interrupt 24h 自动 timeout**：场景 B 必须确保主理人在 24h 内 resume，否则 interrupt 自身超时机制会把它当 abort（不是 bug，但报告需注明实际 resume 时刻）
- **故障注入 A 的 race**：`docker kill` 可能命中 prep/planner 等 LLM_RETRY 节点而非 `run_sub_task`；接受任意 LLM_RETRY 节点被 kill 都验证为通过（核心是 W6+W2 联动）
- **空状态 / 重复派发**：同 `initiative_id` 不允许重复派发，第二次 dispatch 必须返回 409 或返回旧 task_id（取决于 Brain 当前实现）；本 PRD 不要求行为对齐，但报告需记录实际行为
- **post-deploy 校验**：开始 acceptance 前需验证 `docker exec brain git rev-parse HEAD` == `git rev-parse origin/main`，否则跑的是 stale Brain
- **emergency_brake 干扰**：Brain 进入 `emergency_brake` 会 cancel P1/P2 task；acceptance 用 P1，因此跑前需确认 Brain 不在 emergency_brake 状态（`/api/brain/status` 返回非 emergency_brake）
- **vitest hang 进程残留**：进入 acceptance 前清理任何长跑 vitest 进程（避免误占 docker slot）

## 范围限定

**在范围内**：
- 注册并派发 acceptance initiative（v3 用新 `initiative_id` 避免污染 v1/v2 checkpoint）
- 跑通 14 节点 + 注入 A/B/C 三类故障
- 写 acceptance 报告
- KR 进度回写
- 给出 LiveMonitor 截图位置（不强制截图入库，但需有可复现 URL）

**不在范围内**：
- 修任何 Brain / engine / dashboard 代码（只验证已部署的代码；如发现 bug 另起 task）
- 重新跑 W1–W7 的单测/集测（已通过各自 PR CI）
- 对 MJ1 旧 task `b10de974-...` 做任何操作
- 重写 LangGraph 引擎或上 LangGraph Platform
- 上线 health endpoint 之外的新 feature
- 跨 Brain 副本的 HA 验证

## 假设

- [ASSUMPTION: 当前 main HEAD `d3561e97d` 已部署进 Brain 容器，acceptance 开跑前由执行者用 `docker exec brain git rev-parse HEAD` 校验通过；如不一致则先重 deploy，不在本 PRD scope]
- [ASSUMPTION: Codex / Anthropic / OpenAI 凭据有效（场景 B 依靠"反复 FAIL 撞 max_fix_rounds"触发 W5，不再依赖 op 改 key 的方式，因为 op 改 key 可能误伤其他在跑任务）]
- [ASSUMPTION: `harness-acceptance-v3-2026-05-07` 这个 initiative_id 在 DB 中不存在，未与历史 acceptance run 冲突]
- [ASSUMPTION: docker-executor mount 共享 /workspace 的限制（见 progress 报告 21:14 更新）不影响 acceptance —— 因为 acceptance 子任务串行而非并行]
- [ASSUMPTION: GET `/api/brain/harness/health` endpoint 已在某个 W 任务里实现并 merged；若仍缺，acceptance 派出的子任务即承担实现工作，不需要本 PRD 单独再派 feature task]
- [ASSUMPTION: Feishu webhook 已 unmute，故障注入期间的 P1/P2 alert 会进群，方便事后回溯时间线]

## 预期受影响文件

- `sprints/w8-langgraph-v3/sprint-prd.md`：本 PRD 自身（提交进 main 留痕）
- `sprints/w8-langgraph-v3/sprint-contract.md`：Proposer 后续生成
- `sprints/w8-langgraph-v3/task-plan.json`：Proposer 倒推
- `sprints/harness-acceptance-v3/`：acceptance initiative 自身派出的子 dev task 工作目录（由 Brain 建）
- `docs/superpowers/reports/2026-05-07-harness-langgraph-acceptance-v3.md`：最终 acceptance 报告（合本 PRD 验收唯一产物）
- `task_events`（DB 表，只读验证）：14 节点 graph_node_update 事件
- `initiative_runs`（DB 表，写：场景 C 故意 UPDATE deadline_at，结束后还原）
- `harness_interrupts`（DB 表，只读验证）：场景 B pending → resumed
- `tasks`（DB 表，只读验证）：acceptance task 终态 + 子 dev task PR merge

## journey_type: autonomous
## journey_type_reason: 主路径在 Brain 自驱（tick → harness graph → docker dispatch → 故障自愈），仅在最终验证读 LiveMonitor，主体仍以 packages/brain 为起点
