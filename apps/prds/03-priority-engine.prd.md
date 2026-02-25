---
id: prd-priority-engine
version: 1.0.0
created: 2026-01-28
---

# PRD: 优先级引擎

## 目标
实现"今日焦点选择"逻辑，让 Brain 知道每天应该推进哪个 OKR。

## 依赖
- PRD 01: OKR 层级数据模型
- PRD 02: OKR Tree API

## 功能需求

### 1. 焦点选择算法

每天自动选择 1 个 Objective 作为焦点：

```javascript
function selectDailyFocus(objectives) {
  // 优先级规则：
  // 1. 手动置顶的 O（is_pinned = true）
  // 2. 优先级高的（P0 > P1 > P2）
  // 3. 进度接近完成的（80%+ 优先完成）
  // 4. 最近有活动的（updated_at 最近）

  return selectedObjective;
}
```

### 2. API 端点

#### GET /api/brain/focus
获取今日焦点
```json
{
  "focus": {
    "objective": { "id": "...", "title": "Cecelia Brain v1" },
    "key_results": [...],
    "suggested_tasks": [...]
  },
  "reason": "P0 优先级，进度 80%，接近完成"
}
```

#### POST /api/brain/focus/set
手动设置今日焦点（覆盖算法选择）
```json
{ "objective_id": "uuid" }
```

#### POST /api/brain/focus/clear
清除手动设置，恢复自动选择

### 3. 集成到 Decision Pack

在 `/api/brain/status` 中增加 `daily_focus` 字段：
```json
{
  "pack_version": "2.1.0",
  "daily_focus": {
    "objective_id": "...",
    "objective_title": "...",
    "key_results": [...],
    "reason": "..."
  }
}
```

## 验收标准
- [ ] 算法能自动选择合理的焦点
- [ ] 支持手动覆盖
- [ ] Decision Pack 包含焦点信息
