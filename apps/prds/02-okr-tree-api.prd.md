---
id: prd-okr-tree-api
version: 1.0.0
created: 2026-01-28
---

# PRD: OKR Tree CRUD API

## 目标
提供完整的 OKR Tree 管理 API，支持创建、查询、更新、删除整棵 OKR 树。

## 依赖
- PRD 01: OKR 层级数据模型（goals 表已扩展）

## 功能需求

### 1. 新增 API 端点

#### GET /api/okr/trees
获取所有 OKR 树（只返回顶层 Objectives）
```json
{
  "trees": [
    {
      "id": "uuid",
      "title": "Cecelia Brain v1 发布",
      "type": "objective",
      "progress": 25,
      "status": "in_progress",
      "children_count": 4
    }
  ]
}
```

#### GET /api/okr/trees/:id
获取完整 OKR 树（含所有 KR）
```json
{
  "id": "uuid",
  "title": "Cecelia Brain v1 发布",
  "type": "objective",
  "progress": 25,
  "children": [
    {
      "id": "uuid",
      "title": "能自动运行 tick",
      "type": "key_result",
      "progress": 0,
      "weight": 1.0
    }
  ]
}
```

#### POST /api/okr/trees
创建新 OKR 树（O + KRs 一起创建）
```json
{
  "title": "Cecelia Brain v1 发布",
  "description": "...",
  "key_results": [
    { "title": "能自动运行 tick", "weight": 1.0 },
    { "title": "能自动处理任务", "weight": 1.0 }
  ]
}
```

#### PUT /api/okr/trees/:id
更新 OKR 树（支持添加/删除 KR）

#### DELETE /api/okr/trees/:id
删除整棵 OKR 树（级联删除 KR）

### 2. 路由文件
创建 `apps/core/src/okr/routes.js`

## 验收标准
- [ ] 可以一次性创建 O + 多个 KR
- [ ] 可以获取完整树结构
- [ ] 删除 O 时级联删除 KR
- [ ] API 文档更新
