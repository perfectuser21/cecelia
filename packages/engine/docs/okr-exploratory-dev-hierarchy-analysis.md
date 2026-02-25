---
id: okr-exploratory-dev-hierarchy-analysis
version: 1.0.0
created: 2026-02-12
updated: 2026-02-12
changelog:
  - 1.0.0: 初始版本 - 分析 /okr, /exploratory, /dev 三个 Skills 的层级关系和 PRD/DOD 职责
---

# OKR → Exploratory → Dev 层级关系分析

## 📋 问题背景

用户发现三个 Skills 都会生成 PRD/DOD，造成冲突：
1. **/okr**: 拆解 KR → Initiative → PR Plans (含 DoD) → Tasks
2. **/exploratory**: 探索式验证，生成 PRD/DoD
3. **/dev**: 开发执行，生成 PRD/DoD（或从 Brain 读取）

需要明确：
- **完整的层级结构是什么**？
- **每一层应该由谁生成 PRD/DoD**？
- **三个 Skills 应该如何协作**？

---

## 🏗️ 完整层级结构

### 当前架构（基于 #570, #571）

```
OKR/KR（目标层）
  ↓
Initiative（战略层）- 由 /okr 生成
  ├── title: "实现任务智能调度系统"
  ├── description: 总体规划（大 PRD）
  └── repository: "cecelia-core"
  ↓
PR Plans（工程规划层）- 由 /okr 生成
  ├── title: "添加任务优先级算法"
  ├── description: 具体做什么
  ├── dod: ["优先级算法实现完成", "单元测试覆盖率 > 80%"]  ← DoD 在这里
  ├── files: ["brain/src/priority-algo.js", ...]
  ├── sequence: 1
  ├── depends_on: []
  ├── complexity: "medium"
  ├── estimated_hours: 8
  └── tasks: [...]  ← 包含多个 Task
  ↓
Tasks（执行层）- 由 /okr 生成，/dev 执行
  ├── title: "写 priority-algo.js"
  ├── type: "dev"
  ├── description: "实现优先级计算算法"
  └── prd_status: "detailed" / "draft"
```

### Format A vs Format B

| 格式 | 层级 | 适用场景 | DoD 位置 |
|------|------|----------|----------|
| **Format A (3-layer)** | Initiative → PR Plans → Tasks | 大型 KR，需要多个 PR | **PR Plans 层** |
| **Format B (2-layer)** | Features → Tasks | 简单任务，单个 PR | **Feature 层** |

---

## 🔄 当前三个 Skills 的职责

### 1. /okr (秋米 - OKR 拆解专家)

**定位**: 战略规划 + 工程规划

**输出** (Format A):
```json
{
  "initiative": {
    "title": "实现任务智能调度系统",
    "description": "大 PRD（战略层）",
    "repository": "cecelia-core"
  },
  "pr_plans": [
    {
      "title": "添加任务优先级算法",
      "description": "PR 描述（工程层）",
      "dod": ["标准1", "标准2"],  ← DoD 在 PR Plans 层
      "files": [...],
      "sequence": 1,
      "tasks": [
        {
          "title": "写 priority-algo.js",
          "type": "dev",
          "description": "Task 描述"  ← 详细 PRD 或草稿
        }
      ]
    }
  ]
}
```

**当前问题**:
- ❌ PR Plans 的 `dod` 字段 ≠ /dev 要求的 `.dod.md` 文件格式
- ❌ Tasks 的 `description` 字段 ≠ /dev 要求的 `.prd.md` 文件格式
- ❌ /okr 输出 JSON，但 /dev 需要 markdown 文件

---

### 2. /exploratory (探索式验证)

**定位**: 快速验证方案可行性，无 CI 限制

**输出**:
```
Step 1: 创建 worktree + 分支
Step 2: 生成 PRD/DoD 文件
  ├── .prd-<branch>.md
  └── .dod-<branch>.md
Step 3: 快速实现 + 测试
Step 4: 生成反馈报告
```

**当前问题**:
- ✅ /exploratory 的 PRD/DoD 是临时的，用于探索
- ✅ 探索完成后，结果会转化为 /okr 的 Initiative/PR Plans
- ❌ 但目前 /exploratory 和 /okr 没有集成

---

### 3. /dev (Caramel - 编程专家)

**定位**: 正式开发执行，必须有 PRD/DoD（hook 强制）

**输入来源** (两种模式):

**模式 1: 手动提供 PRD**
```bash
/dev
# → AI 生成 .prd.md 和 .dod.md
```

**模式 2: 从 Brain 读取 Task** (#551)
```bash
/dev --task-id task_123
# → Step 1: 调用 Brain API GET /tasks/task_123
# → 获取: title, description, acceptance_criteria
# → 生成 .prd-task_123.md 和 .dod-task_123.md
```

**当前问题**:
- ✅ /dev 可以从 Brain 读取 Task 生成 PRD
- ❌ 但 Brain 中的 Task description ≠ 完整的 PRD（50-200 字 vs 详细 PRD）
- ❌ /dev 的 DoD 和 /okr 的 PR Plans DoD 不统一

---

## 🎯 问题分析：PRD/DoD 生成冲突

### 冲突点 1: DoD 生成位置

| Skill | DoD 位置 | 格式 | 用途 |
|-------|---------|------|------|
| **/okr** | PR Plans 层 | JSON 数组 `["标准1", "标准2"]` | 工程规划 |
| **/exploratory** | 文件 `.dod-<branch>.md` | Markdown checkbox | 验证清单 |
| **/dev** | 文件 `.dod-<branch>.md` | Markdown checkbox | 开发验收 |

**问题**:
- /okr 生成的 DoD 是 JSON 数组
- /dev 需要的 DoD 是 markdown 文件
- 两者无法直接对接

---

### 冲突点 2: PRD 生成位置

| Skill | PRD 位置 | 详细程度 | 用途 |
|-------|---------|----------|------|
| **/okr** (Initiative) | `description` 字段 | 大 PRD (100-500 字) | 战略总述 |
| **/okr** (PR Plans) | `description` 字段 | 中 PRD (50-200 字) | 工程规划 |
| **/okr** (Tasks) | `description` 字段 | 小 PRD (20-100 字) | 任务描述 |
| **/exploratory** | `.prd-<branch>.md` | 详细 PRD | 探索验证 |
| **/dev** | `.prd-<branch>.md` | 详细 PRD | 正式开发 |

**问题**:
- /okr 的 Task description 太简单，不满足 /dev 的 PRD 要求
- /dev 需要 500+ 字的详细 PRD 文件
- /okr 的 detailed task 有完整 PRD，但 draft task 只有简短描述

---

## 💡 解决方案建议

### 方案 A: 统一到 PR Plans 层生成 PRD/DoD（推荐）

**核心思路**: /okr 生成 PR Plans 时就包含完整的 PRD 和 DoD（markdown 格式）

#### 变更点

1. **/okr 输出格式扩展**:
```json
{
  "pr_plans": [
    {
      "title": "添加任务优先级算法",
      "description": "PR 描述",
      "dod": ["标准1", "标准2"],  // 保留 JSON（给 Brain 用）
      "dod_markdown": "# DoD\n- [ ] 标准1\n- [ ] 标准2",  // 新增 markdown
      "prd_markdown": "# PRD\n## 背景\n...\n## 功能需求\n...",  // 新增 markdown
      "files": [...],
      "tasks": [...]
    }
  ]
}
```

2. **/dev --pr-plan-id 模式** (新增):
```bash
/dev --pr-plan-id pr_plan_123

# Step 1: 调用 Brain API GET /pr-plans/pr_plan_123
# 获取: title, description, dod_markdown, prd_markdown, files
# 生成: .prd-pr_plan_123.md 和 .dod-pr_plan_123.md
# 执行: 完成 PR Plan 中的所有 Tasks
```

3. **Brain 数据库 Schema 扩展**:
```sql
-- 新增 pr_plans 表
CREATE TABLE pr_plans (
  id UUID PRIMARY KEY,
  initiative_id UUID REFERENCES initiatives(id),
  title TEXT NOT NULL,
  description TEXT,
  dod JSONB,              -- JSON 数组
  dod_markdown TEXT,      -- Markdown 格式
  prd_markdown TEXT,      -- 完整 PRD
  files JSONB,
  sequence INT,
  depends_on JSONB,
  complexity VARCHAR(20),
  estimated_hours INT,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tasks 关联到 PR Plans
ALTER TABLE tasks ADD COLUMN pr_plan_id UUID REFERENCES pr_plans(id);
```

4. **/exploratory 的定位**:
```
/exploratory 不再生成 PRD/DoD 文件
只负责快速验证代码可行性
探索结果作为反馈输入给 /okr，由 /okr 生成正式的 PR Plans
```

---

#### 工作流程

```
1. Cecelia 收到 KR
   ↓
2. 调用 /okr 拆解
   ├─> 生成 Initiative（战略层大 PRD）
   ├─> 生成 PR Plans（工程层 PRD + DoD）
   └─> 生成 Tasks（执行层任务描述）
   ↓
3. Brain 存储到数据库
   ├─> initiatives 表
   ├─> pr_plans 表（含 prd_markdown + dod_markdown）
   └─> tasks 表（pr_plan_id 关联）
   ↓
4. (可选) 调用 /exploratory 验证某个 PR Plan 的技术方案
   ├─> 快速实现 → 测试 → 生成反馈
   └─> 反馈回 Brain，更新 PR Plan
   ↓
5. 调用 /dev 执行 PR Plan
   ├─> /dev --pr-plan-id pr_123
   ├─> 从 Brain 读取 prd_markdown + dod_markdown
   ├─> 生成 .prd-pr_123.md 和 .dod-pr_123.md
   ├─> 执行开发流程（Branch → Code → Test → PR）
   ├─> 完成后上传反馈到 Brain
   └─> 更新 PR Plan 状态为 completed
   ↓
6. 重复步骤 5，直到所有 PR Plans 完成
   ↓
7. Initiative 完成，KR 达成 ✅
```

---

### 方案 B: 保持现状，增加转换层

**核心思路**: /okr 生成 JSON，/dev 启动时自动转换为 markdown

#### 变更点

1. **/dev 增加转换逻辑**:
```bash
# Step 1-PRD 生成
if [ -n "$TASK_ID" ]; then
    # 从 Brain 读取 Task
    task_json=$(curl -s http://localhost:5221/api/brain/tasks/$TASK_ID)

    # 获取 PR Plan 信息
    pr_plan_id=$(echo "$task_json" | jq -r .pr_plan_id)
    pr_plan_json=$(curl -s http://localhost:5221/api/brain/pr-plans/$pr_plan_id)

    # 转换 JSON → Markdown
    echo "# PRD - $(echo "$pr_plan_json" | jq -r .title)" > .prd.md
    echo "$pr_plan_json" | jq -r .description >> .prd.md

    # 转换 DoD JSON → Markdown
    echo "# DoD" > .dod.md
    echo "$pr_plan_json" | jq -r '.dod[]' | sed 's/^/- [ ] /' >> .dod.md
fi
```

**问题**:
- ❌ /okr 的 PR Plans description 不够详细，不满足 /dev 的 PRD 要求
- ❌ 转换层增加复杂度，维护成本高
- ❌ /exploratory 仍然独立生成 PRD/DoD，没有解决冲突

---

### 方案 C: 完全分离，不同层级用不同 Skills

**核心思路**: 每个 Skill 负责不同层级

| 层级 | 负责 Skill | 输出 |
|------|-----------|------|
| **战略层** | /okr | Initiative (大 PRD) |
| **工程层** | /okr | PR Plans (中 PRD + DoD) |
| **探索层** | /exploratory | 探索式验证（临时 PRD/DoD，用完删除）|
| **执行层** | /dev | 从 PR Plans 读取 PRD/DoD，执行开发 |

**优点**:
- ✅ 职责清晰
- ✅ /exploratory 的 PRD/DoD 是临时的，不与正式流程冲突

**缺点**:
- ❌ /okr 的 PR Plans description 仍然不够详细
- ❌ 需要 /okr 生成更详细的 PRD（增加 Token 消耗）

---

## 🎯 推荐方案：方案 A + 分阶段实现

### Phase 1: /okr 生成完整 PRD/DoD markdown (立即实施)

**目标**: 让 /okr 生成的 PR Plans 包含完整的 PRD 和 DoD markdown

**变更**:
1. **skills/okr/SKILL.md**:
   - 添加 `prd_markdown` 和 `dod_markdown` 字段到 PR Plans
   - 提示 AI 生成 500+ 字的完整 PRD

2. **skills/okr/scripts/validate-okr.py**:
   - 验证 `prd_markdown` 长度 > 500 字符
   - 验证 `dod_markdown` 格式正确（checkbox list）

3. **skills/okr/scripts/store-to-database.sh**:
   - 存储 PR Plans 时保存 prd_markdown 和 dod_markdown 到数据库

---

### Phase 2: Brain 增加 PR Plans 表 (1-2 天)

**目标**: 数据库支持存储 PR Plans 和 markdown 字段

**变更**:
1. **brain/migrations/XXX_add_pr_plans.sql**:
```sql
CREATE TABLE pr_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id UUID REFERENCES initiatives(id),
  title TEXT NOT NULL,
  description TEXT,
  dod JSONB,
  dod_markdown TEXT,
  prd_markdown TEXT,
  files JSONB,
  sequence INT,
  depends_on JSONB,
  complexity VARCHAR(20),
  estimated_hours INT,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_pr_plans_initiative ON pr_plans(initiative_id);
CREATE INDEX idx_pr_plans_status ON pr_plans(status);

ALTER TABLE tasks ADD COLUMN pr_plan_id UUID REFERENCES pr_plans(id);
CREATE INDEX idx_tasks_pr_plan ON tasks(pr_plan_id);
```

2. **brain/routes/pr-plans.js**:
```javascript
// GET /api/brain/pr-plans/:id
// PATCH /api/brain/pr-plans/:id (更新状态)
// GET /api/brain/pr-plans/:id/tasks (获取关联的 Tasks)
```

---

### Phase 3: /dev 支持 --pr-plan-id (1-2 天)

**目标**: /dev 可以从 Brain 读取 PR Plans 的 PRD/DoD

**变更**:
1. **skills/dev/SKILL.md**: 添加 `--pr-plan-id` 参数
2. **skills/dev/scripts/fetch-pr-plan.sh**: 调用 Brain API 获取 PR Plan
3. **skills/dev/steps/01-prd.md**:
   - 检测 `--pr-plan-id` 参数
   - 调用 fetch-pr-plan.sh
   - 生成 `.prd-pr_<id>.md` 和 `.dod-pr_<id>.md`

---

### Phase 4: /exploratory 集成到流程 (1-2 天)

**目标**: /exploratory 作为可选的验证步骤，反馈给 /okr

**工作流**:
```
1. /okr 拆解 KR → 生成 PR Plans（含详细 PRD/DoD）
2. (可选) /exploratory 快速验证某个 PR Plan 的技术方案
   ├─> 生成临时 worktree 和分支
   ├─> 快速实现 → 测试
   ├─> 生成反馈报告
   └─> 反馈给 Brain，更新 PR Plan 的 prd_markdown
3. /dev --pr-plan-id 执行正式开发
```

**变更**:
1. **skills/exploratory/steps/01-init.md**:
   - 增加 `--pr-plan-id` 参数（可选）
   - 如果有 pr_plan_id，从 Brain 读取初始 PRD

2. **skills/exploratory/steps/04-feedback.md**:
   - 反馈上传到 Brain: `POST /api/brain/pr-plans/:id/exploration-feedback`
   - Brain 根据反馈调整 PR Plan 的 prd_markdown

---

## 📊 方案 A 完整架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    Cecelia Brain (调度中心)                   │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ Initiatives│  │  PR Plans    │  │   Tasks      │         │
│  │ (战略层)    │  │ (工程规划层)  │  │  (执行层)     │         │
│  └────────────┘  └──────────────┘  └──────────────┘         │
└─────────────────────────────────────────────────────────────┘
         ↓                   ↓                   ↓
    由 /okr 生成        由 /okr 生成         由 /okr 生成
                           ↓
                  包含完整 PRD + DoD
                  (prd_markdown + dod_markdown)
                           ↓
                    存储到 Brain 数据库
                           ↓
         ┌─────────────────┴─────────────────┐
         ↓                                   ↓
  (可选) /exploratory                     /dev --pr-plan-id
  快速验证技术方案                       正式开发执行
         ↓                                   ↓
  生成反馈 → 更新 PR Plan              生成 .prd.md + .dod.md
                                           ↓
                                      执行 Branch → Code → Test → PR
                                           ↓
                                      完成 → 上传反馈 → 更新 PR Plan 状态
```

---

## ✅ 行动计划

### 立即开始 (今天)

1. **修改 /okr SKILL.md** - 添加 `prd_markdown` 和 `dod_markdown` 字段定义
2. **修改 validate-okr.py** - 添加 markdown 字段验证
3. **测试** - 用 /okr 生成一个完整的 3-layer output，验证 PRD 和 DoD 质量

### 本周内

4. **Brain 数据库迁移** - 添加 pr_plans 表
5. **store-to-database.sh** - 存储 PR Plans 到 Brain
6. **Brain API** - 实现 GET /pr-plans/:id

### 下周

7. **/dev --pr-plan-id** - 支持从 Brain 读取 PR Plans
8. **/exploratory 集成** - 反馈机制

---

## 📝 总结

**核心问题**: /okr, /exploratory, /dev 三个 Skills 都生成 PRD/DoD，造成冲突和重复。

**根本原因**:
- /okr 生成的 PR Plans description 太简单，不满足 /dev 的 PRD 要求
- /okr 的 DoD 是 JSON 数组，/dev 需要 markdown 文件
- 三个 Skills 之间缺乏数据传递机制

**推荐方案**: 方案 A - 统一到 PR Plans 层生成 PRD/DoD
- /okr 生成完整的 prd_markdown 和 dod_markdown
- /dev 从 Brain 读取 PR Plans，直接使用 markdown
- /exploratory 作为可选验证步骤，反馈给 Brain 更新 PR Plans

**优势**:
- ✅ 职责清晰：/okr 负责规划，/exploratory 负责验证，/dev 负责执行
- ✅ 数据统一：所有 PRD/DoD 都来自 /okr 生成的 PR Plans
- ✅ 可扩展：支持探索式验证，支持迭代调整
- ✅ 向后兼容：Format B (2-layer) 仍然可用

**下一步**: 开始 Phase 1，修改 /okr 生成完整的 PRD 和 DoD markdown。
