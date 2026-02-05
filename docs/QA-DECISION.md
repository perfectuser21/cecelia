# QA Decision: 执行状态实时展示组件

**Decision**: NO_RCI
**Priority**: P1
**RepoType**: Business

## Tests

| DoD Item | Method | Location |
|----------|--------|----------|
| SeatsStatus 显示每个运行中任务详情 | manual | manual:打开 SeatsStatus 页面验证 |
| 运行时长实时计时 | manual | manual:观察时长每秒递增 |
| 今日执行历史统计 | manual | manual:验证历史区域 |
| vps-slots API 返回任务详情 | auto | brain/src/__tests__/routes-vps-slots.test.js |
| 不引入新测试失败 | auto | npm test |

## RCI

**new**: []
**update**: []

## Reason

前端展示组件 + API 增强，不涉及核心业务逻辑。API 增强有自动测试覆盖，前端 UI 用手动验证。

## Scope

**允许修改的范围**:
- `frontend/src/features/core/brain/pages/SeatsStatus.tsx` - 添加执行详情面板
- `frontend/src/api/brain.api.ts` - 添加 API 方法
- `brain/src/routes.js` - 增强 vps-slots 端点 + 添加 active-executions 端点
