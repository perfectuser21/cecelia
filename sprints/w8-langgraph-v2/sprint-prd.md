# Sprint PRD — W8 Acceptance v2：LangGraph 14 节点端到端验证（fixed UUID）

## OKR 对齐

- **对应 KR**：harness-reliability（管家闭环可靠性 KR）
- **当前进度**：W1–W7 已合 main，但 W1 v1 acceptance 未拿到稳定 14-node 全过证据
- **本次推进预期**：拿到一次"用 fixed UUID 干净跑 + 故障注入仍自愈"的可重复 acceptance 证据，把 KR 从"原语已就位"推到"端到端可重放"

## 背景

Spec：`docs/superpowers/specs/2026-05-06-harness-langgraph-reliability-design.md`
Plan：`docs/superpowers/plans/2026-05-06-harness-langgraph-reliability.md`

W1（thread_id 版本化）/ W2（RetryPolicy）/ W3（AbortSignal+Watchdog）/ W4（streamMode）/ W5（interrupt）/ W6（docker OOM reject）/ W7（运维清单）已分别合 main。`harness-initiative.graph.js` full graph 已确认 14 节点（prep / planner / parsePrd / ganLoop / inferTaskPlan / dbUpsert / pick_sub_task / run_sub_task / evaluate / advance / retry / terminal_fail / final_evaluate / report）。

W8 v1 acceptance 用的是 `initiative_id = "harness-acceptance-2026-05-06"`（非 UUID），导致：
- DB 列 `initiative_runs.initiative_id` 是 `uuid` 类型时插入会失败 / 回退到 `task.id` UUID，使得跑动的 initiative_id 与 PRD 里写的不一致
- 多次重跑无法复用同一 thread_id 家族（attemptN 序列乱）
- LiveMonitor 上看不到稳定的"同一 initiative 多次 attempt"叠加视图

v2 用 fixed UUID `39d535f3-520a-4a92-a2b6-b31645e11664` 解决：DB 直插不报错、attemptN 单调递增可观测、LiveMonitor 与 acceptance 报告口径一致。

## Golden Path（核心场景）

主理人/Brain dispatcher 从 [派发 fixed-UUID harness_initiative] → 经过 [14 个 LangGraph 节点全流转 + 子任务全部 completed + final_evaluate verdict=PASS + 故障注入 A/B/C 自愈] → 到达 [acceptance 报告写入 + KR 进度上调 + LiveMonitor 留下可重放证据]

具体：

1. **触发条件**
   - 在 main 分支已合 W1–W7 的前提下，向 Brain `POST /api/brain/tasks` 注册一个 `task_type=harness_initiative`，`payload.initiative_id = '39d535f3-520a-4a92-a2b6-b31645e11664'`，`payload.sprint_dir = 'sprints/w8-langgraph-v2'`，walking skeleton 仅 1 个 thin feature（health endpoint），budget_usd=5、timeout_sec=1800
   - 用 `POST /api/brain/tasks/:id/dispatch` 立即派发（不等 5min tick）

2. **系统处理**
   - executor 路由到 `runHarnessInitiativeRouter`（W1 实现），thread_id = `harness-initiative:39d535f3-...:1`
   - `compiled.stream({ streamMode: 'updates', signal })` 跑 full graph（W3 + W4），逐节点写 `task_events.event_type='graph_node_update'`
   - 14 节点按预期序列流转：prep → planner → parsePrd → ganLoop → inferTaskPlan → dbUpsert → pick_sub_task → run_sub_task → evaluate → (advance|retry|terminal_fail) → ... → final_evaluate → report
   - 子图（harness-task / harness-gan）节点级 RetryPolicy（W2）兜瞬时错误
   - watchdog 5min/次扫 deadline_at，未触发
   - 三个故障注入场景按顺序在 acceptance 跑动期间叠加：
     - **场景 A**（W2+W6 联动）：在某子任务的 `evaluate` node 执行 docker container 时，外部 `docker kill <container>` 注入 SIGKILL → docker-executor Promise 立即 reject `OOM_killed` → LLM_RETRY 自动重试 3 次 → 子任务最终 PASS
     - **场景 B**（W5 联动）：故意让 final E2E 连续 FAIL 撞 `MAX_FIX_ROUNDS=3` → `finalEvaluateDispatchNode` 触发 `interrupt()` → `task_events` 写 `interrupt_pending` → `GET /api/brain/harness-interrupts` 返回该项 → `POST .../resume` body `{action:"abort"}` → graph 走 END error 分支
     - **场景 C**（W3 联动）：`UPDATE initiative_runs SET deadline_at = NOW() - INTERVAL '1 minute'` → 下次 `scanStuckHarness` tick → `phase='failed'`、`failure_reason='watchdog_overdue'`、Feishu 收到 P1 alert

3. **可观测结果**
   - `task_events` 表中针对 fixed UUID 的 14 个不同 `nodeName` 各至少 1 条 `graph_node_update` 事件
   - `initiative_runs` 行存在且 `phase='done'`（场景 A 之后 / 场景 B 用 abort override / 场景 C 单独标 failed 是预期失败终态）
   - 子任务（health endpoint feature）对应 PR 已 merge 到 main，`gh pr list --search "<acceptance branch>" --state merged` 命中
   - LiveMonitor 渲染出 attemptN ≥ 1 的节点进度条（W4 前端已就位）
   - acceptance 报告 `docs/superpowers/reports/2026-05-07-harness-langgraph-acceptance-v2.md` 写入并 commit
   - OKR API `GET /api/brain/okr/current` 中 harness-reliability KR 进度 +Δ

## 边界情况

- **fixed UUID 已在 `tasks` / `initiative_runs` / `initiative_contracts` 表里残留 v1 数据**：dispatch 前必须有清理 SQL（DELETE WHERE initiative_id=...），否则 W1 attemptN 会从一个奇怪的数字起跳，破坏可重放
- **场景 B interrupt 未在 24h 内 resume**：W5 文档承诺 24h 自动当 abort，acceptance 必须在同次会话内 resume，避免延迟引入额外故障
- **场景 C deadline 强改为过去**：必须在 watchdog 真的扫到之前别让其它 tick 把任务推完，否则 phase 已变成 done 再改 deadline 没意义
- **同时跑多个 acceptance**：fixed UUID 强制单实例，重跑前必须先把上轮 `initiative_runs.completed_at IS NULL` 的行标 failed 收尾
- **健康检查 endpoint 已存在**：T1 创建前 grep 一次，已有则只补测试不重复创建
- **Brain 进程在 acceptance 中途崩**：W1 + W3 应该让重启后 attemptN 升 N 走 fresh，但本次 acceptance 的"全程无干预"判定要把这种意外排除在故障注入之外

## 范围限定

**在范围内**：

- 注册 fixed UUID `39d535f3-520a-4a92-a2b6-b31645e11664` 的 harness_initiative，跑通 14 节点 full graph 一次干净路径
- 在跑动期间叠加 3 个故障注入场景（A docker SIGKILL / B max_fix_rounds interrupt / C watchdog deadline），验证 W2/W3/W5/W6 真的联动起作用
- 单一 thin feature：`GET /api/brain/harness/health` 返回 `{ langgraph_version, last_attempt_at }`
- 写 acceptance 报告 `docs/superpowers/reports/2026-05-07-harness-langgraph-acceptance-v2.md`，含 14 节点事件计数表、3 个故障注入终态表、KR 进度增量截图

**不在范围内**：

- 修任何 W1–W7 的 regression（如果跑动过程中发现 bug，写到报告 follow-up 节，单独立 task）
- 新业务 feature（health endpoint 仅作 acceptance 的最小可执行落地）
- LangGraph Platform 迁移、Brain 多副本 HA、跨进程编排
- Dashboard UI 美化（W4/W5 页面渲染功能性可见即可）
- 改 spec 或 plan 文档（v2 报告独立）

## 假设

- [ASSUMPTION: W1–W7 全部已在 main 且 CI 全绿；本 sprint 不重复验证已有 PR 的 DoD 测试]
- [ASSUMPTION: 西安 Mac mini Brain 实例 `localhost:5221` 在跑动期间稳定，无外部 OOM/重启干扰，使得 attemptN=1 可以成功跑完 happy path]
- [ASSUMPTION: 1Password 中 Anthropic / Codex 凭据有效，无需 W7.5 的凭据巡检兜底；故障注入 B 不再依赖坏凭据，而是依赖 final E2E 连续 FAIL]
- [ASSUMPTION: 本机有 `docker` / `psql` / `gh` / `curl` / `jq` 可用，用于故障注入与验证]
- [ASSUMPTION: fixed UUID 在 DB 中现有的 `initiative_runs` / `initiative_contracts` / `tasks` 行允许 acceptance 脚本主动清理（已收尾或允许标 failed）]
- [ASSUMPTION: acceptance 跑动产物（branch、PR、报告）可以使用今日 2026-05-07 的日期 + `cp-MMDDHHNN-w8-acceptance-v2-*` 命名]

## 预期受影响文件

- `packages/brain/src/routes/harness.js`：新增 `GET /api/brain/harness/health` 路由处理函数（thin feature）
- `tests/integration/harness-health-endpoint.test.ts`：health endpoint 200 + body schema smoke
- `scripts/acceptance/w8-v2/register-and-dispatch.sh`：fixed UUID 注册 + 触发 + 流式 tail 节点事件
- `scripts/acceptance/w8-v2/inject-fault-a-docker-sigkill.sh`：场景 A 注入与终态校验
- `scripts/acceptance/w8-v2/inject-fault-b-max-fix-interrupt.sh`：场景 B 注入与 resume 校验
- `scripts/acceptance/w8-v2/inject-fault-c-watchdog-deadline.sh`：场景 C 注入与 watchdog 终态校验
- `scripts/acceptance/w8-v2/verify-checklist.sh`：14 节点事件计数 + PR merged + KR 增量 + acceptance task 终态聚合
- `sprints/w8-langgraph-v2/dispatch.log` / `fault-a.log` / `fault-b.log` / `fault-c.log` / `verify.log`：每步实跑日志，作为报告附件
- `docs/superpowers/reports/2026-05-07-harness-langgraph-acceptance-v2.md`：acceptance 报告（结论 + 三表 + follow-up）

## journey_type: autonomous
## journey_type_reason: 主路径完全在 packages/brain 内的 LangGraph 调度 + Docker 子进程 + watchdog tick 自动跑通，主理人只在场景 B 的 interrupt 决策这一步介入，符合 autonomous 主体 + 单点 user-touch 的形态
