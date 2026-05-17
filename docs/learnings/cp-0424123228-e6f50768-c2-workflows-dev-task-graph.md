# Phase C2 — workflows/dev-task.graph.js Learning

## 做了什么
建 Brain v2 L2 Orchestrator 第二块砖：`packages/brain/src/workflows/` 新子树，首个真实 `.graph.js` (dev-task.graph.js 1-node graph 调 L3 spawn) + `workflows/index.js` 集中注册入口 initializeWorkflows() + server.js 启动时调 initializeWorkflows（tick loop 之前）。新 3 组单测（dev-task graph 结构/runAgentNode/compile + index.js initializeWorkflows 幂等）。

## 根本原因
Phase C1 只建空注册表骨架。C2 填充第一个 workflow 作参考模板：state annotation / 1-node graph / pg-checkpointer 编译 / 集中注册。Phase C3/C4/C5 搬 harness-gan / harness-initiative / content-pipeline 时抄此结构。

## 下次预防
- [ ] `vi.mock('./module.js', () => ({...}))` factory 不能引用 top-level 变量（hoisting 冲突）；用 `vi.hoisted(() => ({...}))` 提前定义
- [ ] server.js 启动流程加 workflow init 包 try/catch 不阻塞启动（Brain 生命周期关键）
- [ ] `.graph.js` 约定：StateGraph + Annotation.Root + compile({ checkpointer })，禁 MemorySaver（spec §6）

## 关键决策
**C2 scope 缩小不接 tick**：原 Plan 建议 tick.js 加 `WORKFLOW_RUNTIME=v2` flag 灰度接线。实施时发现 tick.js 不直接分派 task_type=dev，走 executor.js 复杂路径。动 executor.js 主 dispatch 风险过高（本 turn 已 10 PR）。改为 C2 只建 workflows/ 目录 + 注册机制，tick 接线留 **Phase C6 tick 瘦身大 PR** 统一做。

**工期换确定性**：spec §6.5 要求崩溃 resume E2E 测试。本 PR 不跑真 kill Brain 的 E2E（需要 full Brain 环境）。留 C6 接线后的 manual smoke script 做。本 PR 只做单元级 mock 验证（C1 已覆盖 has-checkpoint 分流）。
