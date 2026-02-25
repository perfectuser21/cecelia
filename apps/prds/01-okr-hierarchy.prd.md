---
id: prd-okr-hierarchy
version: 1.0.0
created: 2026-01-28
---

# PRD: OKR 层级数据模型

## 目标
扩展 goals 表支持 O → KR 层级关系，为 OKR Tree 系统奠定数据基础。

## 背景
当前 goals 表是扁平结构，无法表达 Objective 和 Key Result 的父子关系。

## 功能需求

### 1. 数据库变更
扩展 goals 表：
- 添加 `parent_id` 字段（外键指向自身，NULL 表示顶层 Objective）
- 添加 `type` 字段（'objective' | 'key_result'）
- 添加 `weight` 字段（KR 权重，用于计算 O 的进度）

```sql
ALTER TABLE goals ADD COLUMN parent_id UUID REFERENCES goals(id);
ALTER TABLE goals ADD COLUMN type VARCHAR(20) DEFAULT 'objective';
ALTER TABLE goals ADD COLUMN weight DECIMAL(3,2) DEFAULT 1.0;
```

### 2. API 变更
更新 `/api/tasks/goals` 端点：
- GET: 返回时包含 parent_id, type, weight
- POST: 支持创建 KR 时指定 parent_id
- GET /api/tasks/goals/:id/children: 获取某 O 的所有 KR

### 3. 进度计算
当 KR 进度更新时，自动计算父 Objective 的加权进度：
```
O.progress = Σ(KR.progress × KR.weight) / Σ(KR.weight)
```

## 验收标准
- [ ] goals 表包含 parent_id, type, weight 字段
- [ ] 可以创建 Objective 和关联的 Key Results
- [ ] 更新 KR 进度时 O 进度自动更新
- [ ] API 返回层级结构
