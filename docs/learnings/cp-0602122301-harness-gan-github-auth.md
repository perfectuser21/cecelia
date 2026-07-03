## harness-gan verifyProposerOutput private repo auth（2026-06-02）

### 根本原因

`verifyProposerOutput` 调用 `git ls-remote` 和 `git fetch` 时使用裸 HTTPS URL（无 token）。Brain 容器内对 private repo 这两个命令会 401 失败，导致 GAN 误判 "proposer 未 push 分支" → `proposer_repeatedly_didnt_push` abort。

根本上是 harness pipeline 原本只为 cecelia（public/已配 credential）设计，跨 repo 支持时缺少 auth 传递。

### 下次预防

- [ ] `injectToken(url, token)` helper 已加入 `contract-verify.js`，新的 `ls-remote`/`fetch` 会自动注入 token
- [ ] harness pipeline 对非 cecelia 的 private repo 需要确认 `githubToken` 从 state 传到每个 git 操作
- [ ] 下次遇到 "proposer_repeatedly_didnt_push" 错误，先检查 `git ls-remote` 是否有 auth 问题，而不是假设 proposer 没有产出
