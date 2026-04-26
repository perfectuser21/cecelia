# Design: Brain 派发的开发任务默认强制走 LangGraph

**日期**：2026-04-26
**Brain Task**：a2acd254-cd84-4262-8f6f-1bffb0574572
**分支**：cp-0426174704-flip-default-langgraph-flags
**接续**：PR #2640（Phase B/C 进 LangGraph — 投产 full graph 默认行为，但保留 env fallback gate）

---

## 一、问题陈述

PR #2640 已经把 `harness_initiative` 投产到 full graph 默认行为（`HARNESS_USE_FULL_GRAPH !== 'false'` 默认 true），但**留下了 env fallback gate 代码作为"1 周迁移期兜底"**。代码注释里多处写着"下一个 PR 删"。

当前 dev / harness_planner 派发还需手动设 env flag 才走 graph：

| Task | 当前默认 | 卡在哪 | 文件:行 |
|---|---|---|---|
| `harness_initiative` | ✅ full graph | — | executor.js:2799（默认 true，但 fallback 代码还在） |
| `dev` | ❌ legacy CLI bridge | 需 `WORKFLOW_RUNTIME=v2` | dispatcher.js:514 |
| `harness_planner` | ❌ 单步 Docker | 需 `HARNESS_LANGGRAPH_ENABLED=true` | executor.js:2899 |
| 4 个 retired type fallback | ❌ 兜底分支还在 | `HARNESS_USE_FULL_GRAPH=false` | executor.js:2828-2891 |

## 二、目标

让 `dev` / `harness_planner` / `harness_initiative` **无条件** 走 LangGraph，删掉所有 env fallback gate 代码。1 周迁移期已过，graph 投产稳定。

## 三、不做（明确边界）

- L1/L3 三层架构切完 — 单独立项
- Pipeline 注册协议（各 repo 注册自己的 graph）— 单独立项
- 单步任务（review/talk/research）接 graph — 无价值
- content-pipeline 搬回 Cecelia — 边界另议
- 删除 `harness-watcher.js` / `harness-phase-advancer.js` / `harness-initiative-runner.js` 这些 stub 文件 — 留给后续 cleanup PR

## 四、设计

### 4.1 改动单元（4 处）

**单元 A：`packages/brain/src/dispatcher.js:513-554`**
- 删 `if (process.env.WORKFLOW_RUNTIME !== 'v2') return { handled: false }`（line 514）
- `task_type === 'dev'` 时**无条件**走 `runWorkflow('dev-task', ...)`
- 保留 `task_type !== 'dev'` 的 short-circuit（不影响其他类型）

**单元 B：`packages/brain/src/executor.js:2797-2855`** — `harness_initiative` 路由
- 删 `useFullGraph` env 检查（line 2799）
- 删 `else` 兜底分支整段（line 2828-2854，含 `HARNESS_INITIATIVE_RUNTIME=v2` 中间层 + 老 procedural runner 调用）
- 主路径（compileHarnessFullGraph）保留

**单元 C：`packages/brain/src/executor.js:2857-2891`** — 4 个 retired task_type 兜底
- 删 `if (process.env.HARNESS_USE_FULL_GRAPH === 'false')` 整段（line 2865-2878）
- retired type 一律走 `pipeline_terminal_failure` 标记

**单元 D：`packages/brain/src/executor.js:2172-2180, 2899` + `packages/brain/src/harness-graph-runner.js:24-46`** — `harness_planner` 路由
- 删 executor.js `_isLangGraphEnabled()` 函数（line 2172-2180）
- 删 executor.js line 2899 的 `&& _isLangGraphEnabled()` 条件
- 删 harness-graph-runner.js `isLangGraphEnabled()` 函数（line 24-29）+ runHarnessPipeline 内的 skipped 路径（line 45-47）

### 4.2 测试更新（3 个修，3 个新）

**修改**：
- `packages/brain/src/__tests__/tick-workflow-runtime.test.js` — "v1 case 不派" 改为 "无 env 也派 v2"
- `packages/brain/src/__tests__/harness-graph.test.js` — 删 `returns { skipped: true } when HARNESS_LANGGRAPH_ENABLED is not set` 用例
- `packages/brain/src/__tests__/harness-graph-runner-default-executor.test.js` — 删前置 env 设置（默认就开）

**新增**（feat PR 必须有 *.test.js 文件变动）：
- `packages/brain/src/__tests__/dispatcher-default-graph.test.js` — 验证无 env flag 时 dispatcher 派 dev 走 v2
- `packages/brain/src/__tests__/executor-default-langgraph.test.js` — 验证无 env flag 时 executor 派 harness_planner 走 LangGraph Pipeline
- `packages/brain/src/__tests__/executor-harness-initiative-default-fullgraph.test.js` — 验证无 env flag 时 executor 派 harness_initiative 走 full graph

### 4.3 注释/文档清理
- `packages/brain/src/harness-final-e2e.js:151` 删"保留 1 周兜底"注释
- `packages/brain/src/workflows/harness-initiative.graph.js:259, 539` 同上
- `packages/brain/src/orchestrator/README.md:33,38` C7 标"已完成"

### 4.4 Brain 版本
- `packages/brain/package.json` + `package-lock.json` + `.brain-versions` + `DEFINITION.md` 同步 patch bump

## 五、数据流

**改动前**：
```
Brain task (dev)
  ↓
tick → dispatcher.dispatchNextTask()
  ↓
_dispatchViaWorkflowRuntime() — 无 env flag → handled:false
  ↓ fall through
triggerCeceliaRun() — legacy CLI bridge
```

**改动后**：
```
Brain task (dev)
  ↓
tick → dispatcher.dispatchNextTask()
  ↓
_dispatchViaWorkflowRuntime() — 无条件走
  ↓
runWorkflow('dev-task', taskId, attemptN, { task })
  ↓
LangGraph 节点（PgCheckpointer 落库 + cecelia_events trace）
```

## 六、错误处理 / 风险缓解

**风险 1**：删除 fallback 后，graph 路径发现未知 bug 无法降级。
**缓解**：
- `harness_initiative` full graph 已在生产稳定运行（Sprint 1 + #2646 fanout fallback 已修）
- `dev-task` graph workflow 已经在 v2 灰度过程中验证（commits 9b79e5677 / b2c04fa0a / e0ca85f2c）
- 整个改动是一个 PR，git revert 可整体回滚

**风险 2**：`harness_planner` 强制走 LangGraph Pipeline，但旧的"单步 Docker"路径可能被某些遗留代码间接调用。
**缓解**：
- 改动后 `harness_planner` 的所有派发都通过 `runHarnessPipeline`
- LangGraph Pipeline 内部仍用 spawn() 跑 Docker，与旧路径在容器层等价
- 单测覆盖路由行为（不验证 pipeline 内部细节）

## 七、测试策略

### 单测（CI 自动跑）
- 3 个新 test 文件覆盖 3 个 task_type 的"无 env 默认走 graph"行为
- 3 个老 test 文件更新 expected 行为

### 手动验证（PR 合并后真实测试）
- 注册一个 dev task，让 Brain 派发，确认 `cecelia_events` 表有 `langgraph_step` 事件
- 注册一个 harness_planner task，验证同上
- 查 `graph_checkpoints` 表确认 PgCheckpointer 落库

## 八、成功标准

1. **代码层**：grep `HARNESS_USE_FULL_GRAPH` / `HARNESS_LANGGRAPH_ENABLED` / `WORKFLOW_RUNTIME` 在 `packages/brain/src/` 下只能出现在 changelog/migration/test 注释里，所有运行时 env 检查全删
2. **行为层**：Brain 启动时不设任何 LangGraph env flag，`dev` 任务派发后能在 `cecelia_events` 表看到 `langgraph_step` 事件
3. **CI 层**：所有 brain CI（L1/L2/L3/L4）全绿
4. **回归层**：现有 brain 任务（harness_initiative full graph）行为不变

## 九、依赖与前置

- ✅ PR #2640 已合并（提供 full graph 主路径）
- ✅ orchestrator/graph-runtime.js 已存在（runWorkflow API）
- ✅ orchestrator/workflow-registry.js 已注册 dev-task / harness-initiative
- ✅ orchestrator/pg-checkpointer.js 已实装（断点续跑）

无新增依赖。
