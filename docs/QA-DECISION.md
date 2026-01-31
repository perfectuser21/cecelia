---
id: qa-decision-command-center-v3
version: 1.0.0
created: 2026-01-31
updated: 2026-01-31
changelog:
  - 1.0.0: 初始版本
---

# QA Decision - Command Center 数据展示优化

## Decision Summary

```yaml
Decision: NO_RCI
Priority: P0
RepoType: Business
```

## Tests

| DoD Item | Method | Location |
|----------|--------|----------|
| 显示今日完成任务数 | auto | apps/core/features/panorama/__tests__/CommandCenter.test.tsx |
| 显示今日启动任务数 | auto | apps/core/features/panorama/__tests__/CommandCenter.test.tsx |
| 显示当前执行中的任务名称 | manual | manual:查看 /command 页面执行卡片 |
| 按 Project 分组显示 | auto | apps/core/features/panorama/__tests__/CommandCenter.test.tsx |
| 支持按状态筛选 | manual | manual:验证筛选按钮交互 |
| 支持按 Project 筛选 | auto | apps/core/features/panorama/__tests__/CommandCenter.test.tsx |
| 支持按优先级筛选 | auto | apps/core/features/panorama/__tests__/CommandCenter.test.tsx |
| 显示 O → KR → Task 层级结构 | manual | manual:查看 /command/okr 页面展开效果 |
| 显示进度条 | manual | manual:验证进度条 UI 显示 |
| 显示关联 Tasks 数量 | auto | apps/core/features/panorama/__tests__/CommandCenter.test.tsx |
| 显示完成率 | auto | apps/core/features/panorama/__tests__/CommandCenter.test.tsx |
| 数据每 10 秒自动刷新 | manual | manual:观察 Network 请求或 UI 更新 |

## RCI Impact

```yaml
new: []
update: []
```

## Reason

这是 UI 展示优化功能，主要涉及前端数据处理和展示逻辑的改进：
1. 前端计算今日统计（基于已有 tasks API 数据）
2. 优化 Tasks 列表分组和筛选功能
3. 完善 OKR 和 Projects 页面的数据展示

变更范围限于 `apps/core/features/panorama/` 前端组件，不涉及核心业务逻辑或 API 契约变更。

## Test Strategy

1. **Unit Tests**: 测试数据计算函数（今日统计、完成率等）
2. **Component Tests**: 测试筛选和分组功能
3. **Manual E2E**: 验证页面导航和交互效果
