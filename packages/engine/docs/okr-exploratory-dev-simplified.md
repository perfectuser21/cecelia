---
id: okr-exploratory-dev-simplified
version: 3.0.0
created: 2026-02-12
updated: 2026-02-12
supersedes: okr-exploratory-dev-hierarchy-analysis-v2.md
canonical_rules: docs/HIERARCHY-RULES.md
changelog:
  - 3.0.0: 简化版 - 删除复杂验证逻辑，回归探索性工具本质
  - 2.0.0: 补充权责边界等 5 个细节
  - 1.0.0: 初始分析
---

# OKR → Exploratory → Dev 工作流（简化版）

**⚠️ 层级关系和核心规则请参考：[`docs/HIERARCHY-RULES.md`](./HIERARCHY-RULES.md)**

本文档只关注三个 Skills 的协作方式，不重复定义层级。

---

## 🎯 核心定位

### /okr - 探索性规划工具

**定位**：快速生成结构化规划，不做深度验证

**输入**：KR 或 Initiative 描述

**输出**：output.json
- 1 个 Initiative (features)
- 2-5 个 PR Plans (带 project_id)
- 2-5 个 Tasks (关联 pr_plan_id)

**验证**：只做简单的格式检查
- JSON valid
- 必需字段存在
- project_id 有效（能在 projects 表里查到）

**不做**：
- ❌ 不做深度内容质量验证（PRD 章节完整性等）
- ❌ 不做 Stop Hook 强制循环
- ❌ 不要求 score >= 90

---

### /exploratory - 技术验证工具

**定位**：快速验证技术方案可行性，生成反馈

**输入**：PR Plan ID（可选）或技术问题

**输出**：
- `.exploration.md` - Exploration Spec（假设、实验、发现）
- `.exploration-feedback.json` - 结构化反馈
- `artifacts/` - 证据文件（benchmark, screenshot 等）

**特点**：
- 不生成正式的 `.prd.md` 或 `.dod.md`
- 在独立 worktree 中快速实验
- 无 CI 限制，快速迭代
- 生成反馈供后续决策使用

---

### /dev - 正式开发执行

**定位**：执行 Task，生成 PR，通过 CI

**输入**：Task ID（从 Brain 读取）

**输出**：
- `.prd-task_<id>.md` - 从 PR Plan 注入的 PRD
- `.dod-task_<id>.md` - 从 PR Plan 提取的 DoD
- 完整的开发流程（Branch → Code → Test → PR → CI）

**特点**：
- 必须有 PRD/DoD（Hook 强制）
- 必须通过 CI（DevGate 检查）
- 有 Stop Hook 循环控制
- PR 合并后才算完成

---

## 🔄 三个工作流模式

### 模式 1：直接开发（简单明确的任务）

```
KR 描述
  ↓
/okr 生成规划 (Initiative → PR Plans → Tasks)
  ↓
Brain 存储
  ↓
/dev --task-id <uuid>
  ↓
PR 合并 ✅
```

**适用场景**：
- 技术方案明确
- 不需要探索验证
- 直接执行即可

---

### 模式 2：先探索再开发（技术不确定）

```
KR 描述
  ↓
/okr 生成规划
  ↓
选择一个 PR Plan 进行技术验证
  ↓
/exploratory --pr-plan-id <uuid>
  ├─> 快速实验 → 生成反馈
  └─> 发现问题 → 调整方案
  ↓
反馈提交到 Brain
  ↓
(可选) 基于反馈调整 PR Plan
  ↓
/dev --task-id <uuid>
  ↓
PR 合并 ✅
```

**适用场景**：
- 技术方案不确定
- 需要性能测试
- 需要快速验证可行性

---

### 模式 3：迭代改进（复杂项目）

```
KR 描述
  ↓
/okr 生成规划 (多个 PR Plans)
  ↓
执行 PR Plan 1
  ├─> (可选) /exploratory 验证
  └─> /dev 执行 → PR 合并
  ↓
基于 PR Plan 1 的反馈
  ├─> 发现新问题
  └─> 提交 feedback
  ↓
执行 PR Plan 2
  └─> /dev 执行 → PR 合并
  ↓
...重复直到所有 PR Plans 完成
```

**适用场景**：
- 大型功能，需要多个 PR
- PR 之间有依赖关系
- 需要根据反馈调整后续计划

---

## 📋 /okr 输出格式（简化版）

### 最小可行格式

```json
{
  "objective": "提升任务调度效率",
  "kr_id": "kr_2026_q1_001",

  "initiative": {
    "title": "实现任务智能调度系统",
    "description": "基于优先级和资源状态的智能调度算法",
    "repositories": ["cecelia-core"]
  },

  "pr_plans": [
    {
      "title": "添加任务优先级算法",
      "description": "实现基于多因素的优先级计算",
      "project_id": "550e8400-e29b-41d4-a716-446655440000",  // ← 必须有效
      "dod": [
        "优先级算法实现完成",
        "单元测试覆盖率 > 80%"
      ],
      "files": [
        "brain/src/priority-algo.js",
        "brain/src/__tests__/priority-algo.test.js"
      ],
      "sequence": 1,
      "depends_on": [],
      "complexity": "medium",
      "estimated_hours": 8,

      "tasks": [
        {
          "title": "写 priority-algo.js",
          "type": "dev",
          "description": "实现优先级计算算法，考虑任务类型、创建时间、依赖关系等因素"
        }
      ]
    }
  ]
}
```

### 字段说明

#### Initiative（战略层）

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| title | string | ✅ | 以动词开头，描述总体目标 |
| description | string | ✅ | 详细说明（至少 50 字）|
| repositories | array | ✅ | 可能影响的 repos |

#### PR Plans（工程规划层）

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| title | string | ✅ | PR 标题 |
| description | string | ✅ | PR 描述 |
| project_id | uuid | ✅ | **必须是有效的 project.id** |
| dod | array | ✅ | 验收标准（至少 2 条）|
| files | array | ✅ | 涉及的文件（至少 1 个）|
| sequence | integer | ✅ | 执行顺序 |
| depends_on | array | ✅ | 依赖的 PR Plans (可为空) |
| complexity | string | ✅ | small/medium/large |
| estimated_hours | integer | ✅ | 预估工时 |
| tasks | array | ✅ | 任务列表 |

#### Tasks（执行层）

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| title | string | ✅ | 任务标题 |
| type | string | ✅ | dev/review/qa/audit |
| description | string | ✅ | 任务描述 |

---

## 🔧 repository → project_id 映射（P1 优先级）

### 问题

/okr 需要输出 project_id，但 AI 只知道 repo 名字（如 "cecelia-core"）。

### 解决方案：/okr 生成前查询 Brain

```bash
# /okr Skill 在生成 output.json 前执行

# 1. 查询所有 Projects
projects=$(curl -s http://localhost:5212/api/tasks/projects)

# 2. 生成映射表
echo "$projects" | jq -r '.[] | "\(.name) → \(.id)"' > /tmp/okr-project-map.txt

# 示例输出：
# cecelia-core → 550e8400-e29b-41d4-a716-446655440000
# cecelia-workspace → 660e8400-e29b-41d4-a716-446655440001
# cecelia-engine → 770e8400-e29b-41d4-a716-446655440002

# 3. AI 在生成 output.json 时使用映射表
# 将 "cecelia-core" 转换为 "550e8400-e29b-41d4-a716-446655440000"
```

**如果 Brain 不可用**：
- 降级：允许使用 repo 名字（string）
- store-to-database.sh 负责查询映射
- 查询失败时报错，不存储

---

## 🧪 /exploratory 的 Exploration Spec 格式

### .exploration.md 结构

```markdown
---
pr_plan_id: pr_123
exploration_id: exp_456
started_at: 2026-02-12T10:00:00Z
completed_at: 2026-02-12T12:30:00Z
status: completed
---

# Exploration: 任务优先级算法技术验证

## 假设 (Hypotheses)

### H1: 使用加权评分法可以在 10ms 内完成计算
**优先级**: P0
**可证伪**: 可以通过 benchmark 测试

## 实验 (Experiments)

### E1: 加权评分算法性能测试
**目的**: 验证 H1
**方法**: ...
**结果**: 平均 3.2ms ✅

**证据**: `artifacts/benchmark.csv`

## 发现 (Findings)

### ✅ 成功验证
- 算法性能满足要求

### ⚠️ 需要注意
- P99.9 略超 10ms（12.3ms）

### 🔴 潜在风险
- 复杂任务（> 100 依赖）性能衰减

## 推荐改动 (建议，不强制)

- 建议在 DoD 中增加压力测试要求
- 建议在 PRD 中增加性能优化章节
```

### .exploration-feedback.json 格式

```json
{
  "pr_plan_id": "pr_123",
  "summary": "验证了算法可行性，发现性能边界问题",
  "findings": {
    "successes": ["算法性能满足要求"],
    "warnings": ["P99.9 略超预期"],
    "risks": ["复杂任务性能衰减"]
  },
  "recommended_changes": [
    {
      "target": "dod",
      "suggestion": "增加压力测试要求"
    }
  ],
  "artifacts": {
    "evidence_files": ["artifacts/benchmark.csv"]
  }
}
```

**注意**：
- 这是建议，不是强制修改
- 不直接修改 PR Plan
- 由人工或 Brain 决策是否采纳

---

## ⚙️ /dev --task-id 执行流程

### 输入

```bash
/dev --task-id task_123
```

### 流程

```
1. 从 Brain 读取 Task
   task = GET /api/brain/tasks/task_123

2. 从 Brain 读取关联的 PR Plan
   pr_plan = GET /api/brain/pr-plans/<pr_plan_id>

3. 生成 .prd-task_123.md
   - PR Plan 的 description（大 PRD）
   - Task 的 description（具体工作）

4. 生成 .dod-task_123.md
   - PR Plan 的 dod（验收标准）

5. 执行开发流程
   Branch → Code → Test → Quality → PR → CI → Cleanup

6. 完成后更新状态
   PATCH /api/brain/tasks/task_123 {"status": "completed"}
   PATCH /api/brain/pr-plans/<pr_plan_id> {"status": "completed"}
```

---

## 📊 数据流总览

```
用户 → KR 描述
  ↓
/okr 生成 output.json
  ├─> 1 Initiative
  ├─> 2-5 PR Plans (带 project_id)
  └─> 2-5 Tasks (关联 pr_plan_id)
  ↓
store-to-database.sh 存储到 Brain
  ├─> INSERT INTO features (initiative)
  ├─> INSERT INTO pr_plans (关联 initiative_id + project_id)
  └─> INSERT INTO tasks (关联 pr_plan_id)
  ↓
(可选) /exploratory 验证技术方案
  ├─> 生成 .exploration.md
  ├─> 生成 .exploration-feedback.json
  └─> 提交 feedback 到 Brain
  ↓
/dev --task-id <uuid> 执行开发
  ├─> 读取 Task + PR Plan
  ├─> 生成 .prd.md + .dod.md
  ├─> 执行开发流程
  └─> PR 合并 → 更新状态
  ↓
完成 ✅
```

---

## ✅ 行动计划

### P0（立即）：明确层级关系

- ✅ 已完成：`docs/HIERARCHY-RULES.md`
- ⏳ 所有文档引用此规则

### P1（本周）：实现 repository → project_id 映射

**修改**：`skills/okr/SKILL.md`
- 添加"生成前查询 Brain Projects"步骤
- 使用映射表生成 project_id

**测试**：
```bash
/okr
# 生成的 output.json 中 project_id 必须是有效 UUID
```

### P2（本周）：简化 /okr 验证逻辑

**修改**：`skills/okr/scripts/validate-okr.py`
- 删除复杂的 PRD 结构检查
- 删除 DoD 一致性检查
- 只保留：JSON valid, 必需字段, project_id 有效

**简化后的验证**：
```python
def validate_okr_quick(output_json):
    # 1. JSON valid
    # 2. 必需字段存在
    # 3. project_id 在 projects 表里
    # 4. depends_on 引用的 sequence 存在
    pass
```

### P3（本周）：/dev 支持 --task-id

**修改**：
- `skills/dev/SKILL.md` - 添加 --task-id 参数说明
- `skills/dev/scripts/fetch-task-prd.sh` - 读取 Task + PR Plan，生成 PRD/DoD
- `skills/dev/steps/01-prd.md` - 集成 --task-id 检测

### P4（下周）：features → initiatives 重命名

**这是清理债务，不影响功能**：
- 数据库迁移
- 代码更新
- 文档更新

---

## 🎯 总结

**核心原则**：
1. 层级关系钉死在 `HIERARCHY-RULES.md`，所有文档引用它
2. /okr 是探索性工具，快速生成规划，不做深度验证
3. /exploratory 生成反馈建议，不直接修改 PR Plan
4. /dev 执行 Task，通过 CI 保证质量

**简化哲学**：
- 本地只做格式检查
- 深度验证交给 CI
- 不要 Stop Hook 强制循环（/okr）
- 不要复杂的评分系统

**下一步**：
1. 实现 repository → project_id 映射（P1）
2. 简化 validate-okr.py（P2）
3. /dev 支持 --task-id（P3）

---

**更新时间**: 2026-02-12
**状态**: ACTIVE（替代 v2.0）
