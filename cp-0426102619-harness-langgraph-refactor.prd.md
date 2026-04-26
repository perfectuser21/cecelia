# Sprint 1 PRD — Harness Initiative 全程 LangGraph

## 目标
一个 LangGraph graph 从 Initiative POST 跑到 Phase C END，state 贯穿全程，PostgresSaver checkpoint 持久化。砍掉 Phase B/C 的 8 个 procedural module。

## graph 结构
扩展 `packages/brain/src/workflows/harness-initiative.graph.js`：

```
START
  ↓
  Node planner (复用 Phase A 已存)
  ↓
  Sub-graph gan_loop (复用 harness-gan.graph.js)
  ↓
  Node persist_contract (写 initiative_contracts，已存)
  ↓
  Node fanout_sub_tasks (新建)
    ├─ 计算 sub_task DAG
    └─ Send API parallel dispatch per sub-task
  ↓
  Sub-graph harness-task.graph.js (per sub-task, 新建)
    ├─ Node spawn_generator (executeInDocker, 复用)
    ├─ Node parse_callback (parseDockerOutput, 复用)
    ├─ Node poll_ci (gh pr checks, 90s 间隔，max 30 min)
    ├─ Conditional: ci_pass → merge_pr → END
    │              ci_fail → fix_dispatch (eval_round++) → spawn_generator (loop, max 3)
    │              ci_timeout → END status=failed
    └─ END sub-task
  ↓
  Node join_sub_tasks (等所有 sub-graph 结束)
  ↓
  Node final_e2e (复用 harness-final-e2e.js 纯函数)
  ↓
  Node report (写 harness-report，已 SKILL)
  ↓
END
```

## State schema (LangGraph Annotation)
```ts
{
  initiative_id: string
  prd_content: string
  worktree_path: string
  contract: {branch, version, status, content}
  sub_tasks: [{id, title, depends_on, status, pr_url, ci_status, fix_round, container_id}]
  final_e2e: {status, report_md}
  budget_usd: number
  emit_events: [...] (Annotation reducer 累加)
}
```
thread_id = `${initiativeId}:${attemptN}`，PostgresSaver 自动持久化。Brain 重启 graph resume 续上。

## 砍掉（Phase B/C procedural）
1. `packages/brain/src/harness-task-dispatch.js` — 内联到 sub-graph spawn_generator node
2. `packages/brain/src/harness-watcher.js` — 内联到 poll_ci node
3. `packages/brain/src/harness-phase-advancer.js` — graph state 自己推进
4. `packages/brain/src/shepherd.js` 中 harness 分支 — graph merge_pr node 内做
5. `packages/brain/src/callback-worker.js` 中 harness 分支 — graph parse_callback node 内做
6. `packages/brain/src/harness-final-e2e.js` 编排层 — 内联到 final_e2e node

保留 5 个工具函数: parseDockerOutput / extractField / checkPrStatus / executeMerge / runScenarioCommand

## task_type 删除 4 个
- harness_task （由 sub-graph 内部状态承载）
- harness_ci_watch（由 poll_ci node 承载）
- harness_fix（由 fix_dispatch node 承载）
- harness_final_e2e（由 final_e2e node 承载）

保留 3 个: harness_initiative（入口）、harness_planner、harness_contract_propose/review（GAN graph 内部）

## 复用（不动）
- Phase A graph (`harness-gan.graph.js` + `harness-initiative.graph.js` Phase A 部分) ✅
- LangGraph + PostgresSaver ✅
- /dev skill 链路 (sub-graph spawn 时调用) ✅
- 11 PR 修的 Brain 稳定性代码（gh CLI, 状态机, quarantine, schema, timeout, lock, callback, env protocol）

## 成功标准
- [ARTIFACT] 新建 `packages/brain/src/workflows/harness-task.graph.js`（sub-graph）
- [ARTIFACT] `packages/brain/src/workflows/harness-initiative.graph.js` 扩展含 fanout_sub_tasks / join_sub_tasks / final_e2e / report 节点
- [ARTIFACT] 6 个老 module 至少 5 个被新代码替代（harness-task-dispatch, harness-watcher, harness-phase-advancer, harness-final-e2e 编排层, harness 相关 dispatch 路径）
- [BEHAVIOR] 单元测试: 完整 graph 端到端 mock 跑通（Planner → GAN approved → 2 sub-tasks → 1 PR merged 1 PR fix_round=2 后 merged → Final E2E pass → END）
- [BEHAVIOR] 单元测试: Brain 重启后 PostgresSaver resume thread_id 续上 mid-loop
- [BEHAVIOR] 集成测试: POST 一个真 PRD → graph 端到端跑完 → Initiative phase=done
- [BEHAVIOR] grep 验证 6 个老 module 被删或留 deprecation comment

## PR 标题
`feat(brain): Phase B/C 进 LangGraph — 一个 graph 跑到底，砍 6 module + 4 task_type`

## 工作量
~600-800 行新代码 + 删 ~1500 行老代码。预估 2-3 天 /dev。

## 约束
- 必须本地 /dev (Brain 核心代码)
- harness_mode=false
- 大改动需多个 commit + 充分测试覆盖
- 失败回退方案: env flag HARNESS_USE_FULL_GRAPH=false 走老路（迁移期保留 1 周）
