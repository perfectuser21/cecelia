---
id: decomp-skill
version: 2.1.0
created: 2026-01-01
updated: 2026-03-21
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
  - 1.9.0: 产能数据修正（PR 35-40min、~8600 PR/月）；补充 KR→Project 定义（3-4个/KR、周期1周）；OKR 并行说明（2 OKR × 3-4 KR）；Initiative 内 Task 串联定义；多机路由概念
  - 2.0.0: 新增 Scope 层级（Project→Scope→Initiative 三层结构）；引入 Shape Up 方法论 + SPIDR 拆分五刀法；Phase 3 改为 scope_plan 飞轮
  - 2.2.0: 产能模型改为动态查询 capacity-budget API；校准表 PR 数量改为动态值；删除写死的产能数字
  - 2.1.0: 新增拆解粒度校准表（Task/Initiative/Scope/Project PR数量+周期+判断标准+反例说明）；新增 Initiative 技术调研规则（第一个 Task 必须为技术调研 + WebSearch 选型）
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

## 💡 产能模型（CRITICAL — 动态查询，不要写死数字）

**⚠️ 所有产能数字必须从 Brain API 动态获取，禁止使用写死的数字。**

### 拆解前必须执行：查询当前产能

```bash
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
CAPACITY=$(curl -s "$BRAIN_URL/api/brain/capacity-budget" 2>/dev/null)

# 返回值包含：
# - total_slots: 当前可用 slots 数
# - pr_per_slot_per_day: 每 slot 每天的 PR 产出（冷启动=25，会自校准）
# - confidence: theoretical/low/medium/high（数据可信度）
# - layer_budgets: 各层级的 PR 预算
# - areas: 各 Area 的 slot 分配
```

如果 Brain 不可用，使用以下 fallback 值（仅限紧急情况）：
- `pr_per_slot_per_day = 25`（基于 40min/PR, 24h, 70% 效率）
- `total_slots = 8`（保守估计）

### 时间框架（固定不变）

| 层级 | 时间框架 | 说明 |
|------|---------|------|
| Task | ~40min | 单一功能点，1 PR |
| Initiative | 0.5-1 天 | 完整功能块，多模块协同 |
| Scope | 2-3 天 | 功能分组/边界 |
| Project | 1 周 | 业务目标 |
| KR | 1 个月 | 可量化结果 |

### PR 数量（动态计算）

**PR 数量 = 时间框架 × pr_per_slot_per_day × 分配的 slots**

拆解时从 `layer_budgets` 读取各层级的 PR 预算，不要自己算。

### 产能原则

- Initiative 要够系统性（≥4 PR，不能是单函数改动）
- Project 规模由 `layer_budgets.project.pr_count_per_slot` 确定
- 飞轮机制：每个 Initiative 完成后自动规划下一个，保持 Pipeline 永不断流
- `confidence` 为 `theoretical` 时，拆解粒度留更大容差（±50%）
- `confidence` 为 `high` 时，严格按数字拆（±20%）

### 多机路由

- Claude Code /dev 任务：美国 Mac mini M4
- Codex 任务（codex_qa/codex_dev/pr_review）：西安 Mac mini M4
- 所有任务类型见 `task-router.js` LOCATION_MAP

---

## 拆解粒度校准表（CRITICAL — 动态校准）

**⚠️ PR 数量必须从 capacity-budget API 的 `layer_budgets` 获取，不要使用写死的数字。**

| 层级 | 时间框架（固定） | PR 数量（动态） | 判断标准 |
|------|-----------------|----------------|----------|
| Task | ~40min | 1 PR（固定） | 单一功能点，一次 Pipeline 跑通 |
| Initiative | 0.5-1 天 | `layer_budgets.initiative.pr_count_per_slot` | 一个完整功能块，多个模块协同 |
| Scope | 2-3 天 | `layer_budgets.scope.pr_count_per_slot` | 一个功能分组/边界 |
| Project | 1 周 | `layer_budgets.project.pr_count_per_slot` | 一个业务目标 |

**反例说明（拆解完必须自检）**：

- 如果一个"Initiative"只需要 1-2 个 PR → **降级为 Task**，直接作为单个 PR 执行
- 如果一个"Initiative"的 PR 数超过 Scope 级别的预算 → **升级为 Scope**
- 如果一个"Task"需要改 20+ 文件 → 可能是 Initiative 级别，应拆分为多个 Task

**校准检查时机**：
- Phase 1 拆解完成后，对照 `layer_budgets` 校验
- decomp-check 质检时，调用 capacity-budget API 检查 PR 数量是否在合理区间
- 飞轮规划（Phase 2/3/4）时，发现粒度偏差及时调整

---

## Initiative 技术调研规则（CRITICAL — 执行前置步骤）

**每个 Initiative 的第一个 Task 必须是"技术调研"**。

### 规则

1. Initiative 拆解出的 Task 列表中，**第一个 Task 固定为技术调研**
2. 技术调研 Task 使用 WebSearch 搜索 GitHub 上该领域最新的开源方案、最佳实践、最新 release
3. 输出技术选型报告，后续 PR 基于此选型开发

### 技术调研 Task 模板

```yaml
title: "[Initiative名称] 技术调研"
task_type: dev
description: |
  ## 目标
  调研 [领域] 的最新技术方案和最佳实践

  ## 调研内容
  1. 使用 WebSearch 搜索 GitHub 上相关领域的开源项目
  2. 对比主流方案的优劣（star 数、最近更新、社区活跃度）
  3. 查看最新 release 的 changelog，确认 API 稳定性
  4. 搜索最佳实践文章和官方文档

  ## 产出物
  在 PR 描述中输出技术选型报告：
  - 候选方案对比表
  - 推荐方案及理由
  - 已知风险和 fallback 方案
  - 关键 API/接口文档链接

  ## 验收标准
  - [ ] 至少对比 3 个候选方案
  - [ ] 推荐方案有明确理由
  - [ ] 后续 Task 的 PRD 引用此选型结论
```

### 例外情况

以下情况可跳过技术调研：
- 纯配置/文档类 Initiative（无代码逻辑）
- 技术栈已在项目中使用且成熟（如内部模块重构）
- Initiative 的 PR 计划中第一个本身就是 Spike 研究

### F 模板更新

Initiative 拆解时，PR 计划的第一项应为技术调研：

```
## PR 计划（预估 5-8 个 PR）
1. [PR1：技术调研 — WebSearch 调研方案 + 技术选型报告]
2. [PR2：基础数据结构/Schema]
3. [PR3：核心业务逻辑]
4. [PR4：API 层]
5. [PR5：集成测试/端到端验证]
```

---

## ⛔ HARD RULE（所有模式共同遵守）

| 模式 | 写入目标表 | 绝不写入 |
|------|-----------|---------|
| Phase 1: OKR/KR 拆解 | `goals` 表（type=kr） | tasks / projects |
| Phase 1: Project 拆解 | `projects` 表（type=scope） | tasks / goals |
| Phase 1: Scope 拆解 | `projects` 表（type=initiative） | tasks / goals |
| Phase 1: Initiative 分解 | `tasks` 表（task_type=dev） | goals / projects |
| Phase 2: initiative_plan | `tasks` 表（task_type=dev） | goals / projects |
| Phase 3: scope_plan | `projects` 表（type=initiative） | tasks / goals |
| Phase 4: project_plan | `projects` 表（type=scope） | tasks / goals |

**绝对禁止**：
- ❌ Phase 1 KR 拆解写 tasks 表
- ❌ Phase 2 initiative_plan 写 projects 表
- ❌ Phase 3 scope_plan 写 tasks 表（只写 projects type=initiative）
- ❌ Phase 4 project_plan 写 tasks 表（只写 projects type=scope）
- ❌ 跳过层级（KR 不能直接拆成 Tasks，Project 不能直接拆成 Initiative）
- ❌ Initiative 只有 1-3 个 PR（必须 ≥4 个才算 Initiative）
- ❌ Project 直接包含 Initiative（必须经过 Scope 层）

---

## Phase 1：OKR 层级拆解

### 层级结构

```
Global OKR（全局目标，1个）
  └── Global KR（关键结果，3-5个）
        └── Area OKR（领域目标，可选）
              └── Area KR（领域 KR）
                    └── Project（目标型工作容器，3-4 个 Project/KR，周期 1 周）
                          └── Scope（功能边界分组，3-4 个/Project，2-3 天）  ← NEW
                                └── Initiative（系统性子功能，3-7个/Scope，1-2 小时 pipeline）
                                      └── Task（最小 PR 单元，4-8个/Initiative，串联执行）
```

**KR→Project 定义**：
- 每个 KR 拆解为 3-4 个 Project
- 每个 Project 周期 = 1 周
- 每个 KR 约占 1 个 slot，串行完成 3-4 个 Project

**OKR 并行说明**：
- 系统同时支持 2 个 Area OKR 并行
- 2 OKR × 3 KR = 6 slot（舒服运行）
- 2 OKR × 4 KR = 8 slot（刚好饱和）
- 留 2 slot 余量给非开发任务（反刍、规划、监控等）

**Initiative 执行模型**：
- Initiative 内的 Task 是串联的（有顺序依赖，前一个 PR 合并后才开始下一个）
- Initiative 之间可以并行（不同 Initiative 分配到不同 slot）
- 这意味着单个 Initiative 的完成时间 = sum(所有 Task 耗时)，不可压缩

### Stage 1：输入识别

**接受任意层级输入**：

| 输入类型 | 识别方式 | 拆解目标 |
|---------|---------|---------|
| Global OKR | 包含"总体目标"/"全年OKR" | → Global KR（3-5个） |
| Global KR | type=global_kr | → Area KR 或 Project |
| Area OKR | type=area_okr | → Area KR（3-5个） |
| Area KR | type=area_kr | → Project（3-8个） |
| KR（通用） | type=kr | → Project（3-8个） |
| Project | type=project | → Scope（3-4个，功能边界分组） |
| Scope | type=scope | → Initiative（3-7个，动态扩展） |
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

  ## PR 计划（预估 5-8 个 PR）
  1. [PR1：技术调研 — WebSearch 调研方案 + 技术选型报告]
  2. [PR2：基础数据结构/Schema]
  3. [PR3：核心业务逻辑]
  4. [PR4：API 层]
  5. [PR5：集成测试/端到端验证]

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

#### Scope 模板（S 模板）— 功能边界分组

```yaml
name: "[Scope 名称]"
type: scope
parent_id: "[Project ID]"
description: |
  ## 功能边界
  [这个 Scope 覆盖什么功能范围，2-3天完成]

  ## 交付物
  [这组 Initiative 完成后，系统获得什么能力]

  ## Initiative 规划（3-7 个）
  1. [Initiative 1 名称]
  2. [Initiative 2 名称]
  3. [Initiative 3 名称]
  ...

  ## 完成条件
  - [ ] [所有 Initiative 的验收标准全部通过]
```

**Scope 质量标准**：
1. **按功能边界分**：不按"前端/后端"分，按用户可感知的功能分
2. **2-3 天粒度**：每个 Scope 2-3 天可完成
3. **3-4 个/Project**：一个 1 周 Project 分 3-4 个 Scope
4. **命名清晰**：用"用户能做什么"命名，如"用户能填表单"而不是"前端开发"

**SPIDR 拆分五刀法**（Scope → Initiative 时使用）：

| 刀法 | 说明 | 适用场景 | 例子 |
|------|------|---------|------|
| **S**pike | 先研究再做 | 技术方案不确定 | "调研 Stripe API 方案" → 再写代码 |
| **P**ath | 按用户路径分 | 多种操作方式 | 复制链接 / 分享到微博 / 自定义分享 |
| **I**nterface | 按界面版本分 | UI 复杂度递增 | v1 纯表单 → v2 加动画 → v3 完整 UX |
| **D**ata | 按数据类型分 | 多种数据格式 | 先支持 MP4 → 再加 WebM → 再加 MKV |
| **R**ules | 按业务规则分 | 渐进加严 | 先零验证 → 加基础校验 → 加安全检测 |

**使用时机**：当一个 Scope 需要拆成 Initiative 时，用 SPIDR 五刀法选择最合适的切割维度。

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

  ## 初始 Scope 规划（3-4 个功能边界分组）
  [列出功能边界分组]

  ## 产能规划
  - 预计 Scope 总数：3-4 个
  - 每个 Scope 含 3-7 个 Initiative
  - 预计完成时间：1 周
```

**Project 规模原则**：
- 拆解为 3-4 个 Scope（按功能边界分组）
- 每个 Scope 再拆 3-7 个 Initiative
- 渐进式拆解：先拆 Scope，执行到某个 Scope 时再拆其下的 Initiative
- 持续时间：每个 Project 持续 1 周

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

## Phase 3：scope_plan 模式（Scope 飞轮机制）

**触发条件**：`task_type = 'scope_plan'`

每个 Initiative 完成后，Brain 自动派发此任务，由秋米规划当前 Scope 的下一个 Initiative。

**这是 24/7 持续交付的核心机制**：
```
Scope → Initiative(1) → PRs → Initiative(2) → PRs → ... → Scope Done → project_plan
```

### 执行流程

```
1. 读取 Scope 全貌（功能边界 + 所有已完成 Initiative）
   ↓
2. 评估 Scope 是否已完成
   ↓
   ├─ 完成 → 标记 Scope completed → 触发 project_plan
   └─ 未完成 → 规划下一个 Initiative → 写入 projects 表（type=initiative）
                     ↓
               Brain 自动派发 initiative_plan 任务开始执行
```

### Step 1：读取 Scope 全貌

```bash
SCOPE_ID=$(echo "$TASK_DESCRIPTION" | jq -r '.scope_id')

docker exec cecelia-postgres psql cecelia -c "
  SELECT id, name, description, status FROM projects
  WHERE id='$SCOPE_ID' AND type='scope';
"

docker exec cecelia-postgres psql cecelia -c "
  SELECT id, name, status FROM projects
  WHERE parent_id='$SCOPE_ID' AND type='initiative'
  ORDER BY created_at;
"
```

### Step 2：评估 Scope 完成状态

**Scope 完成条件**（满足任一）：
- 所有 Initiative 都已 completed？
- Scope 交付物验收标准全部满足？

### Step 3a：Scope 已完成

```bash
# 1. 标记 Scope 为 completed
docker exec cecelia-postgres psql cecelia -c "
  UPDATE projects SET status='completed', updated_at=NOW()
  WHERE id='$SCOPE_ID';
"

# 2. 触发 project_plan，检查 Project 是否需要下一个 Scope
docker exec cecelia-postgres psql cecelia -c "
  INSERT INTO tasks (title, task_type, project_id, description, priority, status)
  VALUES (
    '规划 [Project名称] 下一个 Scope',
    'project_plan',
    (SELECT parent_id FROM projects WHERE id='$SCOPE_ID'),
    '{\"project_id\":\"' || (SELECT parent_id FROM projects WHERE id='$SCOPE_ID') || '\",\"reason\":\"scope_completed\"}',
    'P1', 'queued'
  ) RETURNING id, title;
"
```

### Step 3b：Scope 未完成，创建下一个 Initiative

```bash
docker exec cecelia-postgres psql cecelia -c "
  INSERT INTO projects (name, type, parent_id, description, status)
  VALUES (
    '[下一个 Initiative 名称]',
    'initiative',
    '$SCOPE_ID',
    '[Initiative 完整描述]',
    'queued'
  ) RETURNING id, name;
"
```

**每次只创建 1 个 Initiative**：
- 动态性：下一个 Initiative 应基于前一个的实际结果
- 使用 SPIDR 刀法选择切割维度
- 飞轮自然转：Initiative 完成 → scope_plan → 新 Initiative → 循环

---

## Phase 4：project_plan 模式（Project 飞轮机制）

**触发条件**：`task_type = 'project_plan'`

每个 Scope 完成后，Brain 自动派发此任务，由秋米规划下一个 Scope。

```
Project → Scope(1) → Initiatives → Scope(2) → Initiatives → ... → Project Done
```

### 执行流程

```
1. 读取 Project 全貌（北极星目标 + 所有已完成 Scope）
   ↓
2. 评估 Project 是否已完成
   ↓
   ├─ 完成 → 标记 Project completed → 通知 Brain
   └─ 未完成 → 规划下一个 Scope → 写入 projects 表（type=scope）
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
  WHERE parent_id='$PROJECT_ID' AND type='scope'
  ORDER BY created_at;
"
```

### Step 2：评估 Project 完成状态

**Project 完成条件**（满足任一）：
- 所有 Scope 都已 completed？
- Project 北极星目标的验收标准全部满足？

### Step 3a：Project 已完成

```bash
docker exec cecelia-postgres psql cecelia -c "
  UPDATE projects SET status='completed', updated_at=NOW()
  WHERE id='$PROJECT_ID';
"
```

### Step 3b：创建下一个 Scope（每次只创建 1 个）

```bash
curl -s -X POST http://localhost:5221/api/brain/action/create-scope \
  -H "Content-Type: application/json" \
  -d '{
    "name": "[下一个 Scope 名称]",
    "parent_id": "'$PROJECT_ID'",
    "description": "[Scope 完整描述：功能边界、交付物、Initiative 规划]"
  }'
```

**每次只创建 1 个 Scope**：
- 动态性：下一个 Scope 应基于前一个的实际结果
- 渐进精化：做到哪里拆到哪里
- 飞轮自然转：Scope 完成 → project_plan → 新 Scope → 循环

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

-- projects 表（type: project / scope / initiative）
-- Scope: parent_id = project_id, decomposition_depth = 1
INSERT INTO projects (name, type, parent_id, description, decomposition_depth)
VALUES ('...', 'scope', '[project_id]', '...', 1);

-- Initiative: parent_id = scope_id, decomposition_depth = 2
INSERT INTO projects (name, type, parent_id, description, decomposition_depth)
VALUES ('...', 'initiative', '[scope_id]', '...', 2);

-- tasks 表（task_type: dev / initiative_plan / scope_plan / project_plan）
-- project_id 指向 Initiative（dev任务）、Scope（scope_plan）或 Project（project_plan）
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
