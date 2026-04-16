# PRD — cp-04131520-langgraph-harness

## 背景

当前 harness 路由（`packages/brain/src/routes/execution.js` + `harness-watcher.js`）
是手写的状态机：Layer 1 → 2a → 2b → 3a → 3c → 4。callback_queue + harness routing
分散在多个文件，跨任务回调链路修了无数 bug 仍不稳定。

LangGraph 是 LangChain 开源的 workflow 引擎，原生 PostgresSaver checkpointing，
能完美替代我们手写的 callback_queue + harness routing。

## 目标

引入 `@langchain/langgraph` + `@langchain/langgraph-checkpoint-postgres`，
建立一个**与现有手写 harness 路由并行存在**的 LangGraph 骨架管线，
用 `HARNESS_LANGGRAPH_ENABLED` 开关控制启用。

本 PR 只交付**骨架**：节点函数为 placeholder（`return state`），
不真正调 docker-executor。等 Phase 1 agent 完成 docker-executor 后再接入。

## 范围

### 新增

- `packages/brain/src/harness-graph.js` — LangGraph StateGraph 定义（6 节点）
- `packages/brain/src/harness-graph-runner.js` — `runHarnessPipeline(task)` 入口
- `packages/brain/src/__tests__/harness-graph.test.js` — 用 mock data step through 6 节点

### 不动

- `packages/brain/src/routes/execution.js` 老路径完全保留
- `packages/brain/src/harness-watcher.js`
- docker-executor（Phase 1 agent 做）

## 成功标准

骨架 harness pipeline 在测试中能 step through 6 个节点（planner → proposer →
reviewer → generator → evaluator → report），用 mock data 验证 conditional edge
分支正确（reviewer REVISION 回到 proposer，evaluator FAIL 回到 generator）。

## 假设与边界

- LangGraph 节点函数本 PR 只 return state（不调 docker，不写 DB）
- PostgresSaver 在 runner 中按需启用，测试用 MemorySaver 避免 PG 依赖
- `HARNESS_LANGGRAPH_ENABLED` 环境变量未设置时默认 false（不影响线上）
- 不实现 evaluator agent（由后续 PR 接入）

## 受影响文件

- `packages/brain/package.json`（新增 2 个 dependency）
- `packages/brain/package-lock.json`（lockfile 更新）
- `packages/brain/src/harness-graph.js`（新建）
- `packages/brain/src/harness-graph-runner.js`（新建）
- `packages/brain/src/__tests__/harness-graph.test.js`（新建）

## 参考

- LangGraph JS docs: https://langchain-ai.github.io/langgraphjs/
- PostgresSaver: https://langchain-ai.github.io/langgraphjs/reference/classes/checkpoint_postgres.PostgresSaver.html
