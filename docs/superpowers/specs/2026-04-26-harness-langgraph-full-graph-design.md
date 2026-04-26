# Harness Phase B/C 全程 LangGraph — 一个 graph 跑到底

**Sprint 1 / Brain Task `5616cc28-28c8-4896-b57e-ee9fcc413e86`**
**作者**: Claude /dev (autonomous)
**日期**: 2026-04-26
**Branch**: `cp-0426102619-harness-langgraph-refactor`

---

## 1. 目标

一个 LangGraph graph 从 Initiative POST 跑到 Phase C END。State 贯穿全程，PostgresSaver checkpoint 持久化。砍 Phase B/C 的 6 个 procedural module + 4 个 task_type。

## 2. 现状

Phase A 已是 LangGraph（C8a，2026-04-25 落地）：

```
START → prep → planner → parsePrd → ganLoop → dbUpsert → END
```

但 Phase B/C 仍是 procedural：

| Module | 行数 | 职责 |
|---|---:|---|
| `harness-task-dispatch.js` | 181 | Phase B: harness_task → 容器派 /harness-generator + 写 callback_queue + INSERT harness_ci_watch |
| `harness-watcher.js` | 353 | Phase B: 轮询 PR CI（30s 节流），CI pass→ harness_report，CI fail→ harness_fix |
| `harness-phase-advancer.js` | 108 | tick 内钩子：扫 initiative_runs，A→B→C 晋级、调度下一 runnable task |
| `harness-final-e2e.js` | 313 | Phase C: 起 staging 环境 + 跑 e2e_acceptance scenarios + 失败归因 |
| `harness-initiative-runner.js` 中的 `runPhaseCIfReady` 段 | ~270 | Phase C 编排层（查合同 → 跑 E2E → 推进 phase / 建 fix task） |
| `shepherd.js` 中 harness 分支 | 全文 | 对所有有 pr_url 的 task 通用，harness PR 也走它 → 与 harness-watcher 重复 CI 轮询 |
| `callback-processor.js` 第 67-71 行 isHarness 短路 | 5 | 防 harness_mode dev 被改 completed_no_pr |

**重复职责痛点**：harness-watcher 和 shepherd **都在轮询同一批 harness PR 的 CI**，shepherd 走 task.pr_url，watcher 走 harness_ci_watch.payload.pr_url，状态机错位（merge 责任不清）。这是 PRD 要求砍掉的根因。

## 3. 目标架构

### 3.1 顶层 graph（扩展 `harness-initiative.graph.js`）

```
START
 → prep（已有，幂等）
 → planner（已有）
 → parsePrd（已有）
 → ganLoop（已有，sub-graph）
 → dbUpsert（已有：写 initiative_contracts + initiative_runs + tasks）
 → fanout_sub_tasks（新建）
 → 每个 sub-task 执行 harness-task.graph.js sub-graph（新建）
 → join_sub_tasks（新建：等所有 sub-task END）
 → final_e2e（新建：内联 runFinalE2E + attributeFailures）
 → conditional: PASS → report_node, FAIL && fix_round<3 → fanout_fix_tasks → ... loop
                FAIL && fix_round>=3 → mark phase=failed → END
 → report_node（新建：写 harness-report，已 SKILL）
 → END
```

### 3.2 Sub-graph `harness-task.graph.js`（新文件）

```
START
 → spawn_generator（内联 triggerHarnessTaskDispatch 核心：executeInDocker + writeDockerCallback）
 → parse_callback（内联 parseDockerOutput + extractField → state.pr_url）
 → conditional: 无 pr_url → END status=no_pr
 → poll_ci（内联 harness-watcher 的核心：checkPrStatus，90s 间隔，max 30 min = 20 polls）
 → conditional: ci_pass → merge_pr → END status=merged
                ci_fail → fix_dispatch（state.fix_round++）
                  → conditional: fix_round<=3 → spawn_generator (loop)
                                 fix_round>3 → END status=failed
                ci_pending → poll_ci (loop, 内置 sleep)
                ci_timeout → END status=timeout
```

### 3.3 State schema

顶层 `InitiativeState`（扩展现有）：

```js
{
  // 已有
  task, initiativeId, worktreePath, githubToken,
  plannerOutput, taskPlan, prdContent, ganResult, result, error,

  // 新增
  sub_tasks: Annotation({ // [{id, title, depends_on, fix_round, pr_url, ci_status, status}]
    reducer: (curr, upd) => mergeBy(curr, upd, 'id'),
    default: () => [],
  }),
  final_e2e_verdict: Annotation({ default: () => null }), // 'PASS'|'FAIL'
  final_e2e_failed_scenarios: Annotation({ default: () => [] }),
  fix_round_global: Annotation({ default: () => 0 }), // Final E2E 级 fix round
  report_path: Annotation({ default: () => null }),
}
```

Sub-graph `TaskState`：

```js
{
  task,         // sub-task row
  worktreePath, githubToken, initiativeId, contractBranch,
  pr_url:        Annotation({ default: () => null }),
  pr_branch:     Annotation({ default: () => null }),
  fix_round:     Annotation({ default: () => 0 }),
  poll_count:    Annotation({ default: () => 0 }),
  ci_status:     Annotation({ default: () => 'pending' }), // pending|pass|fail|timeout|merged
  ci_fail_type:  Annotation({ default: () => null }),
  failed_checks: Annotation({ default: () => [] }),
  status:        Annotation({ default: () => 'queued' }),  // running|merged|no_pr|failed|timeout
  cost_usd:      Annotation({ reducer: (c, n) => (c||0)+(n||0), default: () => 0 }),
  error:         Annotation({ default: () => null }),
}
```

### 3.4 Checkpoint

- 顶层 thread_id = `harness-initiative:${initiativeId}:${attemptN}`
- Sub-graph thread_id = `harness-task:${initiativeId}:${subTaskId}:${fixRound}`
- 都走 `getPgCheckpointer()` singleton（C7 已有 migration 244）
- Brain 重启后 graph resume 从最后一个 checkpoint 续上：未完 sub-graph 不重 spawn（所有节点首句加幂等门）

### 3.5 Fanout 实现

LangGraph 的 `Send` API。`fanout_sub_tasks` 节点返回 `[Send('harness_task_subgraph', state) for each sub_task]`。LangGraph runtime 自动并行 + join。

但 sub-task 有 `depends_on` DAG 约束。第一阶段实现：扁平化 + 全部并行（Phase B 已有的 DAG 调度逻辑由 `harness-dag.nextRunnableTask` 提供，先在 fanout 之前用同步遍历分批，每批用 Send 并行）。LangGraph 不直接支持"动态 DAG 调度"，所以分层 fanout：

```
fanout_layer_1 → join_layer_1 → fanout_layer_2 → join_layer_2 → ... → final_e2e
```

层数=DAG 拓扑深度，由 `topologicalLayers(taskPlan.tasks)` 工具函数算（新建于 harness-dag.js）。

## 4. 砍掉清单

| 文件 | 处理 | 替换位置 |
|---|---|---|
| `packages/brain/src/harness-task-dispatch.js` | **删** | sub-graph `spawn_generator` node（保留 `buildGeneratorPrompt`/`extractWorkstreamIndex` 移入 `harness-utils.js`） |
| `packages/brain/src/harness-watcher.js` | **删** | sub-graph `poll_ci` node + `merge_pr` node（CI 轮询 + auto-merge），`processHarnessDeployWatchers` 一并砍（PRD 没要求保留 deploy 验证） |
| `packages/brain/src/harness-phase-advancer.js` | **删** | 顶层 graph 推进自身。`tick-runner.js` 删 import + 调用 |
| `packages/brain/src/harness-final-e2e.js` | **保留 5 工具函数**：`runScenarioCommand`/`bootstrapE2E`/`teardownE2E`/`normalizeAcceptance`/`attributeFailures`。**删 `runFinalE2E` 编排函数**（200 行，内联到顶层 graph `final_e2e` node） |
| `harness-initiative-runner.js` 中 `runPhaseCIfReady` + `createFixTask` + `checkAllTasksCompleted` | **删** | 顶层 graph 自己推进 `final_e2e` → `fanout_fix_tasks` |
| `shepherd.js` 中 harness 分支 | **shepherd 不动**（它服务于所有 dev PR），但 sub-graph 自管 harness PR merge → harness PR 不再被 shepherd 触发：在 `merge_pr` node 之后 set `tasks.pr_status='merged'`，shepherd 看到 `pr_status='merged'` 自然跳过；额外加一行 shepherd SQL filter `AND payload->>'harness_mode' IS DISTINCT FROM 'true'`，消除竞态 |
| `callback-processor.js` 第 67-71 行 | **保留**（5 行小补丁，移除会回归 P1 bug） |

executor.js 中：
- 删 `harness_task` 分支（line 2832-2840）：sub-graph 自管 spawn，executor 收到 harness_task 时 NO-OP，但保留 task_type 用于 dashboard 展示
- 删 `harness_planner` LangGraph 老路径（line 2847-2900）：v1 已被 v2 覆盖
- `harness_initiative` 分支保留，但内部只有一条路：走 `runWorkflow('harness-initiative', ...)`（HARNESS_INITIATIVE_RUNTIME=v2 即 default）。删 v1 fallback。

tick-runner.js：
- 删 0.15 块（`processHarnessCiWatchers` + `processHarnessDeployWatchers`）
- 删 1372-1378 块（`advanceHarnessInitiatives`）
- 0.14 PR shepherd 保留不动

### 4.1 task_type 删除（4 个）

| task_type | 当前用途 | 替换 |
|---|---|---|
| `harness_task` | Phase B Generator dispatch | sub-graph `spawn_generator` node |
| `harness_ci_watch` | Phase B CI 轮询 task | sub-graph `poll_ci` node |
| `harness_fix` | CI/E2E fail 后 Generator 重试 | sub-graph `fix_dispatch` node + state.fix_round |
| `harness_final_e2e` | Phase C E2E 编排 | 顶层 graph `final_e2e` node |

executor 收到这 4 种 task_type 时 → 标记 `pipeline_terminal_failure` + skip（避免老数据"复活"）。Migration 不删 task_type 列约束，CHECK 约束保留以免影响历史数据。

保留 4 个 task_type：`harness_initiative`（入口）、`harness_planner`（Phase A 内部）、`harness_contract_propose`、`harness_contract_review`（GAN 内部）。`harness_report` 保留（SKILL 单独跑，由顶层 graph `report_node` 派 task 触发）。

## 5. 失败回退

env flag `HARNESS_USE_FULL_GRAPH=false` 走老路（迁移期保留 1 周）。executor.js + tick-runner.js 入口处读 flag：
- `true`（default）→ 新顶层 graph
- `false` → 老 procedural（保留 import 不删）

迁移期满后下个 PR 删老路 + 删 4 个 task_type 的执行分支。

## 6. 测试

- **单测**: `packages/brain/src/workflows/__tests__/harness-task.graph.test.js`
  - happy path: spawn → ci_pass → merge → END
  - fix loop: spawn → ci_fail → fix → spawn (round 2) → ci_pass → merge → END
  - timeout: spawn → ci_pending × 21 polls → END timeout
  - no_pr: spawn → no pr_url → END
  - max fix rounds: spawn → ci_fail × 4 → END failed
- **单测**: `packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js`
  - 端到端 mock：planner mock → gan mock APPROVED → 2 sub_tasks fanout → 1 PR merged + 1 fix round=2 后 merged → final_e2e PASS → report → END
- **单测**: PostgresSaver resume mid-loop（Brain 重启 simulation）
- **集成测试**: `packages/brain/src/workflows/__tests__/harness-full-pipeline.integration.test.js` —— 真 PostgresSaver + mock executeInDocker + 真 DB（用 db.test pool）
- **grep 验证**: `grep -r 'harness-task-dispatch\|harness-watcher\|harness-phase-advancer\|runPhaseCIfReady\|createFixTask\|checkAllTasksCompleted' packages/brain/src --include='*.js'` 应无结果（除 deprecation comment + 测试文件）

## 7. 风险与决策

| 风险 | 缓解 |
|---|---|
| LangGraph Send API 不熟 / runtime bug | 写 minimal Send fanout 单测先验证；分层 fanout 替代复杂动态 DAG |
| `poll_ci` node sleep 阻塞 graph runtime | 用 LangGraph interrupt + 时间戳：节点立即 return，由 checkpointer 暂存 + 外部 trigger 续跑（与 harness-watcher tick 30s 节流等价）。第一版用同步 setTimeout（max 30 min 单 sub-task），观察资源占用决定是否改 interrupt |
| Brain 重启 graph resume 不续上 | 每节点首句加 `if (state.X_done) return {}` 幂等门；C7 已有 PgCheckpointer + migration 244 |
| 迁移期老数据残留 | env flag `HARNESS_USE_FULL_GRAPH=false` 兜底 + executor 4 task_type 收到时 skip + alert |
| shepherd 与 sub-graph 竞态 merge 同 PR | shepherd SQL 加 `payload->>'harness_mode' IS DISTINCT FROM 'true'` filter，harness PR 完全归 sub-graph 管 |

## 8. 工作量估计

- 新代码：~600 行（新 sub-graph + 新顶层节点 + 测试）
- 删旧代码：~1200 行
- 净减：~600 行
- 预估 2-3 天 /dev（PRD 给定）

## 9. 成功标准（DoD）

- [ARTIFACT] 新建 `packages/brain/src/workflows/harness-task.graph.js`（sub-graph）
- [ARTIFACT] `packages/brain/src/workflows/harness-initiative.graph.js` 扩展含 fanout_sub_tasks / join_sub_tasks / final_e2e / report 节点
- [ARTIFACT] 6 个老 module 至少 5 个被新代码替代（删除或留 deprecation comment）
- [BEHAVIOR] 单测：完整 graph 端到端 mock 跑通
- [BEHAVIOR] 单测：PostgresSaver resume thread_id 续上 mid-loop
- [BEHAVIOR] 集成测试：真 DB + mock executor → graph 端到端 → Initiative phase=done
- [BEHAVIOR] grep 验证 6 个老 module 被删或留 deprecation comment

PR title: `feat(brain): Phase B/C 进 LangGraph — 一个 graph 跑到底，砍 6 module + 4 task_type`
