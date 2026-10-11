---
task_id: 142c9ad0-2150-4f03-978c-3dd30ab32ed1
step: intent
upstream: []
---
# 金丝雀6：Brain 修复 /api/brain/runs/<stats|stages|output|publish-status> 被内容流水线通配路由接走返回 500

## 背景

server.js 里 app.use('/api/brain', contentPipelineRoutes) 挂在 /api/brain/runs 读路由之前，content-pipeline 的 /:id/stats、/:id/stages、/:id/output、/:id/publish-status 通配会把 /api/brain/runs/stats 等请求接走，id='runs' 不是 uuid 时直接 500 并把 PG 错误回显给调用方（金丝雀5 裁判 r2 J-1 发现，存量）。金丝雀6：修挂载/匹配让这些路径不再被内容流水线吃掉，且内容流水线对非 uuid id 返回 400/404 而非 500。

### I-1
GET /api/brain/runs/stats、/api/brain/runs/stages、/api/brain/runs/output、/api/brain/runs/publish-status 不再返回 500，也不再由内容流水线处理：由 runs 读路由按 run_id 处理（不存在则 404，body 有可读 error）

### I-2
内容流水线 /api/brain/pipelines/:id/stats 等子路径对非 uuid 的 id 返回 400 或 404，body 不含 PostgreSQL 原始错误文本（如 invalid input syntax）

### I-3
内容流水线对合法 uuid 的原有行为不变：/api/brain/pipelines/<存在的id>/stats 等照旧返回 200

### I-4
/api/brain/content-types 等内容流水线在 /api/brain 下的非 :id 路由照旧可用

### I-5
GET /api/brain/runs/:run_id（含冒号 run_id，如 coding-workflow:<uuid>）及 ?include=spans 行为不变
