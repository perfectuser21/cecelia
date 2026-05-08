# Sprint PRD — W8 v9 LangGraph 修正全套 final acceptance

## OKR 对齐

- **对应 KR**：管家闭环（harness_initiative 全自动跑通）KR
- **当前进度**：Stream 1-5 + Layer 3 + 3 hotfix 已全部 merge 到 main，但端到端真实跑通未验收
- **本次推进预期**：从"组件级单测全绿"推进到"端到端 walking skeleton 真实跑通无人干预" — KR 从设计完成态→可观测验证态

## 背景

W8 v8 acceptance（之前批次）跑到 sub_task fanout 节点，spawn 容器跑通 + 真生成 PR #2848，但 callback POST URL 错（entrypoint.sh 用 docker 自动 hex HOSTNAME 而非 thread_lookup 表里的 `--name`）→ graph 永等。
之后修了 4 个 hotfix（PR #2845/2846/2847/2850）：
- Layer 3 `spawnGeneratorNode` 重构成 spawn-and-interrupt 模式（不再 await 长任务）
- `runGanLoopNode` 自动 getPgCheckpointer 兜底
- spawnNode 调 resolveAccount 让容器拿到正确 credentials mount
- entrypoint.sh 优先用注入的 `HARNESS_CALLBACK_URL` env 而非自己拼 HOSTNAME

W8 v9 的任务：再派一次 walking skeleton，证明这套修正合体后能从派发→graph 跑→sub_task spawn→callback→resume→final_evaluate→PR merge 全程无干预跑完。

## Golden Path（核心场景）

主理人调 Brain API 派一个 harness_initiative walking skeleton 任务 → 经过 LangGraph harness-initiative 全图 14 节点（含 sub_task spawn-callback-resume 子循环）→ 到达 task.status=completed + final_e2e_verdict=PASS + sub_task 至少 1 个 PR 合并到 main，全程无人手 SQL / 无 brain restart。

具体：

1. **触发**：主理人 POST `localhost:5221/api/brain/tasks` 派 task_type=harness_initiative + payload.walking_skeleton（thin feature 1 个，e2e_test_path 1 条）→ Brain dispatcher tick 拿到 → 路由到 `runHarnessInitiativeRouter` → LangGraph harness-initiative full graph 启动，thread_id=`harness-initiative:<id>:1`，PG checkpointer 持久化每个节点 state。

2. **A 阶段（Planning）**：依次过 `prep / planner / parsePrd / ganLoop / inferTaskPlan / dbUpsert` 6 节点。`task_events` 表对应 6 条 `graph_node_update`。dbUpsert 写出 N 个 sub_task 行（payload 含 contract_dod_path）。

3. **B 阶段（sub_task fanout — spawn-callback-resume 闭环）**：`pick_sub_task` 选首个 sub_task → `run_sub_task` 节点用 Layer 3 spawn-and-interrupt 模式：调 resolveAccount 拿 credentials → docker run 起 `harness-task-ws<N>-r0-<short>` 容器（名字与 `HARNESS_CALLBACK_URL` 注入路径一致）→ 节点立即 return → 下个节点 `interrupt()` yield → state 落 PG checkpointer。容器内 claude CLI 跑完输出 `{"verdict":"DONE","pr_url":"..."}` exit=0 → entrypoint.sh 用 env 里的 `HARNESS_CALLBACK_URL` POST 到 callback router → router 查 `walking_skeleton_thread_lookup` / `harness_thread_lookup` 拿 thread_id → 用 `Command({resume:...})` 唤回 graph → `evaluate / advance` 节点跑完 sub_task verdict 入库。

4. **C 阶段（Final E2E）**：所有 sub_task 完成 → `final_evaluate` 跑 walking skeleton 的 e2e_acceptance（一条 curl/test 命令）→ verdict=PASS → `report` 节点写 task.result + 关 initiative_runs.completed_at。

5. **可观测出口**：
   - `tasks` 表 W8 v9 task: status=completed, custom_props.final_e2e_verdict=PASS
   - `task_events` 表：≥7 条 `graph_node_update` event（覆盖 prep→report 主干），sub_task 至少 1 条 `interrupt_pending` + 对应 1 条 `interrupt_resumed`
   - `initiative_runs` 表：phase=completed_success（不是 failed/watchdog_overdue），completed_at 非空
   - GitHub：sub_task 的 PR 合并到 main（CI 全绿，无 --admin / --no-verify）
   - Brain log：无 `await_callback timeout`、无 `lookup miss 404`、无 `OOM_killed` reject 后无人接住

## 边界情况

- **Brain 中途重启**（电脑睡眠 / 手动 restart）→ PG checkpointer 还在 → 新 Brain 起来后 callback 到达仍能命中 thread_lookup → graph 接续跑（不丢任务）
- **sub_task 容器跑失败**（claude CLI exit≠0）→ entrypoint.sh 仍 POST callback 带 verdict=FAIL → evaluate 节点判 fail → advance 走 retry 路径（最多 retry_count 次）→ 仍失败则 terminal_fail 节点收尾，不卡住
- **sub_task 容器 OOM SIGKILL**（exit=137）→ docker-executor 必 reject（不 hang，W6 已修）→ run_sub_task 节点抛错 → LLM_RETRY 重试 3 次
- **callback 慢于 Brain 重启**：在 Brain 起来前没收到 callback，但容器仍存在并 POST 来 → router 查表命中 → 正常 resume（thread_lookup 表 PG 持久化，不在内存）
- **同名 thread 已有 checkpoint**：因为 W8 v9 是新 initiative_id，不会撞 v8 的 checkpoint（W1 attemptN 版本化机制）

## 范围限定

**在范围内**：
- 用现有 packages/brain LangGraph 全套（不再改代码）真派一次新 harness_initiative
- 验证主干 spawn-callback-resume 闭环：单 sub_task fanout 跑通即算 PASS
- 验证 PG checkpointer 持久性（中途主动 brain restart 一次也能续跑）
- 跑通后写 acceptance report 入 docs/superpowers/reports/

**不在范围内**：
- 不再注入故障 A/B/C（OOM / 凭据失效 / deadline 逾期）— 那是后续 reliability 加强 sprint
- 不验证多 sub_task 并发 fanout（walking skeleton 1 个 sub_task 就够）
- 不改 graph 代码 / 不改 entrypoint.sh / 不改 callback router（任何代码变更先开新 sprint）
- 不验证 W5 interrupt() 主理人决策路径（max_fix_round → operator decision）— 那是 W5 自己的故事
- 不跑 Dashboard LiveMonitor 视觉验证（autonomous 不依赖 UI）

## 假设

- [ASSUMPTION: 当前 main 分支（含 e1bffeed5 hotfix HARNESS_CALLBACK_URL）已部署到 host Brain（pid 在跑），Brain `/api/brain/health` 返回 healthy]
- [ASSUMPTION: 1Password CS Vault 里 Anthropic / Codex 凭据有效（之前一轮已 sync），sub_task 容器调 LLM 不会 401]
- [ASSUMPTION: walking skeleton 的 e2e_acceptance 命令是个 curl 探活类（不需要复杂前端启动），失败可以快速诊断]
- [ASSUMPTION: 主理人在跑过程中不会手动改 main 分支或 cancel task — acceptance 要的是"无人干预"基线]
- [ASSUMPTION: 当前未消化的 cp-* 分支或 PR 不会与本次 acceptance 的 sub_task PR 撞 cp- 分支名（用 timestamp 短哈希区分）]

## 预期受影响文件

- `sprints/w8-langgraph-v9/sprint-prd.md`：本 PRD（Planner 产出）
- `sprints/w8-langgraph-v9/acceptance-task-payload.json`：派发 walking skeleton task 的 payload（Generator 产出）
- `sprints/w8-langgraph-v9/acceptance-evidence.md`：跑完后 evidence 汇总（Evaluator 产出）
- `docs/superpowers/reports/2026-05-08-w8-v9-langgraph-acceptance.md`：最终 acceptance 报告（包含 14→7 节点 graph_node_update 截 SQL、sub_task PR 链接、KR 进度变化、failure_reason 全空证据）
- `docs/learnings/cp-0509-w8-v9-langgraph-acceptance.md`：本轮关键 learning（如有未预期细节）

**不修改** packages/brain 任何代码、不修改 entrypoint.sh、不修改 graph 文件 — 本 sprint 是验收，不是开发。

## journey_type: autonomous
## journey_type_reason: 完全在 packages/brain 内（LangGraph harness-initiative full graph + PG checkpointer + callback router + dispatcher tick 都是 Brain 进程内/Brain 派的 docker sub_task），起点是 Brain dispatcher tick 拉 task；不涉及 apps/dashboard UI、不涉及 packages/engine hooks。sub_task 容器虽是远端 agent 形态但属于 Brain 自家 sub_task callback 闭环（不是 cecelia-run / bridge agent_remote 的远端协议），按"起点最靠前"取 tick → autonomous。
