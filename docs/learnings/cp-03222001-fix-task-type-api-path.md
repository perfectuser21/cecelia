# Learning: 修复 task-type-configs API 路径

**Branch**: cp-03222001-fix-task-type-api-path
**Date**: 2026-03-22

## 背景

新增 `/task-type-configs` 页面后访问报网络错误，数据加载失败。

### 根本原因

前端 fetch 路径写成了 `/api/brain/task-type-configs`，但 Brain 的 `cecelia-routes.js` 挂载在 `/api/cecelia`，正确路径是 `/api/cecelia/task-type-configs`。

## 下次预防

- [ ] 新增前端 API 调用前，先用 `curl` 确认后端实际路径（`/api/brain` vs `/api/cecelia`）
- [ ] 规则：`cecelia-routes.js` 中的路由 → `/api/cecelia/...`；其他模块单独 `app.use('/api/brain/...')` 挂载的 → `/api/brain/...`
