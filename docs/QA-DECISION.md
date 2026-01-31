---
id: qa-decision-intent-enhancement
version: 1.0.0
created: 2026-01-31
updated: 2026-01-31
changelog:
  - 1.0.0: 初始版本
---

# QA Decision - Intent Enhancement

## Decision Summary

```yaml
Decision: NO_RCI
Priority: P1
RepoType: Engine
```

## Tests

| DoD Item | Method | Location |
|----------|--------|----------|
| 支持 6 种意图分类 | auto | apps/core/src/brain/__tests__/intent.test.js |
| 从自然语言中提取实体 | auto | apps/core/src/brain/__tests__/intent.test.js |
| API POST /api/brain/parse-intent | auto | apps/core/src/brain/__tests__/intent.test.js |
| API POST /api/brain/intent-to-tasks | auto | apps/core/src/brain/__tests__/intent.test.js |
| 单元测试覆盖 3+ 场景 | auto | apps/core/src/brain/__tests__/intent.test.js |

## RCI Impact

```yaml
new: []
update: []
```

## Reason

这是 Brain 模块的内部增强，不影响现有 RCI 契约。功能是对现有 `intent.js` 的改进：
1. 增强关键词+短语模式匹配
2. 添加实体提取能力
3. 暴露 API 端点

变更范围限于 `apps/core/src/brain/` 目录，不涉及业务功能的回归契约。

## Test Strategy

1. **Unit Tests**: 测试意图分类和实体提取
2. **API Tests**: 测试端点响应格式
3. **No E2E**: 内部 API，无前端界面
