# Learning: Brain 旧进程未重启导致新路由 404

## 根本原因

Brain 进程在 PR 合并前已启动（launchd），合并后代码更新到磁盘，但运行中的进程未重载。`launchctl stop/kickstart` 命令发送了信号但旧进程未响应（可能正在处理请求），导致 launchd 认为已重启但实际上旧进程继续持有端口 5221。

## 症状

- 新路由（`/analytics/content`、`/analytics/roi`）返回 404
- 旧路由（`/cortex/analyses`、`/attach-decision`）正常工作
- `routes.js` 中 `router.stack.push` 路由注册在代码层面正确
- Brain 任务 API 正常响应（旧进程能处理）

## 下次预防

- [ ] Brain 部署后必须用 `kill -TERM <pid>` 强制终止旧进程，让 launchd 启动新版本
- [ ] `brain-reload.sh` 的 launchd 模式需加 `kill -TERM` 确认旧进程已终止后再等待新进程
- [ ] 验证新路由时，先确认进程启动时间晚于 PR 合并时间：`ps -p $(lsof -ti:5221) -o lstart`
