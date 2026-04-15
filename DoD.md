contract_branch: cp-harness-contract-ad3cd28b
workstream_index: 4
sprint_dir: sprints/harness-v7-docker-sandbox

## Feature 4: Harness Pipeline 健康监控端点（FR-007 / US-004）

- [x] [ARTIFACT] `packages/brain/src/routes/ops.js` 包含 `/harness/pipeline-health` GET 路由（含 DB 查询 + stuck 检测逻辑）
- [x] [BEHAVIOR] `GET /api/brain/harness/pipeline-health` 返回 HTTP 200 + JSON，响应包含 `pipelines` 数组（每个元素有 `pipeline_id`、`pipeline_stuck`、`last_activity`）和 `failure_rate` 汇总字段
- [x] [BEHAVIOR] 超过 6 小时无进展的 pipeline `pipeline_stuck = true`
- [x] [BEHAVIOR] 无活跃 pipeline 时端点返回空数组，不报错
- [x] [ARTIFACT] `packages/brain/src/server.js` 包含 pipeline-health 路由注册（非注释代码）

## Feature 5: Dashboard Harness 监控页面（FR-008 / US-004）

- [x] [ARTIFACT] Dashboard 路由已注册 harness 监控页面（非注释代码）
- [x] [ARTIFACT] 页面组件文件存在于 `apps/dashboard/src/` 目录下
- [x] [BEHAVIOR] 页面有实际 API 调用（fetch/useSWR/useQuery/axios）并对接 `pipeline-health` API
- [x] [BEHAVIOR] 卡住的 pipeline 有视觉区分（stuck/warning/error/red/danger 样式）
- [x] [BEHAVIOR] 无活跃 pipeline 时正常渲染空状态（条件渲染）
- [x] [BEHAVIOR] 组件含加载状态（loading）和错误状态（error）处理
