# B42 — propose_branch Mismatch Tolerance 设计

**日期**: 2026-05-15  
**分支**: cp-0515215119-b42-propose-branch-mismatch-tolerance

## Goal

放宽 harness-gan.graph.js proposer 节点对 `propose_branch` 字段的严格匹配检查，并在 prompt 文本中注入字面量分支名，消除 LLM 自行计算分支名导致的 ContractViolation。

## 问题根因

LLM 在容器内执行时，prompt 中的 `${PROPOSE_BRANCH}` 被 LLM "展开"成自己计算的时间戳分支名（如 `cp-harness-propose-r1-05152044`），而不是 Brain 注入的确定性值（如 `cp-harness-propose-r1-ddf83bd4`）。

当前代码（line ~321）对不匹配严格抛 ContractViolation，导致整个 GAN pipeline 失败。

## Architecture

修改 `packages/brain/src/workflows/harness-gan.graph.js` 的两个位置：

### 修改点 1：放宽 mismatch check（line ~321-325）

**Before:**
```js
if (resultData.propose_branch !== computedBranch) {
  const err = new Error(`ContractViolation: propose_branch_mismatch — expected=${computedBranch} got=${resultData.propose_branch}`);
  err.code = 'propose_branch_mismatch';
  throw err;
}
const proposeBranch = computedBranch;
```

**After:**
```js
if (resultData.propose_branch !== computedBranch) {
  console.warn(`[harness-gan] propose_branch mismatch — expected=${computedBranch} got=${resultData.propose_branch}, accepting got value`);
}
const proposeBranch = resultData.propose_branch || computedBranch;
```

### 修改点 2：buildProposerPrompt 注入字面值（line ~138-155）

**Before:** 函数签名 `buildProposerPrompt(prdContent, feedback, round)`，prompt 里用 `${PROPOSE_BRANCH}` env var 占位符。

**After:** 函数签名 `buildProposerPrompt(prdContent, feedback, round, proposeBranch)`，在 prompt 文本里注入：
```
**重要**: PROPOSE_BRANCH="${proposeBranch}"（由 Brain 注入的确定性值，你必须使用此值作为分支名，不得修改）
```

**调用方**（proposer 节点 line ~289 附近）传入已计算的 `computedBranch`：
```js
const prompt = buildProposerPrompt(prdContent, feedback, nextRound, computedBranch);
```

## 测试策略

**单元测试**（`packages/brain/src/workflows/__tests__/harness-gan-b42.test.js`）：

1. **match 场景**：mock .brain-result.json 中 `propose_branch === computedBranch` → 不触发 warn，`proposeBranch` 等于该值
2. **mismatch 场景**：mock .brain-result.json 中 `propose_branch !== computedBranch` → 触发 `console.warn`，`proposeBranch` 等于 resultData 的值（不等于 computedBranch）
3. **buildProposerPrompt 字面值注入**：调用后 prompt 文本包含 `PROPOSE_BRANCH="cp-harness-propose-r1-abc12345"` 字面字符串

**分类**：这是单函数行为 + 跨节点的小 integration → unit test 足够。

## Data Flow

```
Brain computedBranch: cp-harness-propose-r{round}-{taskId.slice(0,8)}
      ↓ 注入为字面量
buildProposerPrompt(prdContent, feedback, round, computedBranch)
      ↓ prompt 含字面 PROPOSE_BRANCH="..."
LLM in Docker container
      ↓ 写 .brain-result.json { propose_branch: "..." }
proposer node reads resultData.propose_branch
      ↓ mismatch? → warn + accept; match? → accept
const proposeBranch = resultData.propose_branch || computedBranch
```

## Error Handling

- `resultData.propose_branch` 为空/null → fallback to `computedBranch`（不 warn，安静 fallback）
- mismatch → warn（可观测）但继续，不阻断 pipeline

## Scope

仅改 `harness-gan.graph.js`。不涉及 `harness-shared.js`、`harness-initiative.graph.js` 或测试之外的文件。
