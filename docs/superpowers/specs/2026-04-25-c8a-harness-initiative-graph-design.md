# Brain v2 C8a — harness-initiative 真图重设计 Design Spec

**日期**：2026-04-25
**Brain task**：`e4d08a28-3dc4-42b0-b25e-3c8e8ef939f2`
**worktree**：`/Users/administrator/worktrees/cecelia/c8a-harness-initiative-graph`
**分支**：`cp-0425180840-c8a-harness-initiative-graph`
**上游 PRD**：`docs/design/brain-v2-c8-d-e-handoff.md` §3

---

## 1. Goal

把阶段 A `runInitiative` 从 528 行单 function 改造成 LangGraph 多节点状态机。每节点之间靠 PostgresSaver checkpointer 持久化，Brain 重启时**不再重跑 Planner/GAN**，而是从最近完成的节点之后续跑。

成功定义：`HARNESS_INITIATIVE_RUNTIME=v2` 起任务 → 跑到 GAN 第 N 轮 → kill Brain → restart → 续跑节点而不重 spawn 已完成节点的容器。

---

## 2. 当前状态（事实）

| 文件 | 行数 | 说明 |
|---|---|---|
| `packages/brain/src/workflows/harness-initiative.graph.js` | 528 | 真实 runner（名带 .graph.js 但内容是单 function） |
| `packages/brain/src/harness-initiative-runner.js` | 12 | shim，`export * from './workflows/harness-initiative.graph.js'` |
| `packages/brain/src/workflows/dev-task.graph.js` | 60 | C2 真图模板（参照对象） |
| `packages/brain/src/workflows/index.js` | 42 | `initializeWorkflows()` 当前只注册 dev-task |
| `packages/brain/src/orchestrator/workflow-registry.js` | 50 | `registerWorkflow / getWorkflow` API |
| `packages/brain/src/executor.js` L2807-L2829 | — | 当前直调 `runInitiative(task, { checkpointer })` |

**legacy `runInitiative` 真实拓扑**（`workflows/harness-initiative.graph.js` L64-L252）：

1. **prep** — `ensureHarnessWorktree` + `resolveGitHubToken`（L106-L107）
2. **planner spawn** — `spawn({ task_type:'harness_planner', ... })`（L116-L128）⚠️ replay 风险点
3. **parse + read PRD** — `parseTaskPlan(plannerOutput)` + 读 `sprints/sprint-prd.md`（L150, L165-L170）
4. **GAN spawn 循环** — `runGanContractGraph({ checkpointer })`（L174-L184）⚠️ replay 风险点（已部分有 checkpointer）
5. **DB 单事务** — `BEGIN` → `upsertTaskPlan` → `INSERT initiative_contracts` → `INSERT initiative_runs` → `COMMIT`（L191-L229）

**phase C** 函数（`runPhaseCIfReady`、`checkAllTasksCompleted`、`createFixTask`）独立路径 — 由 tick/executor 直接调，**不进 graph**，C8a **保留原状**。

---

## 3. 选定方案：Approach A — 6 节点真图 + GAN wrapper

### 3.1 节点拓扑

```
START → prep → planner → parsePrd → ganLoop → dbUpsert → END
                  ↓        ↓          ↓          ↓
                error → END error → END (条件 edge)
```

5 业务节点 + END，满足 DoD `addNode ≥ 5`。

### 3.2 State 定义

```js
export const InitiativeState = Annotation.Root({
  task:           Annotation({ reducer: (_o,n)=>n, default:()=>null }),
  initiativeId:   Annotation({ reducer: (_o,n)=>n, default:()=>null }),
  worktreePath:   Annotation({ reducer: (_o,n)=>n, default:()=>null }),
  githubToken:    Annotation({ reducer: (_o,n)=>n, default:()=>null }),
  plannerOutput:  Annotation({ reducer: (_o,n)=>n, default:()=>null }),
  taskPlan:       Annotation({ reducer: (_o,n)=>n, default:()=>null }),
  prdContent:     Annotation({ reducer: (_o,n)=>n, default:()=>null }),
  ganResult:      Annotation({ reducer: (_o,n)=>n, default:()=>null }),
  result:         Annotation({ reducer: (_o,n)=>n, default:()=>null }),
  error:          Annotation({ reducer: (_o,n)=>n, default:()=>null }),
});
```

每个 reducer 用 replace（与 dev-task.graph.js 同款）。

### 3.3 节点契约

| 节点 | 幂等门（首句检查） | 主体 | 错误返回 |
|---|---|---|---|
| `prepInitiative` | `if (state.worktreePath) return { worktreePath: state.worktreePath }` | `ensureHarnessWorktree` + `resolveGitHubToken` | `{ error: { node:'prep', message } }` |
| `runPlanner` | `if (state.plannerOutput) return { plannerOutput: state.plannerOutput }` | spawn `harness_planner` + `parseDockerOutput` | `{ error: { node:'planner', message } }` |
| `parsePrd` | `if (state.taskPlan && state.prdContent) return ...` | `parseTaskPlan` + 读 `sprints/sprint-prd.md` | `{ error: { node:'parsePrd', message } }` |
| `runGanLoop` | `if (state.ganResult) return { ganResult: state.ganResult }` | wrapper 调 `runGanContractGraph(...)` | `{ error: { node:'gan', message } }` |
| `dbUpsert` | `if (state.result?.contractId) return { result: state.result }` | `BEGIN` → `upsertTaskPlan` → `INSERT initiative_contracts/runs` → `COMMIT` | `{ error: { node:'dbUpsert', message } }` |

**幂等门是 C8a 核心创新**（C6 smoke 教训：LangGraph resume 会 replay 上次未完成节点 → 重新 spawn → 起重复容器）。

### 3.4 Conditional edges（错误短路到 END）

```js
function stateHasError(state) { return state.error ? 'error' : 'ok'; }

graph
  .addEdge(START, 'prep')
  .addConditionalEdges('prep', stateHasError, { error: END, ok: 'planner' })
  .addConditionalEdges('planner', stateHasError, { error: END, ok: 'parsePrd' })
  .addConditionalEdges('parsePrd', stateHasError, { error: END, ok: 'ganLoop' })
  .addConditionalEdges('ganLoop', stateHasError, { error: END, ok: 'dbUpsert' })
  .addEdge('dbUpsert', END);
```

### 3.5 GAN 仍走 wrapper

`runGanLoopNode` 内部调 `runGanContractGraph(...)`（已有自己的 PostgresSaver，C7 已统一走单例）。**不引入 LangGraph `addSubgraph`**（无现成例子，风险高）。GAN 自身保留独立 thread_id，C8a 父图 thread_id 与 GAN 子流程 thread_id 解耦。

### 3.6 legacy 兼容策略

**`workflows/harness-initiative.graph.js` 同时保留两份代码**：
1. **legacy** `export async function runInitiative(task, opts)` — 528 行原代码不动
2. **graph** — 新增 `InitiativeState`、5 节点、`buildHarnessInitiativeGraph`、`compileHarnessInitiativeGraph`、`runInitiativeViaGraph` wrapper

**phase C** 函数（`runPhaseCIfReady` / `checkAllTasksCompleted` / `createFixTask`）保留原位，不动。

文件预计行数：原 528 + 新增节点+graph builder ≈ 250 → **~780 行**。
> 文件偏大但 C8a 不处理文件大小（D 阶段 D2-D∞ 才把 phase C 拆出去）。

### 3.7 executor.js 接线（env gate）

`packages/brain/src/executor.js` L2807 分支首部插入：

```js
if (task.task_type === 'harness_initiative') {
  if (process.env.HARNESS_INITIATIVE_RUNTIME === 'v2') {
    console.log(`[executor] 路由决策: task_type=${task.task_type} → v2 graph runWorkflow`);
    const { runWorkflow } = await import('./orchestrator/graph-runtime.js');
    return await runWorkflow('harness-initiative', task.id, 1, { task });
  }
  // ↓ 原 legacy 路径完整保留
  console.log(`[executor] 路由决策: task_type=${task.task_type} → Harness v2 Initiative Runner (阶段 A)`);
  let checkpointer;
  try { /* ... */ } catch { /* ... */ }
  const { runInitiative } = await import('./harness-initiative-runner.js');
  return await runInitiative(task, { checkpointer });
}
```

env flag **独立**于 `WORKFLOW_RUNTIME=v2`（C6 给 dev 用），让 dev / harness 灰度分别推进。

### 3.8 workflows/index.js 注册

```js
import { compileHarnessInitiativeGraph } from './harness-initiative.graph.js';

export async function initializeWorkflows() {
  if (_initialized) return;
  // ... 现有 dev-task 逻辑
  const devTaskGraph = await compileDevTaskGraph();
  registerWorkflow('dev-task', devTaskGraph);

  // 新增
  const harnessInitiativeGraph = await compileHarnessInitiativeGraph();
  registerWorkflow('harness-initiative', harnessInitiativeGraph);

  _initialized = true;
}
```

幂等 try/getWorkflow 检查需扩展到检查 `harness-initiative`（避免热重载二次注册抛 `workflow already registered`）。

---

## 4. 测试

新建 `packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js`，参照 `dev-task-graph.test.js` 模板：

| 测试 | 覆盖 |
|---|---|
| `buildHarnessInitiativeGraph` 结构 | `compile()` 不抛 |
| `prepInitiativeNode` 调依赖 | mock `ensureHarnessWorktree` + `resolveGitHubToken` |
| `prepInitiativeNode` 幂等门 | 二次调（state.worktreePath 已存在）→ 不再调 mock |
| `runPlannerNode` 调 spawn 传正确 opts | mock spawn 验 `task_type:harness_planner` + `HARNESS_NODE:planner` |
| `runPlannerNode` 幂等门 | state.plannerOutput 已存在 → 不调 spawn |
| `runPlannerNode` 错误路径 | spawn 抛 → state.error.node==='planner' |
| `parsePrdNode` happy + 失败 | parseTaskPlan 抛 → state.error |
| `runGanLoopNode` 调 wrapper | mock runGanContractGraph |
| `runGanLoopNode` 幂等门 | state.ganResult 已存在 → 不调 wrapper |
| `dbUpsertNode` BEGIN/COMMIT | mock pg client 验事务 |
| `dbUpsertNode` 幂等门 | state.result.contractId 已存在 → 不调 client |
| `compileHarnessInitiativeGraph` 用 pg checkpointer | mock pg-checkpointer + 不抛 |

GAN 子图本身**不重测**（已有 `harness-gan` 自己的测试）。

**Manual smoke**（人工验证 checkpoint resume，不进 CI）：
1. `HARNESS_INITIATIVE_RUNTIME=v2 docker compose restart node-brain`
2. POST `/api/brain/tasks` 起 harness_initiative 任务
3. 等 GAN 第 1 轮 spawn 起 → `docker kill cecelia-node-brain`
4. `bash scripts/brain-deploy.sh` 重启
5. 验：`SELECT thread_id, COUNT(*) FROM checkpoints GROUP BY 1` 有 thread `<task.id>:1` + 多行
6. 续跑日志显示 `跳过 spawn (state.plannerOutput 已存在)` 字样

---

## 5. DoD（PR 合并门禁）

- [x] `[BEHAVIOR]` `harness-initiative.graph.js` 含 `StateGraph` + ≥ 5 `.addNode()` ；Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');const n=(c.match(/addNode/g)||[]).length;if(n<5||!c.includes('StateGraph'))process.exit(1)"`
- [x] `[BEHAVIOR]` `workflows/index.js` 注册 `harness-initiative`；Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/index.js','utf8');if(!/registerWorkflow\\(\\s*['\"]harness-initiative['\"]/.test(c))process.exit(1)"`
- [x] `[BEHAVIOR]` `executor.js` 含 `HARNESS_INITIATIVE_RUNTIME` env gate；Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes('HARNESS_INITIATIVE_RUNTIME'))process.exit(1)"`
- [x] `[BEHAVIOR]` 节点单测全 pass；Test: `tests/workflows/harness-initiative-graph.test.js`
- [x] `[ARTIFACT]` 新建 `harness-initiative-graph.test.js`；Test: `manual:node -e "require('fs').accessSync('packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js')"`

---

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 528 行 legacy 内含多个 try/catch / edge case，节点拆分时漏逻辑 | 每节点严格映射 1 段 try/catch；测试覆盖 happy + error；保留 legacy `runInitiative` 不动 → 灰度可回滚 |
| spawn 幂等门写漏 → 容器重复创建烧资源 | 每节点首句模板化加幂等门；单测明确覆盖"二次调不重 spawn" |
| `workflows/index.js` 注册时 `getWorkflow('dev-task')` try/catch 模式只检查 dev-task，C8a 注册逻辑可能跳过新 workflow | 改成两个 workflow 都检查或改用 `listWorkflows()` 含 'harness-initiative' 判断 |
| `runGanContractGraph` 自身 checkpoint 与父图 checkpoint 双层 → thread_id 名称空间冲突 | 父图传给 GAN 的 task.id 加 `:gan` 前缀，让 GAN 内部 thread_id 与父图区隔 |
| 测试用 vi.mock pg client 复杂（client.query / client.connect / client.release） | 完全参照 dev-task-graph.test.js 的 mock 模板 + getPgCheckpointer mock |

---

## 7. Out of scope

- **不动** `runPhaseCIfReady`（phase C 推进器）
- **不动** `harness-initiative-runner.js` shim
- **不引入** LangGraph `addSubgraph`（保留 GAN wrapper）
- **不重测** GAN 子流程（harness-gan 已自测）
- **不缩**文件总行数（D 阶段处理）
- **不动** schema 244 表（pg checkpointer 已建好）

---

## 8. PR 拆分

**单 PR**（handoff §3 建议 1 PR）：

- `packages/brain/src/workflows/harness-initiative.graph.js`：新增 ~250 行（State + 5 节点 + builder + compile + runInitiativeViaGraph wrapper），不动 528 行 legacy + phase C 函数
- `packages/brain/src/workflows/index.js`：新增 4 行（import + register + 幂等检查扩展）
- `packages/brain/src/executor.js`：新增 ~6 行（env gate 分支）
- `packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js`：新建 ~250 行（12 测）
- `docs/learnings/cp-0425180840-c8a-harness-initiative-graph.md`：新建 Learning（含根本原因 + 下次预防 checklist）

预估：~510 行 added，0 行 deleted。
