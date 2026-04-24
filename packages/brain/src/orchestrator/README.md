# Brain v2 L2 Orchestrator

**位置**：Brain v2 三层架构中间层 L2（L1 Scheduler → L2 Orchestrator → L3 Executor）。
**spec**：`docs/design/brain-orchestrator-v2.md` §6。

## 模块

| 文件 | 责任 |
|---|---|
| `graph-runtime.js` | `runWorkflow(workflowName, taskId, attemptN, input?)` 统一入口；thread_id 格式强制 `{taskId}:{attemptN}`；has-thread 预检 resume/fresh 分流 |
| `pg-checkpointer.js` | `PostgresSaver` 进程单例工厂；所有 workflow 共用（禁 MemorySaver）|
| `workflow-registry.js` | `registerWorkflow / getWorkflow / listWorkflows`；空启动，C2+ 填充 |

## 使用

```js
import { runWorkflow } from './orchestrator/graph-runtime.js';
import { registerWorkflow } from './orchestrator/workflow-registry.js';
import { myGraph } from './workflows/my-flow.graph.js';

// 启动时注册一次（Phase C2 起 workflows/index.js 集中注册）
registerWorkflow('my-flow', myGraph);

// tick 分派
await runWorkflow('my-flow', task.id, task.attempt_n ?? 1, task);
```

## Phase C 路线图

| Phase | 本目录变化 |
|---|---|
| **C1（本 PR）** | 建 3 个模块 + 测试，不接线任何调用方 |
| C2 | 新 `workflows/dev-task.graph.js`；tick.js 加 `WORKFLOW_RUNTIME=v2` 灰度 |
| C3 | 搬 `harness-gan-graph.js` → `workflows/harness-gan.graph.js` subgraph |
| C4 | 搬 `harness-initiative-runner.js` → `workflows/harness-initiative.graph.js`（组合 C3 subgraph）|
| C5 | 搬 `content-pipeline-graph.js` → `workflows/content-pipeline.graph.js` |
| C6 | tick.js 瘦身到 ≤ 200 行，路由表 `taskTypeToWorkflow` |
| C7 | 清老 runner + 清 WORKFLOW_RUNTIME flag |

## 硬约束（spec §6，每 PR 必守）

- **thread_id = `{taskId}:{attemptN}`**：retry 递增 attemptN 开新 thread，不复用老 checkpoint
- **PgCheckpointer 单例**：所有 graph 共用；禁 MemorySaver（C2 起 CI grep 守门）
- **graph node 内禁同步 >50ms**：只允许 `spawn()` / 异步 DB / 轻 transform；禁 `execSync` / 大 JSON.parse / 同步 IO
- **每 Phase 末崩溃重启 resume 验证**（spec §6.5）：C2 起每次合前必跑

## 调用链

```
tick.js (L1 Scheduler)
  ↓ selectNextDispatchableTask → task
  ↓ runWorkflow(workflowName, task.id, attemptN, task).catch(logError)   ← fire-and-forget
  ↓
graph-runtime.runWorkflow
  ├─ getWorkflow(name)           ← workflow-registry
  ├─ checkpointerHasThread()     ← pg-checkpointer
  └─ graph.invoke(input, config) ← LangGraph compiled graph
      ↓ node-1 → node-2 → ...
      ↓ spawn(opts)  ← L3 Executor（packages/brain/src/spawn/）
      ↓ runDocker → agent
```

## 测试

`__tests__/graph-runtime.test.js` 覆盖：
1. thread_id 格式正确（taskId + attemptN 拼接）
2. 非法参数 throws（空 taskId / attemptN 非正整数）
3. 未注册 workflow 抛 `workflow not found`
4. has-checkpoint 时传 null（resume），无时传 input（fresh）

Mock 策略：`vi.mock('@langchain/langgraph-checkpoint-postgres')` 返回 stub `PostgresSaver.fromConnString`；每个 it 前 `_clearRegistryForTests()` + `_resetPgCheckpointerForTests()`。
