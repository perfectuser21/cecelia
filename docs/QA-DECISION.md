---
id: qa-decision-blocks-api
version: 1.0.0
created: 2026-02-04
prd: .prd-blocks-api.md
---

# QA Decision

**Decision**: NO_RCI
**Priority**: P1
**RepoType**: Engine

## Tests

| DoD Item | Method | Location |
|----------|--------|----------|
| GET /api/blocks/:parentType/:parentId 返回正确数据 | auto | brain/src/__tests__/blocks.test.js |
| POST /api/blocks 创建 block 成功 | auto | brain/src/__tests__/blocks.test.js |
| PUT /api/blocks/:id 更新 block 成功 | auto | brain/src/__tests__/blocks.test.js |
| DELETE /api/blocks/:id 删除 block 成功 | auto | brain/src/__tests__/blocks.test.js |
| PUT /api/blocks/reorder 批量重排序成功 | auto | brain/src/__tests__/blocks.test.js |
| 参数校验（缺少必填字段返回 400） | auto | brain/src/__tests__/blocks.test.js |

## RCI

**new**: []
**update**: []

## Reason

这是新增的 API 功能，不涉及现有功能回归。使用单元测试覆盖所有 CRUD 操作即可。

## Scope

**允许修改的范围**：
- `brain/src/routes.js` - 添加 blocks API 路由
- `brain/src/__tests__/blocks.test.js` - 新增测试文件
- `docs/` - 文档更新

**禁止修改的区域**：
- `brain/src/tick.js` - Tick 循环逻辑
- `brain/src/executor.js` - 任务执行器
- `brain/src/decision.js` - 决策逻辑
- 其他现有 API 端点
