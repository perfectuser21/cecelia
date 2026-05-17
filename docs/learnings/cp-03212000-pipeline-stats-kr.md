## 本地 CI 镜像检查 + Pipeline 统计 + KR 进度回写（2026-03-21）

### 根本原因

1. GitHub Actions CI 触发问题：同一分支在短时间内多次 close/reopen PR 后，CI 不再触发 `pull_request` 事件。根因是 GitHub 对频繁操作的 PR 有某种事件去重机制。
2. Engine 版本冲突：并行开发时 main 上已有 13.10.0，需要 bump 到 13.11.0。cherry-pick 后必须检查版本冲突。
3. 旧 `.dod.md` 残留文件：main 上残留的 `.dod.md` 文件包含过时的版本检查条目，导致 DoD Gate 失败。

### 下次预防

- [ ] 避免对同一分支重复 close/reopen PR — 如果 CI 不触发，直接创建全新分支（新分支名）
- [ ] cherry-pick 前先 `git fetch origin main` 检查最新 Engine 版本号，避免版本冲突
- [ ] Task Card 中的 checkbox 在代码完成后必须标记为 `[x]`，否则 DoD Gate 会失败
