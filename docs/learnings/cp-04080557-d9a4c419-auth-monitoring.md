---
branch: cp-04080557-d9a4c419-b56c-4a24-86b0-8ca609
task_id: d9a4c419-b56c-4a24-86b0-8ca60945acbc
date: 2026-04-08
---

# Learning: Express Router 挂载路径与子路由 path 重复陷阱

### 根本原因

PR #2058 在 `infra-status.js` 中注册了 `router.get('/credentials/health', ...)` 并在 `server.js` 将该 router 挂载到 `/api/brain/credentials`，导致实际 URL 变成 `/api/brain/credentials/credentials/health`（路径重复），期望的 `/api/brain/credentials/health` 返回 404。

Express Router 路由拼接规则：最终路径 = 挂载路径 + 子路径。当挂载路径已包含语义段时，子路径不应重复该段。

### 下次预防

- [ ] 新增 Express Router 路由时，检查 `app.use(mountPath, router)` + `router.get(subPath)` 拼接后的完整 URL
- [ ] 挂载到 `/api/brain/credentials` 的 router，其健康检查子路由应为 `/health`，不是 `/credentials/health`
- [ ] API 路由变更后应在本地 `curl` 验证一次，而不是仅依赖代码审查
