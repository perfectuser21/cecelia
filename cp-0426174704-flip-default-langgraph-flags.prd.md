# PRD: Brain 派发的开发任务默认强制走 LangGraph

## 背景
当前 Brain 派发 `dev` / `harness_planner` / `harness_initiative` 时，需要手动设 env flag（`WORKFLOW_RUNTIME=v2` / `HARNESS_LANGGRAPH_ENABLED=true` / `HARNESS_USE_FULL_GRAPH=true`）才走 LangGraph，**默认走 procedural 老路**。导致用户视角"任务跑着跑着不走 graph"。

代码注释里多处写着 "保留 1 周作 X=false 兜底；下一个 PR 删"（dispatcher.js:514、executor.js:2797-2828、harness-final-e2e.js:151、harness-initiative.graph.js:259），**本 PR 就是那个"下一个 PR"**。

## 目标
让所有"开发类 task"（dev / harness_planner / harness_initiative）默认强制走 LangGraph，**删掉所有 procedural fallback 老路代码**，让 graph 成为唯一执行路径。

## 范围 — 改/删清单

### 一、改默认行为（5 处）

| 文件 | 行 | 改动 |
|---|---|---|
| `packages/brain/src/dispatcher.js` | 513-554 | 删 `WORKFLOW_RUNTIME !== 'v2'` 的 short-circuit；`task_type=dev` 时**无条件**走 `runWorkflow('dev-task', ...)` |
| `packages/brain/src/executor.js` | 2797-2855 | 删 `HARNESS_USE_FULL_GRAPH=false` 整段 fallback（含 `HARNESS_INITIATIVE_RUNTIME=v2` 中间层、`harness-initiative-runner.js` 老 procedural runner 调用）；`harness_initiative` 无条件走 full graph |
| `packages/brain/src/executor.js` | 2860-2891 | 删 4 个 retired task_type 的 `HARNESS_USE_FULL_GRAPH=false` 兜底分支；retired type 一律 `pipeline_terminal_failure` |
| `packages/brain/src/executor.js` | 2172-2180, 2899 | 删 `_isLangGraphEnabled()` 函数及其调用；`harness_planner` 无条件走 LangGraph Pipeline |
| `packages/brain/src/harness-graph-runner.js` | 22-46 | 删 `isLangGraphEnabled()` + `runHarnessPipeline` 内的 `if (!isLangGraphEnabled()) return { skipped: true }` |

### 二、删文件（如确认无人调用）

| 文件 | 理由 |
|---|---|
| `packages/brain/src/harness-phase-advancer.js` | 自述"兜底空实现，让 HARNESS_USE_FULL_GRAPH=false 老路依旧可 import" |
| `packages/brain/src/harness-watcher.js` | 同上，标记文件 + 兜底空实现 |
| `packages/brain/src/harness-initiative-runner.js` | 老 procedural runner，被 executor.js:2849 fallback 调用，删 fallback 后无引用 |

> **注意**：删前必须 `grep -r "from.*harness-phase-advancer"` 等确认无外部 import；如有则同步清

### 三、清理注释/文档残留

- `packages/brain/src/harness-final-e2e.js:151` 删"保留 1 周兜底"注释段
- `packages/brain/src/workflows/harness-initiative.graph.js:259, 539` 同上
- `packages/brain/src/orchestrator/README.md:33,38` C7 一项标"已完成"

### 四、测试更新

| 文件 | 改动 |
|---|---|
| `packages/brain/src/__tests__/tick-workflow-runtime.test.js` | "v1 case 不派 v2 workflow" 测试改为 "无 env 也强制走 v2 workflow" |
| `packages/brain/src/__tests__/harness-graph.test.js` | 删 `returns { skipped: true } when HARNESS_LANGGRAPH_ENABLED is not set` 用例 |
| `packages/brain/src/__tests__/harness-graph-runner-default-executor.test.js` | 删 `process.env.HARNESS_LANGGRAPH_ENABLED = 'true'` 这种前置 env 设置（默认就开） |

### 五、新增测试（feat PR 必须）

| 文件 | 验证 |
|---|---|
| `packages/brain/src/__tests__/dispatcher-default-graph.test.js` | 无任何 env flag 时，`_dispatchViaWorkflowRuntime({task_type:'dev'})` 返回 `handled:true, runtime:'v2'` |
| `packages/brain/src/__tests__/executor-default-langgraph.test.js` | 无任何 env flag 时，`harness_planner` 任务路由到 `runHarnessPipeline`（用 mock 验证调用） |
| `packages/brain/src/__tests__/executor-harness-initiative-default-fullgraph.test.js` | 无任何 env flag 时，`harness_initiative` 任务路由到 `compileHarnessFullGraph().invoke()` |

## 不做
- L1/L3 三层架构切完（Scheduler 从 tick.js 分离 + spawn middleware 完成对接）— 单独立项
- Pipeline 注册协议（各 repo 注册自己的 graph）— 单独立项
- 单步任务（review/talk/research）接 graph — 无价值
- content-pipeline 搬回 Cecelia — 边界另议
- 删除 `harness-watcher.js` / `harness-phase-advancer.js` / `harness-initiative-runner.js` 这些 stub 文件 — 留给后续 cleanup PR（本 PR 只 flip default + 删 fallback gate 代码）

## 成功标准

1. **代码层**：grep `HARNESS_USE_FULL_GRAPH` / `HARNESS_LANGGRAPH_ENABLED` / `WORKFLOW_RUNTIME` 在 `packages/brain/src/` 下**只能出现在 changelog/migration 注释里**，所有运行时 env 检查全删
2. **行为层**：Brain 启动时不设任何 LangGraph 相关 env flag，注册一个 `dev` 任务，`tick.js` 派发后能在 `graph_checkpoints` / `cecelia_events` 表看到 graph 节点状态
3. **CI 层**：所有 brain CI（L1/L2/L3/L4）全绿
4. **回归层**：现有 brain 任务（harness_initiative full graph）行为不变（行为面已是默认 graph）

## DoD

- [ ] [ARTIFACT] `dispatcher.js` 删除 WORKFLOW_RUNTIME 检查 / Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/dispatcher.js','utf8');if(c.match(/WORKFLOW_RUNTIME[^=]*!==/))process.exit(1)"`
- [ ] [ARTIFACT] `executor.js` 删除 HARNESS_LANGGRAPH_ENABLED 运行时检查 / Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(c.includes('HARNESS_LANGGRAPH_ENABLED'))process.exit(1)"`
- [ ] [ARTIFACT] `executor.js` 删除 HARNESS_USE_FULL_GRAPH fallback 分支 / Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(c.includes('HARNESS_USE_FULL_GRAPH'))process.exit(1)"`
- [ ] [ARTIFACT] `harness-graph-runner.js` 删除 isLangGraphEnabled gate / Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-graph-runner.js','utf8');if(c.includes('isLangGraphEnabled'))process.exit(1)"`
- [ ] [BEHAVIOR] 无 env flag 时 dispatcher 派 dev 任务走 v2 workflow runtime / Test: `packages/brain/src/__tests__/dispatcher-default-graph.test.js`
- [ ] [BEHAVIOR] 无 env flag 时 executor 派 harness_planner 走 LangGraph Pipeline / Test: `packages/brain/src/__tests__/executor-default-langgraph.test.js`
- [ ] [BEHAVIOR] 无 env flag 时 executor 派 harness_initiative 走 full graph / Test: `packages/brain/src/__tests__/executor-harness-initiative-default-fullgraph.test.js`

## 风险与缓解
- **风险**：删除 `HARNESS_USE_FULL_GRAPH=false` 兜底后，若 graph 路径有未发现 bug，无 fallback 可降级
- **缓解**：依赖 `harness_initiative` full graph 已在生产稳定运行的事实（Sprint 1 + #2646 fanout fallback 已修）；CI 全绿是合并门槛
- **缓解**：保留 git revert 能力（一个 PR 可整体回滚）
