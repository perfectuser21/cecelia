# Learning: A2 — PR body 自动贴 PRD 链接

## 根本原因
用户看不到 PRD 不是因为 PRD 不存在（Brain 有 description、git 有 .task-*.md），而是因为**发现成本高**：散落在根目录、文件名是 UUID 时间戳、PR body 里没有指向链接。

## 修复
03-integrate.md §3.2 的 `gh pr create --body` 模板第一段注入两行链接。链接是运行时构造的——从 `.dev-mode.${BRANCH}` 读 task_id、从 `.task-${BRANCH}.md` 判存在。

## 下次预防
- [ ] 新增"用户可见入口"时，**跑一遍 user journey**：从 PR 点进来 → 看到什么？链接断了没？Dashboard 离线时 fallback 呢？
- [ ] 03-integrate.md 里的 PR body 模板是**所有 /dev PR 的 SSOT**——改它等于改所有后续 PR 的格式
