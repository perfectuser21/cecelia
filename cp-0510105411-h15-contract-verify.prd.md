# PRD: H15 — contract-verify.js 治本第一步

**日期**: 2026-05-10
**Sprint**: langgraph-contract-enforcement / Stage 2 MVP
**Brain task**: 02469652-6934-477b-b573-3b4c92b6572d

## 背景

8 days 12+ critical bug 同根因 — 把 docker `exit_code=0` 当节点 success，没主动验副作用。Anthropic 哲学说 evaluator 应**真跑应用看结果**；LangGraph 哲学说**节点输出 schema/副作用 validate 是用户责任**。H7-H14 是治标，H15 治本。

H10 fetchAndShowOriginFile + H13 git fetch checkout 都是 ad-hoc verify，分散且重复。本 PR 抽 SSOT helper。

## 目标

- 抽 `packages/brain/src/lib/contract-verify.js` 含 4 named export：
  - `ContractViolation`（class extends Error，含 details）
  - `verifyProposerOutput({ worktreePath, branch, sprintDir })`
  - `verifyGeneratorOutput({ pr_url })`
  - `verifyEvaluatorWorktree({ worktreePath, expectedFiles })`
- 接入 proposer 节点（`harness-gan.graph.js`）替换 H10 ad-hoc verify
- 接入 evaluator 节点（`harness-initiative.graph.js`）spawn evaluator 前 verify worktree 含 contract artifacts
- 失败 throw `ContractViolation` → LangGraph retryPolicy 自动 retry 3 次

## 范围

### 包含
- 新 module `packages/brain/src/lib/contract-verify.js`
- 接入 proposer 节点
- 接入 evaluator 节点
- 12 case vitest 单元测试（mock execFn / statFn 注入，不真跑 git/gh/fs）

### 不包含
- 不接入 generator 节点（留 H16）
- 不动 evaluator 跑 host brain 进程的根本架构（P2）
- 不动 W8 题目
- 不动 H7-H14 已合 PR 的其他逻辑

## 成功标准

- 12/12 vitest case PASS
- 3 ARTIFACT manual: 命令 PASS（contract-verify.js exist + proposer import + evaluator import）
- 既有 GAN/initiative 测试不破坏

## 风险

- 如果 evaluator/proposer 测试 mock 不全 → 真去 stat / exec → 测试不稳。**缓解**：所有 contract-verify call 通过 vi.mock 隔离。
