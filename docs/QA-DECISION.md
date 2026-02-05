# QA Decision: 执行状态实时展示

**Decision**: NO_RCI
**Priority**: P1
**RepoType**: Business

## Tests

| DoD Item | Method | Location |
|----------|--------|----------|
| GET /api/brain/cecelia/overview 返回正确格式 | auto | brain/src/__tests__/execution-status.test.js |
| GET /api/brain/dev/tasks 返回活跃任务 | auto | brain/src/__tests__/execution-status.test.js |
| GET /api/brain/dev/health 返回健康状态 | auto | brain/src/__tests__/execution-status.test.js |
| DevTasks 页面 5s 轮询 | manual | manual:截图验证前端 |
| CeceliaRuns 页面正常显示 | manual | manual:截图验证前端 |
| 不引入新测试失败 | auto | npx vitest run |

## RCI

**new**: []
**update**: []

## Reason

新增 API 端点连接已有的 executor 进程追踪 + PostgreSQL 任务数据，前端轮询优化。不涉及核心调度逻辑变更。

## Scope

**允许修改的范围**:
- `brain/src/routes.js` - 添加 cecelia/overview、dev/tasks、dev/health 端点
- `brain/src/__tests__/execution-status.test.js` - 新增 API 测试
- `frontend/src/features/core/execution/pages/DevTasks.tsx` - 轮询优化
- `frontend/src/features/core/execution/pages/CeceliaRuns.tsx` - 对齐 API 格式
- `frontend/src/features/core/execution/api/dev-tracker.api.ts` - API 路径修正
