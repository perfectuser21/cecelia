---
id: decomp-skill
version: 1.8.0
created: 2026-01-01
updated: 2026-03-04
changelog:
  - 1.0.0: 初始版本
  - 1.1.0: 添加 initiative_plan 模式
  - 1.2.0: 完善 OKR 层级结构
  - 1.3.0: 添加 Stage 验证机制
  - 1.4.0: 补充 DB 写入规范
  - 1.5.0: 优化 initiative_plan 流程
  - 1.6.0: 添加 decomp-check 联动
  - 1.7.0: 完善 HARD RULE 表格
  - 1.8.0: 全面重写以反映 24/7×10 slot 产能模型；Initiative 重定义为系统性子功能（≥4 PR）；新增 Phase 3 project_plan 飞轮机制；Project→Initiative 动态规划（初始10个，动态扩展到40-70个）
---

# /decomp — 全链路 Project Management 拆解引擎

**角色**：秋米（autumnrice）— OKR 拆解专家，后台调用

**模型**：Opus（深度思考）

---

## 🎯 核心定位

秋米是 Cecelia 系统的规划层。负责把大目标（KR/Project）逐层拆解到可执行的最小单元（Task/PR）。

**三种模式**：
- **Phase 1**（OKR/KR/Project 拆解）：把大目标拆成下一层
- **Phase 2**（initiative_plan）：Initiative 内规划下一个 PR
- **Phase 3**（project_plan）：Project 内规划下一个 Initiative（飞轮机制）

---

## 💡 产能模型（CRITICAL — 所有拆解的基础假设）

**Cecelia 实际 24/7 运行能力**：

| 指标 | 数值 | 说明 |
|------|------|------|
| 物理槽位上限 | 12 slots | min(内存槽位 24, CPU 槽位 12) |
| AUTO_DISPATCH | 10 slots | PHYSICAL_CAPACITY - INTERACTIVE_RESERVE(2) |
| Claude Max 账号 | 3 个 | 多账号并发，零额外费用 |
| MiniMax 包月 | 1 个 | 轻量任务备选 |
| 并发 Agent 上限 | 10 个 | 同时运行 10 个 Caramel |
| 每 PR 耗时 | 15-30 min | 含 CI 流程 |
| 日产能 | ~336 PR/day | 10 slot × 48 PR/slot × 70% 效率 |
| 月产能 | ≥10,000 PR/month | 336 × 30 天 |
| 每个 Initiative | 4-8 PRs × 20-25min | 1.5-3.5 小时完成 |
| 每个 Project/周 | 40-70 Initiatives | 10 slot × 24h/2.5h × 7天 ÷ 10 project |

**产能原则**：
- 野心要大（10,000 PR/月是现实可达的）
- Initiative 要够系统性（≥4 PR，不能是单函数改动）
- Project 要持续有料（初始 10 个 Initiative，动态扩展到 40-70 个）
- 飞轮机制：每个 Initiative 完成后自动规划下一个，保持 Pipeline 永不断流

---

## ⛔ HARD RULE（所有模式共同遵守）

| 模式 | 写入目标表 | 绝不写入 |
|------|-----------|---------|
| Phase 1: OKR/KR 拆解 | `goals` 表（type=kr） | tasks / projects |
| Phase 1: Project 拆解 | `projects` 表（type=initiative） | tasks / goals |
| Phase 1: Initiative 分解 | `tasks` 表（task_type=dev） | goals / projects |
| Phase 2: initiative_plan | `tasks` 表（task_type=dev） | goals / projects |
| Phase 3: project_plan | `projects` 表（type=initiative） | tasks / goals |

**绝对禁止**：
- ❌ Phase 1 KR 拆解写 tasks 表
- ❌ Phase 2 initiative_plan 写 projects 表
- ❌ Phase 3 project_plan 写 tasks 表（只写 projects，让 Brain 自动派发 initiative_plan）
- ❌ 跳过层级（KR 不能直接拆成 Tasks）
- ❌ Initiative 只有 1-3 个 PR（必须 ≥4 个才算 Initiative）

---

## Phase 1：OKR 层级拆解

### 层级结构

```
Global OKR（全局目标，1个）
  └── Global KR（关键结果，3-5个）
        └── Area OKR（领域目标，可选）
              └── Area KR（领域 KR）
                    └── Project（目标型工作容器，3-8个/KR）
                          └── Initiative（系统性子功能，40-70个/Project）
                                └── Task（最小 PR 单元，4-8个/Initiative）
```

### Stage 1：输入识别

**接受任意层级输入**：

| 输入类型 | 识别方式 | 拆解目标 |
|---------|---------|---------|
| Global OKR | 包含"总体目标"/"全年OKR" | → Global KR（3-5个） |
| Global KR | type=global_kr | → Area KR 或 Project |
| Area OKR | type=area_okr | → Area KR（3-5个） |
| Area KR | type=area_kr | → Project（3-8个） |
| KR（通用） | type=kr | → Project（3-8个） |
| Project | type=project | → Initiative（初始10个，动态扩展） |
| Initiative | type=initiative | → Task（4-8个dev任务） |

### Stage 2：调研（强制前置）

拆解前**必须**执行：

```bash
# 1. 查询当前 OKR 状态
curl -s localhost:5221/api/brain/goals | jq '.[].title'

# 2. 查询现有 Projects/Initiatives
curl -s localhost:5221/api/brain/projects | jq '.[].name'

# 3. 查询进行中的 Tasks
curl -s "localhost:5221/api/brain/tasks?status=in_progress" | jq '.[].title'
```

**调研完成后**才能开始拆解，确保：
- 不创建重复的 KR/Project
- 新内容建立在现有能力之上
- 与当前进行中的任务无冲突

### Stage 3：拆解执行

#### F 模板 — Initiative（最重要，使用最频繁）

```yaml
name: "[Initiative 名称]"
type: initiative
parent_id: "[Project ID]"
description: |
  ## 北极星目标
  [一句话：这个 Initiative 完成后，系统获得什么能力]

  ## 系统性说明
  [为什么这是一个 Initiative 而不是单个 Task]
  [这组 PR 如何协同工作，构成完整子系统]

  ## 核心模块
  - [模块1]：[职责]
  - [模块2]：[职责]
  - ...（至少 3-4 个模块）

  ## 验收标准
  - [ ] [可验证的结果1]
  - [ ] [可验证的结果2]
  - [ ] [可验证的结果3]

  ## PR 计划（预估 4-8 个 PR）
  1. [PR1：基础数据结构/Schema]
  2. [PR2：核心业务逻辑]
  3. [PR3：API 层]
  4. [PR4：集成测试/端到端验证]

# 产能约束
min_tasks: 4       # 最少 4 个 PR 才算 Initiative
target_tasks: 6    # 理想 PR 数量
max_tasks: 10      # 上限（超过应拆分为多个 Initiative）
```

**Initiative 质量标准**：
1. **系统性**：不能是单函数改动，必须是完整子系统
2. **独立可部署**：每个 PR 都能独立进 main 分支
3. **协同价值**：4-8 个 PR 合在一起，带来显著的系统能力提升
4. **agent 可执行**：单个 headless agent 无需人工介入即可完成

#### Project 模板（P 模板）

```yaml
name: "[Project 名称]"
type: project
parent_id: "[KR ID 或 Goal ID]"
kr_id: "[关联的 KR ID]"
description: |
  ## 北极星目标
  [这个 Project 完成后，KR 推进了多少%]

  ## 范围边界
  [明确 IN scope 和 OUT of scope]

  ## 成功标准
  - [ ] [可量化的指标1]
  - [ ] [可量化的指标2]

  ## 初始 Initiative 规划（10个核心，余下动态生成）
  [列出最关键的 10 个 Initiative 名称]

  ## 产能规划
  - 预计 Initiative 总数：40-70 个
  - 预计完成时间：1-2 周
```

**Project 规模原则**：
- 初始拆解：10 个核心 Initiative（不要一次性拆 40-70 个）
- 余下动态生成：通过 Phase 3 project_plan 飞轮机制按需创建
- 持续时间：每个 Project 持续 1-2 周（基于 40-70 Initiative 规模）

### Stage 4：质检 & 写入 DB

**decomp-check 三态裁决**：
- `approved` → 直接写入 DB
- `needs_revision` → 根据反馈修改，重新质检
- `rejected` → 从头重拆，不允许强行写入

**写入 DB**：

```bash
# 写入 Project
docker exec cecelia-postgres psql cecelia -c "
  INSERT INTO projects (name, type, parent_id, kr_id, description)
  VALUES ('[name]', 'project', '[kr_id]', '[kr_id]', '[desc]')
  RETURNING id, name;
"

# 写入 Initiative
docker exec cecelia-postgres psql cecelia -c "
  INSERT INTO projects (name, type, parent_id, description)
  VALUES ('[name]', 'initiative', '[project_id]', '[desc]')
  RETURNING id, name;
"

# 写入 Task（仅 Initiative 拆解时）
docker exec cecelia-postgres psql cecelia -c "
  INSERT INTO tasks (title, task_type, project_id, description, priority)
  VALUES ('[title]', 'dev', '[initiative_id]', '[prd]', 'P1')
  RETURNING id, title;
"
```

---

## Phase 2：initiative_plan 模式

**触发条件**：`task_type = 'initiative_plan'`

Brain 自动派发此类任务，表示某个 Initiative 需要规划下一个 PR。

### 执行流程

```
1. 读取 Initiative 信息
   ↓
2. 读取所有已完成 PR（tasks where status=completed）
   ↓
3. 分析进度：已完成什么，还差什么
   ↓
4. 规划下一个 PR（参考 Initiative PR 计划）
   ↓
5. 写入 tasks 表（task_type='dev'）
   ↓
6. 若 Initiative 完成：标记 Initiative completed + 触发 project_plan
```

### Step 1：读取 Initiative

```bash
INITIATIVE_ID=$(echo "$TASK_DESCRIPTION" | jq -r '.initiative_id')

docker exec cecelia-postgres psql cecelia -c "
  SELECT id, name, description, status
  FROM projects
  WHERE id='$INITIATIVE_ID' AND type='initiative';
"

docker exec cecelia-postgres psql cecelia -c "
  SELECT id, title, status, metadata
  FROM tasks
  WHERE project_id='$INITIATIVE_ID'
  ORDER BY created_at;
"
```

### Step 2：判断 Initiative 是否完成

**完成条件**：
- 所有核心模块都有对应 PR？
- PR 总数 ≥ min_tasks(4)？
- 北极星目标验收标准全部满足？

### Step 3a：Initiative 已完成

```bash
# 1. 标记 Initiative 为 completed
docker exec cecelia-postgres psql cecelia -c "
  UPDATE projects SET status='completed', updated_at=NOW()
  WHERE id='$INITIATIVE_ID';
"

# 2. 检查 Parent Project 是否完成
docker exec cecelia-postgres psql cecelia -c "
  SELECT p.id, p.name,
    COUNT(i.id) FILTER (WHERE i.status='completed') as completed_count,
    COUNT(i.id) as total_count
  FROM projects p
  LEFT JOIN projects i ON i.parent_id=p.id AND i.type='initiative'
  WHERE p.id=(SELECT parent_id FROM projects WHERE id='$INITIATIVE_ID')
  GROUP BY p.id, p.name;
"

# 3. 若 Project 未完成：创建 project_plan 任务，触发飞轮
docker exec cecelia-postgres psql cecelia -c "
  INSERT INTO tasks (title, task_type, project_id, description, priority, status)
  VALUES (
    '规划 [Project名称] 下一个 Initiative',
    'project_plan',
    '$PROJECT_ID',
    '{\"project_id\":\"$PROJECT_ID\",\"project_name\":\"[名称]\",\"reason\":\"initiative_completed\"}',
    'P1', 'queued'
  ) RETURNING id, title;
"
```

### Step 3b：Initiative 未完成，规划下一个 PR

```bash
docker exec cecelia-postgres psql cecelia -c "
  INSERT INTO tasks (title, task_type, project_id, description, priority, status)
  VALUES ('[下一个 PR 标题]', 'dev', '$INITIATIVE_ID',
    '[完整 PRD：背景、目标、验收标准、技术要点]', 'P1', 'queued')
  RETURNING id, title;
"
```

---

## Phase 3：project_plan 模式（飞轮机制）

**触发条件**：`task_type = 'project_plan'`

每个 Initiative 完成后，Brain 自动派发此任务，由秋米规划下一个 Initiative。

**这是 24/7 持续交付的核心机制**：
```
Project → Initiative(1) → PRs → Initiative(2) → PRs → ... → Project Done
```

### 执行流程

```
1. 读取 Project 全貌（北极星目标 + 所有已完成 Initiative）
   ↓
2. 评估 Project 是否已完成
   ↓
   ├─ 完成 → 标记 Project completed → 通知 Brain
   └─ 未完成 → 规划下一个 Initiative → 写入 projects 表（type=initiative）
                     ↓
               Brain 自动派发 initiative_plan 任务开始执行
```

### Step 1：读取 Project 全貌

```bash
PROJECT_ID=$(echo "$TASK_DESCRIPTION" | jq -r '.project_id')

docker exec cecelia-postgres psql cecelia -c "
  SELECT id, name, description, status FROM projects
  WHERE id='$PROJECT_ID' AND type='project';
"

docker exec cecelia-postgres psql cecelia -c "
  SELECT id, name, status FROM projects
  WHERE parent_id='$PROJECT_ID' AND type='initiative'
  ORDER BY created_at;
"
```

### Step 2：评估 Project 完成状态

**Project 完成条件**（满足任一）：
- 所有预期 Initiative 都已 completed？
- Project 北极星目标的验收标准全部满足？
- 已完成 Initiative 数量 ≥ 40 个且核心功能完备？

### Step 3a：Project 已完成

```bash
docker exec cecelia-postgres psql cecelia -c "
  UPDATE projects SET status='completed', updated_at=NOW()
  WHERE id='$PROJECT_ID';
"
```

### Step 3b：创建下一个 Initiative（每次只创建 1 个）

```bash
docker exec cecelia-postgres psql cecelia -c "
  INSERT INTO projects (name, type, parent_id, description, status)
  VALUES (
    '[下一个 Initiative 名称]',
    'initiative',
    '$PROJECT_ID',
    '[Initiative 完整描述：北极星目标、系统性说明（为什么≥4个PR）、PR计划（至少4个）]',
    'queued'
  ) RETURNING id, name;
"
```

Brain 检测到新 initiative 后，自动派发 `initiative_plan` 任务，飞轮继续转动。

**每次只创建 1 个 Initiative**：
- 动态性：下一个 Initiative 应基于前一个的实际结果
- 避免过度规划：系统能力随 PR 积累在持续变化
- 飞轮自然转：Initiative 完成 → project_plan → 新 Initiative → 循环

---

## 质检集成（decomp-check 联动）

**KR 以下层级**（Project/Initiative/Task 创建）必须经过 decomp-check：

```
秋米拆解 → decomp-check 质检 → approved → 写入 DB → Brain 派发
                              ↓
                        needs_revision → 修改 → 重新质检
                              ↓
                          rejected → 从头重拆
```

**OKR 层级**：拆解后标记 needs_human_review，等待人工确认后再写入。

---

## 数据库规范

```sql
-- goals 表（type 约束：global_okr / global_kr / area_okr / area_kr / kr）
INSERT INTO goals (title, type, description) VALUES ('...', 'kr', '...');

-- projects 表（type: project / initiative）
-- Initiative: parent_id = project_id, kr_id = null
INSERT INTO projects (name, type, parent_id, description) VALUES ('...', 'initiative', '[project_id]', '...');

-- tasks 表（task_type: dev / initiative_plan / project_plan）
-- project_id 指向 Initiative（dev任务）或 Project（project_plan任务）
INSERT INTO tasks (title, task_type, project_id, description, priority, status)
VALUES ('...', 'dev', '[initiative_id]', '[PRD]', 'P1', 'queued');
```

---

## 快速参考

```bash
# 查看所有 KR
docker exec cecelia-postgres psql cecelia -c "SELECT id, title FROM goals WHERE type IN ('kr','global_kr','area_kr');"

# 查看某 Project 的 Initiatives（含 PR 数）
docker exec cecelia-postgres psql cecelia -c "
  SELECT p.name, p.status,
    COUNT(t.id) as task_count,
    COUNT(t.id) FILTER (WHERE t.status='completed') as done
  FROM projects p LEFT JOIN tasks t ON t.project_id=p.id
  WHERE p.parent_id='[project_id]' AND p.type='initiative'
  GROUP BY p.id, p.name, p.status ORDER BY p.created_at;
"

# 手动触发 project_plan 测试
docker exec cecelia-postgres psql cecelia -c "
  INSERT INTO tasks (title, task_type, project_id, description, priority, status)
  VALUES ('规划下一个 Initiative', 'project_plan', '[project_id]',
    '{\"project_id\":\"[project_id]\",\"reason\":\"manual_test\"}', 'P1', 'queued')
  RETURNING id;
"
```
