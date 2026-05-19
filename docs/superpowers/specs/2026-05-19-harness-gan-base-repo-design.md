# Design: harness-gan.graph.js 支持外部 repo（baseRepo 透传）

**日期**: 2026-05-19  
**状态**: APPROVED

## 问题

`verifyProposerOutput`（`contract-verify.js` line 41）在校验 Proposer 是否推了合同分支时，默认读 `/Users/administrator/perfect21/cecelia` 的 origin remote URL。当 `base_repo` 指向 ZenithJoy 时，校验去查 Cecelia GitHub，导致 `ContractViolation: proposer_didnt_push`。

## 调用链

```
harness-initiative.graph.js
  → runGanContractGraph(opts)          ← 缺 baseRepo
    → createGanContractNodes(executor, ctx)  ← 缺 baseRepo
      → verifyProposer({..., baseRepo})       ← 调用时未传
        → verifyProposerOutput(opts)           ← 已支持 opts.baseRepo
```

## 变更范围

### 1. `harness-gan.graph.js` — runGanContractGraph

```js
// Before
const { taskId, initiativeId, sprintDir, prdContent,
        executor, worktreePath, githubToken,
        budgetCapUsd, checkpointer, readContractFile, fetchOriginFile, recursionLimit } = opts;

// After（加 baseRepo）
const { taskId, initiativeId, sprintDir, prdContent,
        executor, worktreePath, githubToken, baseRepo,
        budgetCapUsd, checkpointer, readContractFile, fetchOriginFile, recursionLimit } = opts;
```

### 2. `harness-gan.graph.js` — createGanContractNodes ctx

```js
// Before
const { taskId, initiativeId, sprintDir, worktreePath, githubToken, ... } = ctx;

// After（加 baseRepo）
const { taskId, initiativeId, sprintDir, worktreePath, githubToken, baseRepo, ... } = ctx;
```

### 3. `harness-gan.graph.js` — verifyProposer 调用（line 365）

```js
// Before
await verifyProposer({ worktreePath, branch: proposeBranch, sprintDir });

// After
await verifyProposer({ worktreePath, branch: proposeBranch, sprintDir, baseRepo });
```

### 4. `harness-initiative.graph.js` — 两处 runGanContractGraph 调用

**line ~196**：
```js
ganResult = await runGanContractGraph({
  ...,
  baseRepo: task.payload?.base_repo || undefined,
});
```

**line ~719**：
```js
const ganResult = await runGanContractGraph({
  ...,
  baseRepo: state.task?.payload?.base_repo || undefined,
});
```

## 不需改

- `contract-verify.js`：已有 `opts.baseRepo || DEFAULT_BASE_REPO` 兜底

## 测试策略

| 行为 | 测试类型 |
|------|----------|
| `baseRepo` 从 opts 透传到 `createGanContractNodes` | unit test |
| `verifyProposer` 调用时收到 `baseRepo` | unit test |
| initiative graph 两处调用透传 | unit test（`harness-initiative-gan-base-repo.test.js`）|
| smoke 源码断言 | smoke.sh |
