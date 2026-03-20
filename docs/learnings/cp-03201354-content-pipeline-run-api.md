---
branch: cp-03201354-content-pipeline-run-api
date: 2026-03-20
type: learning
---

# Learning: Content Pipeline Run API + 路由改西安

## 做了什么
为 Brain 的 content-pipeline 路由添加三个新 API 端点，支持手动触发执行、查询子任务进度、查询产出物。同时将 task-router 的 content-* 路由从 US 改到西安 Codex。

## 关键决策
- run API 采用 202 异步模式：立即返回，后台循环执行编排+执行
- stages API 通过 payload->>'parent_pipeline_id' 查询子任务
- output API 基于 keyword 构建图片 URL（slug 化）
- 路由改 xian：已验证西安 Codex + card-renderer.mjs 模板可生成一致质量卡片
