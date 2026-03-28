# Learning: 启动每日AI内容生成调度引擎

## 根本原因

内容生成引擎所有 executor 模块已实现，但两个关键 gap 阻止其运行：
1. `topic_selection_log` 表未创建（迁移缺失），导致 7 日去重历史数据丢失
2. `content-pipeline.js` 路由虽已在 `server.js` 注册，但缺少手动触发端点 `POST /trigger-topics`

另一个教训：**改动前必须先看 server.js 路由注册**。错误地在 `routes.js` 添加了重复的 content-pipeline 注册，发现 server.js 已有相同注册后立即回滚，避免了重复注册问题。

## 下次预防

- [ ] 改 Brain routes 前先 `grep -n "app.use" packages/brain/server.js` 确认路由注册现状
- [ ] 新 scheduler 模块上线前检查 DB 是否有对应的 log 表（`\dt | grep log`）
- [ ] 探索代码库时同时查看 `server.js` 和 `routes.js`，server.js 是实际注册入口
