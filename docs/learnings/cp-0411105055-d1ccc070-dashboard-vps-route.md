# Learning: Dashboard vps-monitor 路由依赖 apps/api 导致 VPS 面板空白

## 根本原因

`LiveMonitorPage` 调用 `/api/v1/vps-monitor/stats|services|hk-stats`，这些请求经 vite proxy 转发到 `apps/api`（port 5211）。但 apps/api 在生产/dev 环境中并非始终运行，导致 US VPS 统计和 HK VPS 面板在演示时显示 "—"。

Brain 已经在 `/api/brain/vps-monitor/` 挂载了相同功能的路由，且 Brain（5221）始终运行，但：
1. Brain 的 `vps-monitor.js` 缺少 `/hk-stats` 端点
2. Dashboard 没有使用 Brain 路由，而是依赖 apps/api

## 下次预防

- [ ] Dashboard 的 API 路径选型：优先使用 `/api/brain/...`（Brain 始终运行），避免依赖 `/api/v1/...`（apps/api 按需启动）
- [ ] 添加新路由时同步检查 Brain 和 apps/api 是否都有对应端点
- [ ] VPS monitor 类端点迁移到 Brain 是正确方向（减少 apps/api 依赖）
