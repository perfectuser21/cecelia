# cp-0508120000-lg-hotfix-ganloop-checkpointer

**日期**: 2026-05-08
**Branch**: cp-0508120000-lg-hotfix-ganloop-checkpointer
**触发**: W8 v6 acceptance task fail at ganLoop（部署 Layer 3 后第一次跑）

## 现象

W8 acceptance task v6（Layer 3 部署后首次实测）4 节点 prep → planner → parsePrd → ganLoop 后 fail，`error_message: "harness graph failed"`，brain log 无具体 GAN 错。

## 根本原因

Stream 2 (PR #2843) 把 `harness-gan.graph.js` 的 `|| MemorySaver()` fallback 改成 fail-fast `if (!checkpointer) throw`。这是正确的（生产环境 ghost task 防御）。

但**暴露了一个老 bug**：`harness-initiative.graph.js:636 runGanLoopNode` 调 `runGanContractGraph({checkpointer: opts.checkpointer})`，但 `opts.checkpointer` **永远是 undefined** —— LangGraph runtime 不会把父 graph 的 checkpointer 注入子节点 opts。

之前能跑（pre Stream 2）是因为 fallback MemorySaver；现在 fail-fast 立刻 throw。

## 修复

让 runGanLoopNode 自己 `await getPgCheckpointer()` 兜底：

```diff
+const checkpointer = opts.checkpointer || await getPgCheckpointer();
 const ganResult = await runGanContractGraph({
   ...,
-  checkpointer: opts.checkpointer,
+  checkpointer,
 });
```

## 下次预防

- [ ] **任何子 graph 调用都要自己拿 checkpointer**：LangGraph 父子 graph 的 checkpointer 不会自动传，必须显式
- [ ] **生产 fail-fast 改动必须扫一遍所有调用点**：Stream 2 fail-fast 是正确的，但忘记扫调用点（runGanLoopNode 一直靠 fallback 在跑）
- [ ] **W8 acceptance 早跑**：Layer 3 合后立刻跑 W8 才暴露这个，应该在 Stream 2 合的时候就跑一遍

## 关联

- Stream 2 PR #2843 — 加 fail-fast
- 本 hotfix — 修暴露的老 bug
- W8 acceptance Layer 4 — 等本 hotfix 合再继续
