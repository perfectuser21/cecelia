---
branch: cp-04070900-cp-safe-lane-staging-routes
task_id: 46a98428-1990-4fbe-863f-463e552dc728
date: 2026-04-07
---

# Learning: Safe Lane staging 路由缺失导致高风险 PR 404

## 问题

deploy.yml Safe Lane 路径轮询 `GET /api/brain/deploy/staging/status` 和发送 `POST /api/brain/deploy/staging/cleanup`，但 ops.js 只有 production 路由，导致所有改动 thalamus/tick/ops 等核心文件的 PR 在 staging_deploy job 阶段直接 404 失败，无法完成 CD。

### 根本原因

deploy.yml 的 Safe Lane 设计（staging 缓冲层）在编写时超前于 Brain 侧实现：工作流假定路由已存在，但 ops.js 从未添加过这三个端点。

### 修复

在 ops.js 中添加：
1. `stagingDeployState` — 与 production `deployState` 隔离的 in-memory 状态
2. `POST /api/brain/deploy` 扩展 — 识别 `staging: true` 或 `mode: 'staging'`，走 staging 分支（调用 scripts/staging-deploy.sh，不存在时降级 PM2）
3. `GET /api/brain/deploy/staging/status` — 返回 stagingDeployState
4. `POST /api/brain/deploy/staging/cleanup` — 清理 PM2 brain-staging 实例，重置状态

### 下次预防

- [ ] 新增 CD workflow step 时，同步检查 Brain 路由是否已实现，避免 workflow 超前于后端
- [ ] ops.js 的 staging 路由应与 deploy.yml 的 staging_deploy job 一起提交（原子性）
- [ ] 添加 integration test：验证 POST /deploy?staging=true 返回 202 而非 404
