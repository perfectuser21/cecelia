# Layer 2: Workflow Registry

**状态**: 占位骨架（P1）— 待 P3 实现
**对应 Spec**: [`docs/design/brain-orchestrator-v2.md`](../brain-orchestrator-v2.md) §6
**目标路径**（P3 实现时 `git mv` 到）: `packages/brain/src/workflows/README.md`
**归属**: Brain 三层架构的 Layer 2 (Orchestrator)

---

## 1. 目的

Brain 所有"多步骤任务"都是 **LangGraph 图**。单步任务也写成 1-node graph，保持入口统一。

这个目录是所有 workflow 的 **SSOT**：一个 workflow = 一个 `.graph.js` 文件。新 pipeline 接入 = "声明一个 graph 文件 + 在 task_router 加一条映射"，无需改 tick / executor / runner。

## 2. 目录结构（P3 完成后）

```
workflows/
├── index.js                    ← export { getWorkflow(name), listWorkflows() }
├── dev-task.graph.js           ← 普通 dev 任务（单 node graph）
├── harness-initiative.graph.js ← Planner → GAN → Phase B → Phase C
├── harness-gan.graph.js        ← subgraph: Proposer ↔ Reviewer 循环
├── harness-task.graph.js       ← subgraph: Generator → CI wait → merge
├── content-pipeline.graph.js   ← 6 步内容流水线
├── strategy-session.graph.js
└── __tests__/
    ├── resume.test.js          ← E2E: kill Brain + restart 后 graph 续跑
    └── *.graph.test.js
```

## 3. 约定

### 3.1 graph 文件模板

```js
import { StateGraph } from '@langchain/langgraph';
import { spawn } from '../spawn/spawn.js';
import { pgCheckpointer } from '../orchestrator/checkpointer.js';

export const harnessInitiativeGraph = new StateGraph({
  channels: { /* 显式 state schema */ }
})
  .addNode('planner', async (state) => {
    const result = await spawn({
      task: { id: state.initiativeId, task_type: 'harness_planner' },
      skill: '/harness-planner',
      prompt: buildPlannerPrompt(state),
      // 不传 env.CECELIA_CREDENTIALS — spawn middleware 自动选
    });
    return { prdContent: result.stdout };
  })
  .addNode('gan', ganSubgraph)
  .addEdge('planner', 'gan')
  .addConditionalEdges('gan', (state) =>
    state.verdict === 'APPROVED' ? 'phase_b' : 'gan'
  )
  .compile({ checkpointer: pgCheckpointer }); // 强制 checkpointer
```

### 3.2 运行入口

所有 graph 只能通过 `orchestrator/graph-runtime.js` 的 `runWorkflow(name, taskId, attemptN, input)` 启动。不允许在别处直接 `graph.invoke(...)`。

### 3.3 thread_id 语义

**`thread_id = ${taskId}:${attemptN}`**。见 Spec §6.3。

- 任务首次派发：`attempt_n = 1`，新 thread
- 任务 retry：caller 递增 `attempt_n`，**新 thread、新 checkpoint、从头跑**
- 同一 attempt Brain 崩溃重启：thread_id 不变，自动从最后 checkpoint resume

## 4. 硬规矩

- ✅ graph node **必须** 是 async I/O，禁止 sync 计算 > 50ms（大 JSON parse / regex / 密集循环要 `setImmediate` 让出 event loop）
- ✅ graph node **禁止** 直接调 `executeInDocker` 或任何 docker API——必须走 `spawn()`
- ✅ graph **必须** `.compile({ checkpointer: pgCheckpointer })`，不允许关闭 checkpointer
- ✅ 所有 conditional edge 必须用 `addConditionalEdges`——不允许在 node body 里 if/else 决定下一步
- ❌ 不允许在 graph 外保留状态（文件、全局变量、模块变量）——状态只进 `channels`

## 5. 回滚开关

P3 迁移期间加 env var `WORKFLOW_RUNTIME=v1|v2`：
- `v1`：走老的 `harness-initiative-runner.js` / `content-pipeline-graph-runner.js`
- `v2`：走 `runWorkflow(...)` + graph 文件

配合 task_type 白名单按 workflow 粒度灰度（先切 `dev-task` → `content-pipeline` → `harness-*`）。

P3 迁移**不用 harness 做**——搬的就是 harness runner 自己，走 `/dev` 手动推（见 Spec §8 P3）。

P3 合并即删老 runner，不做双跑兼容。
