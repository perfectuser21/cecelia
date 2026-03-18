# Learning: Brain Content Pipeline API 路由

**Branch**: cp-03190000-content-pipeline-api
**Date**: 2026-03-19

## 实现摘要

新增 `packages/brain/src/routes/content-pipeline.js`，提供 Dashboard 所需的 3 个 HTTP 端点：
- `GET /api/brain/content-types` — 列出 YAML 注册表中所有内容类型
- `GET /api/brain/pipelines` — 列出 content-pipeline 任务（分页，默认 50 条）
- `POST /api/brain/pipelines` — 创建新 content-pipeline 任务（keyword + content_type 必填，priority 可选）

在 `packages/brain/server.js` 注册两个路径前缀：`/api/brain/pipelines` 和 `/api/brain`（使 `/api/brain/content-types` 生效）。

### 根本原因

content-pipeline-orchestrator.js 已完整对接 tick.js / task-router.js / executor.js，但缺少 HTTP 入口，导致 Dashboard 无法触发或查询 Pipeline。

### 关键决策

1. **路由复用**：router.get('/content-types') 直接复用 `listContentTypes()` 已有函数，避免重复读取 YAML
2. **priority 校验**：在路由层做 P0/P1/P2 校验，防止非法值写入 DB（DB 有 CHECK 约束，早失败比晚失败好）
3. **content_type 验证**：POST 时调用 `listContentTypes()` 做存在性检查，保证数据完整性
4. **测试 mock 策略**：同时 mock `db.js` 和 `content-type-registry.js`，隔离 DB 和文件系统依赖

### 下次预防

- [ ] Express router 注册顺序敏感：`/api/brain/pipelines` 必须在 `app.use('/api/brain', brainRoutes)` 之前，否则 `GET /api/brain/pipelines` 会被 brainRoutes 捕获
- [ ] server.js 双路径注册（`/api/brain/pipelines` + `/api/brain`）是为了让子路径 `/content-types` 能在 `/api/brain/content-types` 下访问
- [ ] 测试文件 mock 路径必须与 import 路径完全一致（`'../db.js'` 不能写成 `'../db'`）
