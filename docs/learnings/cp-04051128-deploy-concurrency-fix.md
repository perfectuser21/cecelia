---
branch: cp-04052028-69a12042-2ae2-4233-93ec-0dc013
date: 2026-04-06
task: 修复 deploy 并发冲突 — ops.js 互斥锁 + deploy.yml concurrency group
---

# Learning: deploy 并发冲突修复

### 根本原因

deploy webhook 端点缺乏幂等保护：当 GitHub Actions 并发触发多个 deploy job 时，每个 job 都能成功调用 POST /api/brain/deploy，导致多个 pm2 restart / git checkout 并发执行，互相竞争文件系统和进程，造成部署失败或状态混乱。

两个层次都需要保护：
1. **应用层**（ops.js）：运行时状态检查，防止同一进程内并发
2. **CI 层**（deploy.yml）：GitHub Actions concurrency group，防止多个 workflow run 并发执行 deploy job

### 下次预防

- [ ] 新增任何触发外部操作的 POST 端点时，先检查是否需要幂等/并发保护
- [ ] deploy/rollback 等长时间异步操作必须有 in-memory 状态锁，running 时拒绝重复请求（409）
- [ ] GitHub Actions 中涉及部署的 job 必须加 `concurrency.group`，`cancel-in-progress: false` 确保已在运行的不被取消
- [ ] rolling_back 状态同样需要锁定，防止回滚期间触发新的 deploy
