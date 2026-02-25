---
id: trd-okr-system
version: 1.0.0
created: 2026-01-28
updated: 2026-01-29
status: completed
---

# TRD: OKR Tree System

## 1. 概述

### 1.1 目标
构建 OKR (Objectives & Key Results) 树形管理系统，支持目标层级、自动进度计算、焦点选择和任务自动推进。

### 1.2 背景
Cecelia 需要从扁平任务列表升级为 OKR 体系，实现：
- Objective → Key Results 层级关系
- 自动计算 O 的加权进度
- 智能选择每日焦点
- 自动推进排队任务

### 1.3 范围
- **包含**：数据模型、CRUD API、优先级引擎、Tick 机制、Dashboard
- **不包含**：多用户协作、历史周期归档、移动端

---

## 2. 系统架构

### 2.1 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                     OKR Dashboard (React)                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Focus Panel ─────→  OKR Cards ─────→  Progress Bars        │
│      │                   │                                  │
│      ▼                   ▼                                  │
│  /api/brain/focus    /api/okr/trees                         │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                      Brain API Layer                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Priority Engine ──→ Focus Selection ──→ Tick Mechanism     │
│       │                   │                    │            │
│       ▼                   ▼                    ▼            │
│  goals (parent_id)   working_memory       decision_log      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 组件说明

| 组件 | 职责 | 文件 |
|------|------|------|
| OKR Hierarchy | 数据模型扩展 | goals 表 |
| OKR Tree API | CRUD 操作 | src/okr/routes.js |
| Priority Engine | 焦点选择算法 | src/brain/focus.js |
| Action Loop | 自动推进 | src/brain/tick.js |
| OKR Dashboard | 前端展示 | features/okr/pages/OKRPage.tsx |

---

## 3. 数据模型

### 3.1 数据库变更

```sql
-- goals 表扩展
ALTER TABLE goals ADD COLUMN parent_id UUID REFERENCES goals(id);
ALTER TABLE goals ADD COLUMN type VARCHAR(20) DEFAULT 'objective';
ALTER TABLE goals ADD COLUMN weight DECIMAL(3,2) DEFAULT 1.0;

-- 索引
CREATE INDEX idx_goals_parent_id ON goals(parent_id);
CREATE INDEX idx_goals_type ON goals(type);
```

### 3.2 数据流

```
创建 Objective
      ↓
添加 Key Results (parent_id = O.id)
      ↓
更新 KR.progress
      ↓
触发: O.progress = Σ(KR.progress × KR.weight) / Σ(KR.weight)
      ↓
Priority Engine 选择焦点
      ↓
Tick 机制自动推进任务
```

---

## 4. PRD 拆解

### 4.1 依赖图

```
01-okr-hierarchy (数据模型)
        ↓
02-okr-tree-api (CRUD API)
        ↓
03-priority-engine (焦点选择)
        ↓
04-action-loop (自动推进)
        ↓
05-okr-dashboard (前端)
        ↓
06-okr-verify (验收) [未执行]
```

### 4.2 PRD 清单

| 序号 | PRD 文件 | 描述 | PR | 状态 |
|------|----------|------|-----|------|
| 01 | 01-okr-hierarchy.prd.md | goals 表扩展 | #59 | ✅ |
| 02 | 02-okr-tree-api.prd.md | CRUD API | #60 | ✅ |
| 03 | 03-priority-engine.prd.md | 焦点算法 | #61 | ✅ |
| 04 | 04-action-loop.prd.md | Tick 机制 | #62 | ✅ |
| 05 | 05-okr-dashboard.prd.md | 前端页面 | #63 | ✅ |
| 06 | 06-okr-verify.prd.md | 验收清理 | - | 待创建 |

---

## 5. 接口设计

### 5.1 OKR Tree API

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | /api/okr/trees | 获取所有 Objectives |
| POST | /api/okr/trees | 创建 O + KRs |
| GET | /api/okr/trees/:id | 获取 O 及其 KRs |
| PATCH | /api/okr/trees/:id | 更新 O |
| DELETE | /api/okr/trees/:id | 删除 O (级联删除 KRs) |
| POST | /api/okr/trees/:id/key-results | 添加 KR |
| PATCH | /api/okr/trees/:id/key-results/:krId | 更新 KR |
| DELETE | /api/okr/trees/:id/key-results/:krId | 删除 KR |

### 5.2 Brain API

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | /api/brain/focus | 获取当日焦点 |
| POST | /api/brain/focus | 手动设置焦点 |
| GET | /api/brain/tick/status | Tick 状态 |
| POST | /api/brain/tick/enable | 启用 Tick |
| POST | /api/brain/tick/disable | 禁用 Tick |
| POST | /api/brain/tick/execute | 立即执行 Tick |

---

## 6. 技术决策

| 决策点 | 选项 | 决定 | 原因 |
|--------|------|------|------|
| 层级存储 | 邻接表 vs 嵌套集 | 邻接表 (parent_id) | 简单，层级浅 |
| 进度计算 | 实时 vs 触发器 | 实时 (API 层) | 灵活，可测试 |
| 焦点存储 | 数据库 vs 内存 | working_memory 表 | 持久化 |
| 前端框架 | React + TypeScript | React + TypeScript | 项目现有技术栈 |

---

## 7. 验收标准

### 7.1 功能验收 ✅

- [x] 可创建 Objective 和 Key Results
- [x] KR 进度更新时 O 进度自动计算
- [x] Priority Engine 正确选择焦点
- [x] Tick 可启用/禁用/手动执行
- [x] Dashboard 显示焦点和所有 OKR

### 7.2 技术验收 ✅

- [x] 94 个测试全部通过
- [x] 无 linting 错误
- [x] API 响应格式一致

### 7.3 待完成

- [ ] 数据库迁移脚本执行验证
- [ ] 服务重启后功能正常
- [ ] E2E 流程测试
- [ ] n8n 定时 Tick 工作流

---

## 8. 经验总结

### 8.1 成功点
- cecelia-queue 顺利执行 5 个 PRD
- 每个 PRD 独立成 PR，CI 全部通过
- /dev skill 自检测状态，无需 --resume

### 8.2 改进点
- 缺少总体 TRD 指导，PRD 间依赖不够明确
- 缺少最终验收 PRD（迁移、重启、E2E）
- 应在第一个 PRD 前创建 TRD

### 8.3 下次改进
```
正确顺序：
1. 创建 TRD（架构、依赖图）
2. 拆解 PRD（含序号和依赖）
3. 执行 PRD 01-0N
4. 执行 Verify PRD（迁移、测试、清理）
```
