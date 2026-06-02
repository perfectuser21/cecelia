---
date: 2026-06-02
topic: harness-gan contract file fallback
status: approved
---

# Design: harness-gan defaultReadContractFile 加 contract.md 兜底

## 问题

`defaultReadContractFile` 只查 `contract-draft.md` 和 `sprint-contract.md`。
Proposer agent 有时写 `contract.md`（文件存在但名称不符），导致 GAN 循环
永远找不到合同 → 无限重试 → 容器 OOM。

## 变更

**文件**：`packages/brain/src/workflows/harness-gan.graph.js`

candidates 数组加第三项：
```js
path.join(worktreePath, sprintDir, 'contract.md'),
```

优先级：`contract-draft.md` > `sprint-contract.md` > `contract.md`（兜底）

## 测试

新建 `packages/brain/src/workflows/__tests__/harness-gan-contract-fallback.test.js`，
覆盖三个场景：
1. `contract-draft.md` 存在 → 用它
2. 只有 `sprint-contract.md` → 用它
3. 只有 `contract.md` → 用它（新兜底）

## 影响范围

只改候选列表，读文件逻辑不变，向后兼容。
