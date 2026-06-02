---
date: 2026-06-02
topic: harness-gan GitHub auth for private repos
status: approved
---

# Design: harness-gan verifyProposerOutput GitHub Token Auth

## 问题

`verifyProposerOutput`（`packages/brain/src/lib/contract-verify.js`）调用
`git ls-remote` 和 `git fetch` 时使用裸 HTTPS URL（无 token）。
对 private repo，Brain 容器内这两个命令 401 失败 → GAN 误判 proposer 没有
push 分支 → `proposer_repeatedly_didnt_push` abort。

## 变更

### 1. contract-verify.js

- `verifyProposerOutput` opts 加 `githubToken?: string` 参数
- 若有 token，将 `https://github.com/...` 替换为
  `https://x-access-token:TOKEN@github.com/...`，用于 ls-remote 和 git fetch
- 替换函数提取为局部 `injectToken(url, token)` 避免重复

### 2. harness-gan.graph.js

- 第 449 行 `verifyProposer(...)` 调用加 `githubToken`（ctx 作用域已有）

## 测试策略

- Unit（trivial）：`injectToken` 函数：有 token 注入、无 token 原样返回、
  已含 token 的 URL 不重复注入（幂等）
- Integration：`verifyProposerOutput` mock execFn 收到带 token 的 URL
- 无 E2E（需要真实 private repo，超出单测范围）

## 影响范围

只加参数，向后兼容（无 token 时行为不变）。
