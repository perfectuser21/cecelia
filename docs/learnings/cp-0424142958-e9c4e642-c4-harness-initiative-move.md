# Phase C4 — harness-initiative-runner 搬家 Learning

## 做了什么
软搬家：cp `packages/brain/src/harness-initiative-runner.js` (525 行) → `workflows/harness-initiative.graph.js`。新文件的 relative import 路径从 `./xxx.js` 更新为 `../xxx.js`（回上一级），import `./harness-gan-graph.js` 改为 `./harness-gan.graph.js`（直连 C3 新位置不走 shim）。原 harness-initiative-runner.js 变 10 行 re-export shim 兼容 caller（executor.js / harness-phase-advancer.js / harness-final-e2e.js）。

## 根本原因
Phase C 目标把 L2 workflow 集中到 `workflows/`。harness-initiative-runner 含 `runInitiative`（阶段 A 入口）+ `runPhaseCIfReady`（阶段 C 推进器）+ 辅助 helper，是被 executor.js dispatch 的主 runner。软搬家模式零 caller 改动。

## 下次预防
- [ ] 跨目录 file move 要改所有 relative import（./X → ../X 或反之）；grep `^import.*from '\\./'` 全文确认
- [ ] 模块迁移过程中 C3 的 shim 暂不删（caller harness-initiative-runner 本身变 shim 后通过 shim 链依赖，删 C3 shim 会破坏）；统一 C7 清

## 关键决策
**直连 C3 新位置**：harness-initiative.graph.js 内 `runGanContractGraph` import 指向 `./harness-gan.graph.js`（同目录，直连），不走 `../harness-gan-graph.js` (C3 shim)。未来 C7 删 C3 shim 时此 PR 的 import 不需改（已是新路径）。
