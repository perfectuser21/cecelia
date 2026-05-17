# Phase C3 — harness-gan 搬家到 workflows/ Learning

## 做了什么
软搬家：cp `packages/brain/src/harness-gan-graph.js` (438 行) → `packages/brain/src/workflows/harness-gan.graph.js`，原位置留 10 行 `export * from './workflows/harness-gan.graph.js'` shim。老 caller（harness-initiative-runner.js + __tests__/harness-gan-graph.test.js）import 路径不变，零破坏。

## 根本原因
Phase C 目标把 L2 workflow 集中到 `workflows/` 子树。harness-gan 是被 harness-initiative 内部调的 subgraph（非 dispatch 入口），所以不注册到 workflow-registry，纯代码位置迁移 + shim 兼容。

## 下次预防
- [ ] file move 用 re-export shim（单行 `export * from './new/path.js'`）是 ESM 软搬家最干净的模式，caller 零感知
- [ ] 搬家前必须 grep 全仓所有 caller path，确认 shim 能转发所有 named export
- [ ] top-level 只能含 `const` / `import`（无 side effect）才能安全走 `export *` shim

## 关键决策
**保留 MemorySaver fallback**：原 harness-gan runGanContractGraph `if(!checkpointer) checkpointer = new MemorySaver()` 保留。spec §6 要求 pg-checkpointer 单例禁 MemorySaver，但本 PR 纯代码移动不改逻辑，MemorySaver 清除留 C6 tick 接线 + C7 清老 runner 时统一做。
