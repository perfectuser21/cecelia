---
branch: cp-03201354-content-pipeline-run-api
date: 2026-03-20
type: learning
---

# Learning: Content Pipeline Run API + 路由改西安

## 做了什么
为 Brain 的 content-pipeline 路由添加三个新 API 端点（run/stages/output），将 task-router 的 content-* 路由从 US 改到西安 Codex。

## 关键决策
- run API 采用 202 异步模式：立即返回，后台循环执行编排+执行
- stages API 通过 payload->>'parent_pipeline_id' 查询子任务
- output API 基于 keyword 构建图片 URL（slug 化）
- 路由改 xian：已验证西安 Codex + card-renderer.mjs 模板可生成一致质量卡片

## 根本原因
内容工厂 pipeline 的 tick 调度器已停（dispatch_enabled=null），导致前端创建的 pipeline 无法自动执行。需要手动触发机制绕过 tick。同时 executor 需要从本地执行改为远程派发到西安 Codex。

## 下次预防
- [ ] tick 调度器恢复后，run API 仍保留作为手动触发的备选
- [ ] 新增 API 端点时同步更新前端调用
- [ ] task-router 路由变更需要验证目标机器的依赖完整性
