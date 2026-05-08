# Sprint PRD — [W8 Acceptance v4] LangGraph 14 节点端到端验证（post PR #2837 deploy）

## OKR 对齐

- **对应 KR**：管家闭环（Harness 自驱跑通无人干预）—— Harness LangGraph 可靠性 initiative 的 acceptance gate
- **当前进度**：v3 跑出 6/7 PRD 验收项绿，1 fail（inferTaskPlan 找不到 propose 分支：`cp-MMDDHHmm-{taskIdSlice}` ≠ SKILL 实际推的 `cp-harness-propose-r{N}-{taskIdSlice}`）。PR #2837 已合并双修：SKILL Step 4 改"每轮均输出 verdict JSON" + graph fallback 改与 SKILL 同格式。
- **本次推进预期**：post PR #2837 deploy 重跑 acceptance → 14 节点全过 + 终态 `status=completed`（非 failed）→ KR "管家闭环"从 6/7 推到 7/7，第一次拿到完整 acceptance 证据。

## 背景

v3（branch `cp-05080758-harness-prd-w8v3` / task `49dafaf4`）跑了 30 分钟，graph 推到 `inferTaskPlan` 节点报：

```
[infer_task_plan] git show origin/cp-05080823-49dafaf4:sprints/w8-langgraph-v3/task-plan.json failed:
fatal: invalid object name 'origin/cp-05080823-49dafaf4'
```

实证：origin 上 `cp-harness-propose-r1-49dafaf4` 与 `cp-harness-propose-r2-49dafaf4` 两个分支均含真实 task-plan.json（PR #2820 写入逻辑生效），但 graph 找的 `cp-05080823-49dafaf4` 根本不存在。

PR #2837 双修：
1. `packages/workflows/skills/harness-contract-proposer/SKILL.md` Step 4 删 "GAN APPROVED 后" 限定，改 "每轮（含被 REVISION 打回轮）均输出 verdict JSON"，新增"输出契约"段
2. `packages/brain/src/workflows/harness-gan.graph.js` `fallbackProposeBranch(taskId, round)` 改用 `cp-harness-propose-r{round}-{taskIdSlice}` 与 SKILL push 同格式

v4 即在 PR #2837 已部署进 Brain 容器之后重跑同样的 acceptance walking skeleton —— 验证修复在真实部署环境协同生效，而非只在单测/smoke。

---

## 1. Journey 上下文（v9）

- **Journey 名称**：Harness LangGraph 14 节点端到端自驱可靠性（autonomous）
- **Notion URL**：[ASSUMPTION: 同 v3 PRD 引用的 initiative，Notion 主页面 URL 由主理人在 acceptance 报告中补全；本 PRD 暂不强制]
- **当前 Maturity**：mvp → production 的 gate（acceptance 通过即跨入 production）
- **Journey Type**：autonomous（主路径在 Brain 自驱：tick → harness graph → docker dispatch → 故障自愈）
- **端到端步骤**（共 14 节点）：
  Step 1: prep
  Step 2: planner
  Step 3: parsePrd
  Step 4: ganLoop
  Step 5: inferTaskPlan
  Step 6: dbUpsert
  Step 7: pick_sub_task
  Step 8: run_sub_task
  Step 9: evaluate
  Step 10: advance
  Step 11: retry
  Step 12: terminal_fail
  Step 13: final_evaluate
  Step 14: report
- **E2E Test Path**：`tests/e2e/harness-acceptance-smoke.spec.ts`（v3 既定路径，沿用）

## 2. Feature 清单（v9）

| # | Feature 名称 | Journey Step | thickness from → to | 备注 |
|---|---|---|---|---|
| 1 | propose_branch 协议对齐验证 | Step 4 (ganLoop) → Step 5 (inferTaskPlan) | new → thin | PR #2837 修复对象，本次 acceptance 主验目标 |
| 2 | 14 节点 graph_node_update 完整事件流 | Step 1 → Step 14 | thin → medium | v3 已验 6/7 节点，v4 需补全到 14/14 |
| 3 | 故障注入 A — Docker SIGKILL 自愈 | Step 8 (run_sub_task) | thin → thin（保持） | W6 Promise reject + W2 LLM_RETRY 联动 |
| 4 | 故障注入 B — max_fix_rounds → W5 interrupt 暂停 | Step 13 (final_evaluate) | thin → thin（保持） | 主理人 abort decision 路径 |
| 5 | 故障注入 C — Deadline 逾期 watchdog 自标 failed | Step 1（attemptN+1 启动）| thin → thin（保持） | W3 watchdog 5 min 内扫到 |

## 3. Feature 0：Journey 端到端验证（v9，gating）

- **smoke 路径**：`tests/e2e/harness-acceptance-smoke.spec.ts`（v3 沿用）+ acceptance 主任务自身的 graph 跑通（dispatch → 14 节点 → completed）
- **验证范围**：从 Step 1 (prep) 跑到 Step 14 (report)，14 节点全过，acceptance task 终态 `status=completed`，DB `task_events` 表 14 条 distinct `graph_node_update` 事件
- **gating 规则**：Feature 0 FAIL（任一节点未触发 / 终态非 completed / 卡在 inferTaskPlan）= 整 sprint FAIL，不论故障注入 A/B/C 是否通过
- **Reviewer 必挑战项**（Proposer 起草合同时必须含）：
  - smoke 真的从 Step 1 跑到 Step 14？没有 mock 节点 / 没有中间 `exit 0` 假装通过？
  - 14 节点事件来自真实 graph 调用（DB `task_events.event_type='graph_node_update'`），不是手插的 fixture？
  - acceptance task 的终态读取来自 `tasks` 表真实查询而非 stdout 自报？

## 4. Lead 客户机自验（v9，铁律 7）

- **worker_machine**：Brain 容器宿主（执行者所在 host —— 已部署 PR #2837 的目标机器；ZenithJoy 默认 `xian-pc`，本任务为 Cecelia Mac mini 主机）
- **checklist**（按客户视角顺序，≥5 步）：
  1. ssh / 直登 worker_machine，确认能访问 Brain 容器
  2. `docker exec brain git rev-parse HEAD` 输出 == `git rev-parse origin/main`（保证 PR #2837 已 deploy，不是 stale image）
  3. `curl localhost:5221/api/brain/status` 返回非 emergency_brake；无残留 in_progress harness_initiative task 占用 docker slot
  4. `POST /api/brain/tasks` 注册 acceptance v4 initiative（新 `initiative_id=harness-acceptance-v4-2026-05-08`）→ `POST /api/brain/dispatch`
  5. 实时观测：DB `task_events` 表对该 task_id 持续 SELECT，看到 14 条 distinct `graph_node_update` 事件（特别是 v3 卡住的 `inferTaskPlan` 必须有事件，且后续 `dbUpsert` / `pick_sub_task` / ... / `report` 全部触发）
  6. 主理人在 LiveMonitor 浏览器侧（Workspace Dashboard 对应页面）肉眼确认节点流水图推进
  7. 终态校验：`SELECT status FROM tasks WHERE id='<task_id>'` 返回 `completed`（非 `failed`）
- **evidence_path**：`.agent-knowledge/harness-langgraph-14-node/lead-acceptance-w8-v4.md`
- **完成判据**：evidence 文件含步骤 2/3/4/5/7 的命令 stdout 摘录 + LiveMonitor 截图（或可复现 URL）+ lead 在 worker 真跑过全链路签名。**未自验或证据为空 = sprint 不能 deliver 给主理人对外宣称 KR 推进。**

## 5. Golden Path（核心场景）

主理人/Brain 从 [post #2837 deploy 触发 acceptance v4] → 经过 [14 节点全过 + 3 次故障注入自愈] → 到达 [出 v4 acceptance 报告 + KR 进度 7/7 + 主理人 lead 自验签名]。

具体：

1. **触发条件**：当前 main HEAD（含 PR #2837 fix）已部署进 Brain 容器；image digest 与 main HEAD commit 对得上；无残留 stuck harness task；Brain 不在 emergency_brake；Codex/Anthropic/OpenAI 凭据有效
2. **派发**：以 `task_type=harness_initiative`、`priority=P1`、`payload.initiative_id=harness-acceptance-v4-2026-05-08`、`sprint_dir=sprints/harness-acceptance-v4`、`timeout_sec=1800` 注册新 initiative（thin feature 同 v3：`GET /api/brain/harness/health` 返回 `langgraph_version + last_attempt_at`；e2e_test_path = `tests/e2e/harness-acceptance-smoke.spec.ts`），随后调 `POST /api/brain/dispatch` 立即派
3. **14 节点跑通**：Brain 在该 initiative thread 上跑完 full graph 14 节点，每节点 ≥1 条 `task_events.event_type='graph_node_update'`；**特别验证 inferTaskPlan 节点正确读到 `cp-harness-propose-r{N}-49dafaf4`-style 分支上的 task-plan.json**（v3 fail 点）
4. **故障注入 A — Docker SIGKILL**：在某子任务 `run_sub_task` 节点跑中时 `docker kill <container>`；期望 W6 Promise 立即 reject + W2 LLM_RETRY 自动重试 ≤3 次，子任务最终 PASS，无人工干预
5. **故障注入 B — 凭据失效（max_fix_rounds 触发）**：在 `final_evaluate` 让 E2E 持续 FAIL 直到撞 max_fix_rounds → W5 `interrupt()` 暂停，写一条 `harness_interrupts` pending；主理人 `POST /api/brain/harness-interrupts/:id/resume {action:"abort"}` 决定，graph 干净走到 END(error)
6. **故障注入 C — Deadline 逾期**：`UPDATE initiative_runs SET deadline_at = NOW() - INTERVAL '1 minute' WHERE initiative_id='harness-acceptance-v4-2026-05-08'`；期望 W3 watchdog 5 min 内扫到 → 标 `phase=failed, failure_reason=watchdog_overdue`；下次重派同 initiative_id 时 W1 `attemptN+1` → fresh thread 启动
7. **最终验证**：health endpoint live、acceptance task `status=completed`、关联子 dev task PR 已 merged、KR 进度 +1% 或更多、LiveMonitor 浏览器侧 14 节点流水可见、acceptance 报告写入 `docs/superpowers/reports/2026-05-08-harness-langgraph-acceptance-v4.md`
8. **可观测出口**：报告含每个故障注入的"注入时刻 → 系统反应时刻 → 自愈终态"时间线，14 节点 events `node × count` 的 SQL 输出，以及与 v3 的 diff 对照表（重点列 v3 fail 项 → v4 状态）

## 边界情况

- **CI 久等子任务**：W8 acceptance 自身派出的子 dev task 走完整 dev pipeline（worktree + Stop Hook + verify-step），CI 可能跑 10–30 min；acceptance task 的 `timeout_sec` 必须 ≥ 1800，否则 watchdog 会先于子任务 PR merge 把 acceptance 自己判 deadline。**场景 C 的故意逾期需绕开 acceptance 主任务，只对 `initiative_runs.deadline_at` 做精确 UPDATE**
- **W5 interrupt 24h 自动 timeout**：场景 B 必须确保主理人在 24h 内 resume，否则 interrupt 自身超时机制会把它当 abort（不是 bug，但报告需注明实际 resume 时刻）
- **故障注入 A 的 race**：`docker kill` 可能命中 prep/planner 等 LLM_RETRY 节点而非 `run_sub_task`；接受任意 LLM_RETRY 节点被 kill 都验证为通过（核心是 W6+W2 联动）
- **空状态 / 重复派发**：同 `initiative_id=harness-acceptance-v4-2026-05-08` 不允许重复派发，第二次 dispatch 必须返回 409 或返回旧 task_id；本 PRD 不要求行为对齐，但报告需记录实际行为
- **post-deploy 校验**：开始 acceptance 前 `docker exec brain git rev-parse HEAD` == `git rev-parse origin/main`；尤其需校验 `packages/workflows/skills/harness-contract-proposer/SKILL.md` v7.2.0 已生效（grep `每轮（含被 REVISION 打回轮）`），与 `harness-gan.graph.js` 中 `fallbackProposeBranch` 用 `cp-harness-propose-r${round}-${taskIdSlice}` 格式（grep 验证）
- **emergency_brake 干扰**：Brain 进入 `emergency_brake` 会 cancel P1/P2 task；acceptance 用 P1，因此跑前需确认 Brain 不在 emergency_brake 状态（`/api/brain/status` 返回非 emergency_brake）
- **vitest hang 进程残留**：进入 acceptance 前清理任何长跑 vitest 进程（避免误占 docker slot）
- **v3 残留**：`cp-harness-propose-r1-49dafaf4` / `cp-harness-propose-r2-49dafaf4` 两个 origin 分支保留作历史证据，acceptance v4 用全新 task_id，不复用 49dafaf4 thread

## 范围限定

**在范围内**：
- 注册并派发 acceptance v4 initiative（新 `initiative_id=harness-acceptance-v4-2026-05-08` 避免污染 v3 / 49dafaf4 checkpoint）
- 跑通 14 节点 + 注入 A/B/C 三类故障
- 重点验证 v3 fail 点：inferTaskPlan 正确读到 `cp-harness-propose-r{N}-{taskIdSlice}` 上的 task-plan.json
- 写 v4 acceptance 报告（含 v3 → v4 diff 对照表）
- KR 进度回写
- 给出 LiveMonitor 截图位置（不强制截图入库，但需有可复现 URL）

**不在范围内**：
- 修任何 Brain / engine / dashboard 代码（只验证已部署的代码；如发现 bug 另起 task，不在 v4 修）
- 重新跑 W1–W7 的单测/集测（已通过各自 PR CI）
- 对 v3 task `49dafaf4` 做任何操作（保留作历史证据）
- 重写 LangGraph 引擎或上 LangGraph Platform
- 上线 health endpoint 之外的新 feature
- 跨 Brain 副本的 HA 验证
- PR #2837 自身的回归（已由 #2837 PR 内部 9 unit + 3 smoke 覆盖）

## 假设

- [ASSUMPTION: 当前 main HEAD（含 d3561e97d 之后的 PR #2837 merge commit）已部署进 Brain 容器；acceptance 开跑前由执行者用 `docker exec brain git rev-parse HEAD` + 关键文件 grep 校验通过；如不一致则先重 deploy，不在本 PRD scope]
- [ASSUMPTION: Codex / Anthropic / OpenAI 凭据有效（场景 B 依靠"反复 FAIL 撞 max_fix_rounds"触发 W5，不依赖 op 改 key 的方式）]
- [ASSUMPTION: `harness-acceptance-v4-2026-05-08` 这个 initiative_id 在 DB 中不存在，未与 v1/v2/v3 历史 acceptance run 冲突]
- [ASSUMPTION: docker-executor mount 共享 /workspace 限制不影响 acceptance —— 因 acceptance 子任务串行而非并行]
- [ASSUMPTION: GET `/api/brain/harness/health` endpoint 已在某 W 任务里实现并 merged；若仍缺，acceptance v4 派出的子任务即承担实现工作，不需要本 PRD 单独再派 feature task]
- [ASSUMPTION: Feishu webhook 已 unmute，故障注入期间的 P1/P2 alert 会进群，方便事后回溯时间线]
- [ASSUMPTION: Brain API `localhost:5221` 在 acceptance 执行机本地可达；如执行环境无法直连（如远端 worktree agent），由执行者补充 ssh 跳板说明，写进 evidence]

## 预期受影响文件

- `sprints/w8-langgraph-v4/sprint-prd.md`：本 PRD 自身（提交进 main 留痕）
- `sprints/w8-langgraph-v4/sprint-contract.md`：Proposer 后续生成
- `sprints/w8-langgraph-v4/task-plan.json`：Proposer 倒推
- `sprints/harness-acceptance-v4/`：acceptance v4 initiative 自身派出的子 dev task 工作目录（由 Brain 建）
- `docs/superpowers/reports/2026-05-08-harness-langgraph-acceptance-v4.md`：最终 acceptance 报告（合本 PRD 验收唯一产物，含 v3 → v4 diff 对照表）
- `.agent-knowledge/harness-langgraph-14-node/lead-acceptance-w8-v4.md`：lead 自验证据（铁律 7 必填）
- `task_events`（DB 表，只读验证）：14 节点 graph_node_update 事件
- `initiative_runs`（DB 表，写：场景 C 故意 UPDATE deadline_at，结束后还原)
- `harness_interrupts`（DB 表，只读验证）：场景 B pending → resumed
- `tasks`（DB 表，只读验证）：acceptance v4 task 终态 `status=completed` + 子 dev task PR merge

## journey_type: autonomous
## journey_type_reason: 主路径在 Brain 自驱（tick → harness graph 14 节点 → docker dispatch → 故障自愈），仅最终验证读 LiveMonitor，主体仍以 packages/brain 为起点；与 v3 一致
