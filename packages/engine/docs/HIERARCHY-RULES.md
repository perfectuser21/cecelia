---
id: hierarchy-rules
version: 1.0.0
created: 2026-02-12
updated: 2026-02-12
status: CANONICAL
priority: CRITICAL
---

# 系统层级规则（SSOT - 唯一真相源）

**这是系统的唯一层级定义。所有代码、文档、Skills 必须遵守此规则。**

---

## 📐 四行核心规则（不可违反）

```
1. Initiative = features 表（历史命名遗留，未来可重命名，但现在就是同一个东西）
2. 主入口：KR/Initiative → PR Plans → Tasks(/dev)（唯一推荐入口，其他只能做转译/导入）
3. Project = Repo（执行载体，回答"在哪个 repo 干活"）
4. PR Plan 必须绑定 project_id（Initiative 可以跨多 repo，但每个 PR 必须落在一个具体 repo）
```

---

## 🏗️ 完整层级结构

```
KR (Key Result - 用户输入)
  ↓
Initiative (战略层 - features 表)
  ├── 回答：为什么干？要达成什么？
  ├── 数据库：features 表
  ├── 可以跨多个 Project (repo)
  └── 由 /okr 生成
  ↓
PR Plans (工程规划层 - pr_plans 表)
  ├── 回答：要发哪几个 PR？顺序/依赖是什么？
  ├── 数据库：pr_plans 表
  ├── 每个 PR Plan 绑定一个 Project (project_id)
  ├── 包含：dod, files, sequence, depends_on, complexity
  └── 由 /okr 生成
  ↓
Task (执行层 - tasks 表)
  ├── 回答：执行哪个 PR？
  ├── 数据库：tasks 表
  ├── 1 Task = 1 PR Plan (pr_plan_id)
  └── 由 /dev 执行
```

---

## 🔗 关系约束

### Initiative ↔ PR Plans（一对多）

```sql
-- 一个 Initiative 可以有多个 PR Plans
SELECT * FROM pr_plans WHERE initiative_id = '<initiative_id>';

-- 每个 PR Plan 必须关联一个 Initiative
ALTER TABLE pr_plans ADD CONSTRAINT fk_initiative
  FOREIGN KEY (initiative_id) REFERENCES features(id) ON DELETE CASCADE;
```

### PR Plans ↔ Project（多对一）

```sql
-- 多个 PR Plans 可以属于同一个 Project
SELECT * FROM pr_plans WHERE project_id = '<project_id>';

-- 每个 PR Plan 必须关联一个 Project
ALTER TABLE pr_plans ADD CONSTRAINT fk_project
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
```

### PR Plans ↔ Task（一对一）

```sql
-- 每个 PR Plan 对应一个 Task
SELECT * FROM tasks WHERE pr_plan_id = '<pr_plan_id>';

-- 每个 Task 最多关联一个 PR Plan
-- (pr_plan_id 可以为 NULL，表示 Task 不是通过 PR Plan 创建的)
```

---

## 🎯 唯一主入口（/okr）

### 输入

```
KR 或 Initiative 描述
```

### 输出（output.json）

```json
{
  "objective": "...",
  "kr_id": "...",

  "initiative": {
    "title": "实现任务智能调度系统",
    "description": "战略层大 PRD",
    "repositories": ["cecelia-core", "cecelia-workspace"]  // 可能影响多个 repo
  },

  "pr_plans": [
    {
      "title": "添加任务优先级算法",
      "description": "PR 描述",
      "project_id": "uuid-of-cecelia-core",  // ← 必须是有效的 project.id
      "dod": ["标准1", "标准2"],
      "files": ["brain/src/priority-algo.js"],
      "sequence": 1,
      "depends_on": [],
      "complexity": "medium",
      "estimated_hours": 8,

      "tasks": [
        {
          "title": "写 priority-algo.js",
          "type": "dev",
          "description": "Task 描述"
        }
      ]
    }
  ]
}
```

### 核心要求

1. **project_id 必须有效**：不能是随意字符串，必须能在 projects 表里查到
2. **每个 PR Plan 只绑定一个 Project**
3. **每个 PR Plan 对应 1 个 Task**（存储到 Brain 时自动创建）

---

## 🔍 repository → project_id 映射规则

### 问题

/okr 输出 repository 字符串（如 "cecelia-core"），但数据库需要 project_id（UUID）。

### 解决方案

**方案 A（推荐）：/okr 直接输出 project_id**

```json
{
  "pr_plans": [
    {
      "project_id": "550e8400-e29b-41d4-a716-446655440000"  // ← UUID
    }
  ]
}
```

- /okr 在生成前先查询 Brain：`GET /api/brain/projects`
- 获取 project.id 和 project.name 的映射表
- 生成时直接使用 project_id

**方案 B（次优）：/okr 输出 repo_path，Brain 查询**

```json
{
  "pr_plans": [
    {
      "repository": "/home/xx/perfect21/cecelia/core"  // ← repo_path
    }
  ]
}
```

- store-to-database.sh 查询：`SELECT id FROM projects WHERE repo_path = '<path>'`
- 如果找不到，报错拒绝存储

**方案 C（最差）：允许 name，但必须唯一**

```json
{
  "pr_plans": [
    {
      "repository": "cecelia-core"  // ← name
    }
  ]
}
```

- store-to-database.sh 查询：`SELECT id FROM projects WHERE name = '<name>'`
- 如果不唯一或找不到，报错

**推荐顺序**：A > B > C

---

## 🚫 禁止的入口（会导致概念打架）

### ❌ 直接从 Project 拆 Task

**错误**：
```
用户：请为 cecelia-core 项目生成任务
/okr：生成 Tasks（没有 Initiative，没有 PR Plans）
```

**问题**：绕过了战略层（Initiative）和规划层（PR Plans），无法追溯"为什么做这些任务"。

**正确**：
```
用户：请为 cecelia-core 实现 XXX 功能（描述 Initiative）
/okr：生成 Initiative → PR Plans（其中一些绑定到 cecelia-core）→ Tasks
```

---

### ❌ 直接从 Task 反推 PR Plan

**错误**：
```
用户：我有一个 Task "添加登录功能"，帮我生成 PR Plan
/okr：反向推断 PR Plan
```

**问题**：Task 是最底层的执行单元，不应该反向推断上层规划。

**正确**：
```
用户：我要实现用户认证系统（Initiative）
/okr：拆解为 PR Plans（其中一个是"添加登录功能"）→ 生成 Task
```

---

### ❌ Feature → Task 和 Initiative → PR Plans → Task 并行当主流程

**错误**：
```
/okr 支持两种模式：
- 模式 A：Feature → Task（旧）
- 模式 B：Initiative → PR Plans → Task（新）
两种模式并行使用
```

**问题**：概念混乱，数据库里同时存在两种拆解路径，无法统一查询和管理。

**正确**：
```
唯一主流程：Initiative → PR Plans → Task
旧数据可以兼容，但只能做"转译/导入"：
- 读取旧 Feature → 转换成 Initiative
- 读取旧 Task → 检查是否可以关联到 PR Plan
- 不允许新建旧格式数据
```

---

## 📋 /okr 的职责（简化后）

### 唯一目标

**生成结构化的 output.json**，包含 3 样：
1. Initiative (features)
2. PR Plans (带 project_id)
3. Tasks (每个 PR Plan 对应 1 个 Task，带 pr_plan_id)

### 不做的事情（交给后续环节）

- ❌ 不做深度内容质量验证（交给 CI）
- ❌ 不做 PR 创建（交给 /dev）
- ❌ 不做代码实现（交给 /dev）
- ❌ 不做测试执行（交给 /dev + CI）

### 简单验证（可选）

```bash
python3 validate-okr.py --quick output.json

检查项：
- JSON 格式正确
- 必需字段存在（initiative, pr_plans, tasks）
- project_id 有效（能在 projects 表里查到）
- 依赖关系合法（depends_on 引用的 sequence 存在）

不检查：
- PRD 内容质量
- DoD 详细程度
- 估时是否准确
```

---

## 🔄 数据流

```
1. 用户提供 KR 或 Initiative 描述
   ↓
2. /okr 生成 output.json
   - 1 个 Initiative
   - 2-5 个 PR Plans（每个绑定 project_id）
   - 2-5 个 Tasks（每个关联 pr_plan_id）
   ↓
3. store-to-database.sh 存储到 Brain
   - INSERT INTO features (initiative)
   - INSERT INTO pr_plans (关联 initiative_id + project_id)
   - INSERT INTO tasks (关联 pr_plan_id)
   ↓
4. /dev 执行 Task
   - /dev --task-id <uuid>
   - 从 Brain 读取 Task + PR Plan
   - 生成 .prd.md 和 .dod.md
   - 执行开发流程
   ↓
5. PR 合并，Task 完成
   - PATCH /api/brain/tasks/<uuid> {"status": "completed"}
   - PATCH /api/brain/pr-plans/<uuid> {"status": "completed"}
```

---

## 🛠️ 实施优先级

### P0（立即）：钉死层级关系

- ✅ 本文档已完成
- ⏳ 所有相关文档引用此文档（不再重复定义层级）

### P1（本周）：repository → project_id 映射

**选项 A**：/okr 生成时查询 Brain，直接输出 project_id
**选项 B**：store-to-database.sh 查询映射

推荐：选项 A（/okr 生成时解决）

### P2（本周）：简化 /okr

- 删除复杂的 validate_prd_structure 等验证
- 只保留简单的格式检查
- 深度验证交给 CI

### P3（下周）：features → initiatives 重命名

- 数据库迁移：`ALTER TABLE features RENAME TO initiatives`
- 更新所有代码和文档
- 这是清理债务，不是前置条件

---

## 📚 相关文档

| 文档 | 作用 |
|------|------|
| **本文档** | 系统层级规则（SSOT）|
| `docs/okr-exploratory-dev-hierarchy-analysis-v2.md` | 详细设计（现在需要简化）|
| `skills/okr/SKILL.md` | /okr Skill 定义 |
| `skills/dev/SKILL.md` | /dev Skill 定义 |
| `/home/xx/perfect21/cecelia/core/brain/migrations/021_add_pr_plans_table.sql` | PR Plans 表定义 |

---

## ✅ 总结：一句话记住

**当前系统真实可用的层级**：
```
KR → features(=Initiative) → pr_plans(绑定 project=repo) → tasks(1 task=1 pr_plan，由 /dev 执行)
```

**乱的根源**：
1. 命名没统一（features vs Initiative）
2. 主入口不唯一（多种拆解路径并行）
3. repo → project 映射缺失

**解决方案**：
1. 钉死 4 行规则（本文档）✅
2. 实现 repository → project_id 映射（P1）
3. 简化 /okr（P2）
4. 清理命名债务（P3）

---

**更新时间**: 2026-02-12
**状态**: CANONICAL（所有代码和文档必须遵守）
