---
name: okr
description: |
  OKR 统一拆解工具。支持 6 层层级识别（Global OKR → Area OKR → KR → Project → Initiative → Task），
  自动判断输入层级，逐层拆解到可执行 Task。Exploratory 优先策略。
---

> **CRITICAL LANGUAGE RULE（语言规则）: 所有输出必须使用简体中文。包括步骤说明、状态更新、日志信息、错误报告。严禁使用日语、韩语或任何其他语言，即使在无头（headless）子进程中也必须遵守。**

# OKR Unified Decomposition

## Stage 0: Layer Identification (MUST DO FIRST)

**在做任何拆解之前，必须先识别用户输入属于哪个层级。**

### 6-Layer Hierarchy (SSOT: DEFINITION.md Section 4.1)

```
Layer 1: Global OKR  (goals, type='global_okr')  — 3 个月（季度）
Layer 2: Area OKR    (goals, type='area_okr')     — 1 个月（月度）
Layer 3: KR          (goals, type='kr')            — Key Result（可度量）
Layer 4: Project     (projects, type='project')    — 1-2 周
Layer 5: Initiative  (projects, type='initiative') — 1-2 小时
Layer 6: Task        (tasks)                       — 20 分钟
```

### Time Horizon Detection

| 时间信号 | 判定层级 | 示例 |
|----------|----------|------|
| "这个季度" / "Q1" / "3 个月内" | Layer 1: Global OKR | "Q1 完成 AI 编码能力建设" |
| "这个月" / "月度" / "4 周内" | Layer 2: Area OKR | "本月完成任务调度优化" |
| "可度量的结果" / 有具体指标 | Layer 3: KR | "任务成功率从 60% 提升到 85%" |
| "1-2 周" / 明确的功能模块 | Layer 4: Project | "实现日志聚合系统" |
| "给 xxx 加个 yyy" / 具体改动 | Layer 5: Initiative | "给 cecelia-core 加个 /health 端点" |
| "修复" / "调整" / 20 分钟内 | Layer 6: Task | "修复 tick.js 的空指针" |

### Scope Detection

| 范围信号 | 判定层级 |
|----------|----------|
| 涉及多个 Area / 多个团队 | Layer 1: Global OKR |
| 聚焦一个 Area / 一个领域 | Layer 2: Area OKR |
| 有具体数字目标（%、数量、率） | Layer 3: KR |
| 跨多个仓库或涉及多个 PR | Layer 4: Project |
| 单仓库、1-3 个 PR | Layer 5: Initiative |
| 单 PR 内的一个改动 | Layer 6: Task |

### 识别流程

```
用户输入
    ↓
Step 1: 时间维度判断
    - 有明确时间信号？ → 直接判定层级
    - 没有 → 继续 Step 2
    ↓
Step 2: 范围判断
    - 涉及多 Area？ → Global OKR
    - 聚焦一个 Area？ → Area OKR
    - 有度量指标？ → KR
    - 跨仓库？ → Project
    - 单仓库具体改动？ → Initiative
    - 极小改动？ → Task
    ↓
Step 3: 默认规则
    - 90% 的日常用户输入 → Layer 5 (Initiative)
    - "给 xxx 做个 yyy" 模式 → Initiative
    - 不确定 → 问用户
```

### 识别后输出

识别完成后，必须明确输出：

```
[层级识别结果]
- 输入: "给 cecelia-core 加个可观测性 API"
- 判定层级: Layer 5 (Initiative)
- 判定依据: 单仓库（cecelia-core）、具体功能（API）、1-2 小时工作量
- 拆解方向: Initiative → Task（可能先创建 Exploratory Task）
```

---

## Pre-flight Checks (拆解前强制检查)

**在开始任何拆解之前，必须执行以下检查：**

### 1. 幂等性检查（Idempotency Check）

```bash
# 检查当前 OKR 是否已有子节点（防止重复拆解）
psql -U cecelia -d cecelia -t -c "SELECT COUNT(*) FROM goals WHERE parent_id='<current_okr_id>';" | xargs

# 如果 > 0，立即停止拆解，返回错误：
# "❌ CONSTRAINT VIOLATED: OKR <id> already decomposed (has N children)"
# "建议: 查看已有子节点或删除后重新拆解"
```

### 2. 数量约束检查（Cardinality Check）

根据目标层级，检查对应的数量约束：
- **Area OKR**: 全局最多 7 个
- **KR**: 每个 O 最多 5 个
- **Project/Initiative/Task**: 建议范围，不强制

### 3. 异常处理

当检查失败时：
1. **立即停止拆解流程**
2. **返回详细错误信息**（包括当前状态和建议）
3. **不生成 output.json**（避免写入错误数据）

---

## Stage 1: Layer-Specific Decomposition Rules

**每个层级拆解到下一层的规则不同。**

### Layer 1 → Layer 2: Global OKR → Area OKR

**触发条件**: 识别为 Global OKR（季度目标）

**规则**:
1. 按 **Area（领域）** 拆分
2. 每个 Area OKR 对应一个月度子目标
3. **硬约束（CRITICAL）**：全局最多 7 个 Area OKR（整个系统唯一上限）

**拆解前必须检查**:
```bash
# 检查当前 Area OKR 数量
psql -U cecelia -d cecelia -t -c "SELECT COUNT(*) FROM goals WHERE type='area_okr';" | xargs

# 如果 >= 7，立即停止拆解，返回错误：
# "❌ CONSTRAINT VIOLATED: System already has 7 Area OKRs (max allowed)"
```

**API 调用**:
```bash
# 查看已有 Areas
curl -s localhost:5221/api/brain/status/full | jq '.data.goals'

# 创建 Global OKR
curl -X POST localhost:5221/api/brain/goals -H 'Content-Type: application/json' \
  -d '{"title": "...", "type": "global_okr", "description": "...", "time_horizon": "quarter"}'

# 创建 Area OKR（parent_id → Global OKR）
curl -X POST localhost:5221/api/brain/goals -H 'Content-Type: application/json' \
  -d '{"title": "...", "type": "area_okr", "parent_id": "<global_okr_id>", "time_horizon": "month"}'
```

**输出格式**:
```json
{
  "identified_layer": "global_okr",
  "created": {
    "global_okr": { "id": "...", "title": "..." },
    "area_okrs": [
      { "id": "...", "title": "...", "area": "..." }
    ]
  },
  "next_step": "对每个 Area OKR 继续拆解为 KR"
}
```

### Layer 2 → Layer 3: Area OKR → KR

**触发条件**: 识别为 Area OKR（月度目标）

**规则**:
1. 每个 KR 必须**可度量**（有数字指标）
2. **硬约束（CRITICAL）**：每个 O 最多 5 个 KR（绝对上限）
3. KR 格式: "动词 + 对象 + 从 X 到 Y"

**拆解前必须检查**:
```bash
# 检查父 O 已有的 KR 数量（需要 parent_okr_id）
psql -U cecelia -d cecelia -t -c "SELECT COUNT(*) FROM goals WHERE parent_id='<parent_okr_id>' AND type='kr';" | xargs

# 如果 >= 5，立即停止拆解，返回错误：
# "❌ CONSTRAINT VIOLATED: Parent O already has 5 KRs (max allowed)"
```

**KR 质量标准**:
- 有基线值（from）和目标值（to）
- 有明确的度量方式
- 可在 1-2 周内验证

**API 调用**:
```bash
# 创建 KR（parent_id → Area OKR）
curl -X POST localhost:5221/api/brain/goals -H 'Content-Type: application/json' \
  -d '{"title": "...", "type": "kr", "parent_id": "<area_okr_id>", "metric_from": 60, "metric_to": 85}'
```

**输出格式**:
```json
{
  "identified_layer": "area_okr",
  "created": {
    "krs": [
      { "id": "...", "title": "任务成功率从 60% 提升到 85%", "metric_from": 60, "metric_to": 85 }
    ]
  },
  "next_step": "对每个 KR 继续拆解为 Project"
}
```

### Layer 3 → Layer 4: KR → Project

**触发条件**: 识别为 KR（可度量结果）

**规则**:
1. 每个 Project 对应一个功能模块
2. Project 可跨多个仓库（通过 project_repos 表）
3. **建议拆为 1-3 个 Project**（不强制，根据实际复杂度）
4. 必须先进行 Capability 绑定（见下方）

**Capability 绑定（CRITICAL）**:
```
KR 拆解开始
    ↓
调用 GET /api/brain/capabilities
    ↓
分析 KR 与能力的匹配度
    ↓
├─ 匹配到已有能力 → 设定 capability_id, from_stage, to_stage
└─ 无法匹配 → 生成 capability_proposal → 等待审批
```

**API 调用**:
```bash
# 查看已有 Capabilities
curl -s localhost:5221/api/brain/capabilities | jq '.capabilities[]'

# 创建 Project
curl -X POST localhost:5221/api/brain/projects -H 'Content-Type: application/json' \
  -d '{"name": "...", "type": "project", "description": "...", "repo_path": "/home/xx/perfect21/cecelia/core"}'

# 关联 KR
curl -X POST localhost:5221/api/brain/project-kr-links -H 'Content-Type: application/json' \
  -d '{"project_id": "<project_id>", "kr_id": "<kr_id>"}'
```

**输出格式**:
```json
{
  "identified_layer": "kr",
  "capability": { "id": "task-scheduling", "from_stage": 2, "to_stage": 3 },
  "created": {
    "projects": [
      { "id": "...", "name": "...", "repos": ["cecelia-core", "cecelia-workspace"] }
    ]
  },
  "next_step": "对每个 Project 继续拆解为 Initiative"
}
```

### Layer 4 → Layer 5: Project → Initiative

**触发条件**: 识别为 Project（1-2 周功能模块）

**规则**:
1. 每个 Initiative 对应 1-2 小时的工作
2. **建议拆为 3-8 个 Initiative**（不强制，根据实际复杂度）
3. Initiative 之间可以有依赖（sequence 字段）
4. **Exploratory 优先**：不确定的 Initiative 先创建 Exploratory Task（见 Stage 2）

**API 调用**:
```bash
# 创建 Initiative（parent_id → Project）
curl -X POST localhost:5221/api/brain/initiatives -H 'Content-Type: application/json' \
  -d '{"name": "...", "type": "initiative", "parent_id": "<project_id>", "description": "..."}'
```

**输出格式**:
```json
{
  "identified_layer": "project",
  "created": {
    "initiatives": [
      { "id": "...", "name": "添加 /health 端点", "sequence": 1 },
      { "id": "...", "name": "实现 metric 聚合", "sequence": 2 },
      { "id": "...", "name": "集成 Dashboard API", "sequence": 3 }
    ]
  },
  "next_step": "对每个 Initiative 继续拆解为 Task"
}
```

### Layer 5 → Layer 6: Initiative → Task (MOST COMMON)

**触发条件**: 识别为 Initiative（1-2 小时具体改动）

**这是最常见的拆解路径。用户 90% 的日常输入在这个层级。**

**规则**:
1. 每个 Task 对应 20 分钟的工作
2. **建议拆为 2-5 个 Task**（不强制，根据实际复杂度）
3. **Exploratory 优先策略**（详见 Stage 2）
4. 每个 Task 必须有 task_type
5. PR Plan 可选（简单 Initiative 可跳过）

**Task Types**:
| type | 说明 | Agent | 模型 |
|------|------|-------|------|
| exploratory | 调研探索（不写代码，只输出报告） | Exploratory Agent | Opus |
| dev | 编码实现 | Caramel (/dev) | Opus |
| review | 代码审查 | 审查员 (/review) | Sonnet |
| qa | 质量测试 | 小检 (/qa) | Sonnet |
| audit | 代码审计 | 小审 (/audit) | Sonnet |
| research | 调研分析 (HK) | MiniMax | MiniMax |
| talk | 沟通对话 (HK) | MiniMax | MiniMax |
| data | 数据处理 (HK) | N8N | - |

**输出格式**:
```json
{
  "identified_layer": "initiative",
  "created": {
    "tasks": [
      { "id": "...", "title": "探索: 调研现有 /health 实现方案", "task_type": "exploratory", "order": 1 },
      { "id": "...", "title": "实现 /health 端点", "task_type": "dev", "order": 2 },
      { "id": "...", "title": "审查 /health 实现", "task_type": "review", "order": 3 }
    ]
  },
  "next_step": "Exploratory Task 先执行，结果反馈后再细化 dev Task"
}
```

---

## Stage 2: Exploratory Priority Strategy (CRITICAL)

**拆解 Initiative 为 Task 时，必须遵循 Exploratory 优先策略。**

### 何时创建 Exploratory Task

| 条件 | 创建 Exploratory？ | 说明 |
|------|-------------------|------|
| 涉及不熟悉的代码/模块 | YES | 先摸清现状 |
| 实现方案不确定 | YES | 先调研方案 |
| 涉及多种可能的实现路径 | YES | 先评估利弊 |
| 修改已有系统的核心逻辑 | YES | 先理解影响 |
| 简单修复、已知方案 | NO | 直接 dev |
| 纯文档、配置修改 | NO | 直接 dev |

### Exploratory Task 规范

**Exploratory Task 的产出不是代码，是报告**：

```json
{
  "title": "探索: [具体调研内容]",
  "task_type": "exploratory",
  "description": "调研 [什么]，分析 [什么]，输出方案报告",
  "expected_output": {
    "type": "report",
    "contents": [
      "现状分析（当前代码结构、依赖关系）",
      "方案对比（至少 2 种方案的优缺点）",
      "推荐方案（含理由）",
      "风险评估",
      "实现步骤建议"
    ]
  }
}
```

### Exploratory → Dev 流程

```
1. Exploratory Task 创建并执行
       ↓
2. Agent 输出调研报告（存入 task.result）
       ↓
3. 秋米（/okr）读取报告，基于报告细化后续 dev Task
       ↓
4. dev Task 的 PRD 基于调研结果编写（有据可依）
       ↓
5. dev Task 执行
```

**关键点**：
- Exploratory Task 先执行，后续 Task 保持 draft 状态
- 调研结果可能改变后续 Task 的数量和内容
- 这就是"边做边拆"策略

### 标准拆解模板（Initiative → Tasks）

**模板 A: 需要调研的 Initiative（默认）**
```
Task 1: exploratory — 探索: 调研 [主题]（detailed PRD）
Task 2: dev — 实现 [核心功能]（draft，等 Task 1 结果）
Task 3: dev — 实现 [辅助功能]（draft）
Task 4: review — 审查实现（draft）
```

**模板 B: 方案明确的 Initiative**
```
Task 1: dev — 实现 [功能]（detailed PRD）
Task 2: dev — 编写测试（draft，等 Task 1 完成）
Task 3: review — 审查实现（draft）
```

**模板 C: 简单修复**
```
Task 1: dev — 修复 [问题]（detailed PRD）
```

---

## Stage 3: Decomposition Execution

**根据识别的层级，执行拆解。**

### 3.1 Query Existing Data

在拆解前，查询已有数据避免重复：

```bash
# 查看所有 Goals（Global OKR / Area OKR / KR）
curl -s localhost:5221/api/brain/status/full | jq '.data.goals'

# 查看所有 Projects 和 Initiatives
curl -s localhost:5221/api/brain/projects | jq '.'

# 查看所有 Capabilities
curl -s localhost:5221/api/brain/capabilities | jq '.capabilities[]'

# 查看 queued Tasks（避免重复创建）
curl -s localhost:5221/api/brain/tasks?status=queued | jq '.[].title'
```

### 3.2 Auto-Link to Parent Layers

**拆解时自动关联到上层**：

```
用户说: "给 cecelia-core 加个可观测性 API"
    ↓
识别: Layer 5 (Initiative)
    ↓
自动查找:
  - 哪个 Project 包含 cecelia-core? → Project ID
  - 该 Project 关联哪个 KR? → KR ID
  - 该 KR 关联哪个 Area OKR? → Area OKR ID
    ↓
创建 Initiative 时自动设置:
  - parent_id → Project ID
  - 创建的 Task.goal_id → KR ID
```

**查找逻辑**：
```bash
# 根据 repo 查找 Project
curl -s localhost:5221/api/brain/projects | jq '.[] | select(.repo_path | contains("cecelia-core"))'

# 根据 Project 查找关联 KR
curl -s localhost:5221/api/brain/project-kr-links?project_id=<project_id> | jq '.'
```

如果找不到上层关联，提示用户：
```
[关联缺失]
- 未找到 cecelia-core 对应的 Project
- 建议: 先创建 Project，或指定关联的 KR
- 是否继续（创建独立 Initiative）？
```

### 3.3 PR Plan Generation (Optional)

**当 Initiative 需要多个 PR 时，创建 PR Plans**：

```json
{
  "pr_plans": [
    {
      "title": "PR #1: 添加 /health 端点",
      "dod": ["端点返回 200", "包含 uptime 和 version"],
      "files": ["brain/src/routes.js", "brain/src/__tests__/health.test.js"],
      "sequence": 1,
      "depends_on": [],
      "complexity": "low"
    }
  ]
}
```

**PR Plan 不是必须的**：简单 Initiative（1 个 PR）可跳过 PR Plan 层。

---

## Stage 4: Quality Validation

### 4.1 Run Validation Script

```bash
python3 ~/.claude/skills/okr/scripts/validate-okr.py output.json
```

This generates `validation-report.json` with:
- `form_score` (0-40): Auto-calculated
- `content_hash`: SHA256 of output.json
- `content_score` (0-60): Self-assessment

### 4.2 Self-Assessment (Content Quality)

- **Title Quality** (0-15): 以动词开头 + 具体 + 10-50 字
- **Description Quality** (0-15): >50 字 + 做什么/为什么/怎么做
- **Layer Mapping** (0-15): 层级关联正确，parent_id 正确
- **Completeness** (0-15): 无遗漏，考虑边界

### 4.3 Validation Loop (with Constraint Checks)

**v8.1.0+: Now includes hard constraint validation**

```bash
# Step 1: Run validation script
python3 ~/.claude/skills/okr/scripts/validate-okr.py output.json

# Exit codes:
#   0 = Passed (total >= 90)
#   1 = Not yet complete (continue loop)
#   2 = HARD CONSTRAINT VIOLATED (stop immediately)

# Step 2: Check exit code
if [ $? -eq 2 ]; then
    echo "🚫 Constraint violated - cannot proceed"
    exit 1
fi

# Step 3: Continue validation loop
WHILE total < 90:
    - Improve output.json
    - Re-run validate-okr.py
    - Re-assess content quality
END WHILE
```

**Hard Constraints (exit code 2)**:
- Max 5 KRs per O
- Max 7 Area OKRs globally (warning only, need DB verification)
- Required fields: parent_id (for KR/Area), id (for idempotency)

**When Constraint Violated**:
1. **DO NOT continue validation loop**
2. **Fix the constraint issue first** (reduce count, add missing fields)
3. **Re-run Pre-flight Checks** (see above)
4. **Only then proceed with validation**

### 4.4 Anti-patterns

- NEVER manually edit scores without improving content
- NEVER bypass constraint checks
- NEVER skip the validation script
- Hash verification catches any cheating

---

## Stage 5: Store to Database

### 5.1 Store Script

```bash
bash ~/.claude/skills/okr/scripts/store-to-database.sh output.json
```

### 5.2 Graceful Degradation

If Brain service is unavailable:
- Save to `pending-tasks.json`
- Retry later with same script
- OKR Skill still considered successful

---

## Stage 6: Iterative Decomposition (for complex needs)

### 6.1 When to Use

- Layer 4 (Project) with 5+ Initiatives
- Layer 5 (Initiative) with uncertain scope
- Any layer where Exploratory results change the plan

### 6.2 Flow

```
Initial decomposition → only Task 1 has detailed PRD
    ↓
Execute Task 1 (usually Exploratory)
    ↓
Read Task 1 report → adjust remaining Tasks
    ↓
Refine Task 2 PRD (draft → detailed)
    ↓
Execute Task 2 → read report → adjust → ...
    ↓
Until all Tasks complete or Initiative is done
```

### 6.3 Scripts

```bash
# Initial decomposition
bash ~/.claude/skills/okr/scripts/decompose-feature.sh "需求描述"

# Continue after Task N completes
bash ~/.claude/skills/okr/scripts/continue-feature.sh <feature-id> <report.json>
```

---

## Quick Reference: Common Scenarios

### Scenario 1: User says "给 cecelia-core 加个日志功能"

```
识别: Layer 5 (Initiative) — 单仓库、具体功能
    ↓
查找 Project: cecelia-core 对应的 Project
查找 KR: 该 Project 关联的 KR
    ↓
拆解为 Tasks:
  Task 1: exploratory — 调研日志方案（pino vs winston vs 自定义）
  Task 2: dev — 实现日志模块（等 Task 1）
  Task 3: dev — 集成到现有代码
  Task 4: review — 审查日志实现
    ↓
输出: 创建了 1 个 Initiative + 4 个 Tasks（1 exploratory + 2 dev + 1 review）
```

### Scenario 2: User says "本月完成 Brain 保护系统升级"

```
识别: Layer 2 (Area OKR) — "本月"、聚焦一个 Area
    ↓
拆解为 KR:
  KR 1: "告警误报率从 30% 降到 10%"
  KR 2: "Circuit breaker 恢复时间从 5min 降到 1min"
  KR 3: "Watchdog 覆盖率从 70% 提升到 95%"
    ↓
输出: 创建了 1 个 Area OKR + 3 个 KR
下一步: 对每个 KR 继续拆解
```

### Scenario 3: User says "修复 tick.js 的空指针"

```
识别: Layer 6 (Task) — 简单修复、20 分钟
    ↓
直接创建 Task:
  Task: dev — 修复 tick.js 空指针（detailed PRD）
    ↓
输出: 创建了 1 个 Task（直接可执行）
```

### Scenario 4: User says "Q1 完成 AI Coding 能力从 Stage 2 到 Stage 4"

```
识别: Layer 1 (Global OKR) — "Q1"、季度级
    ↓
Capability 绑定: ai-coding, from_stage=2, to_stage=4
    ↓
拆解为 Area OKR:
  Area 1: "月度 1 — 代码生成准确率提升"
  Area 2: "月度 2 — 自动测试覆盖"
  Area 3: "月度 3 — 端到端集成"
    ↓
输出: 创建了 1 个 Global OKR + 3 个 Area OKR
下一步: 对每个 Area OKR 拆解为 KR
```

---

## Core Principles

1. **Layer identification first** — 永远先识别层级，再拆解
2. **Exploratory priority** — 不确定的事先调研，再编码
3. **Auto-link parents** — 自动关联到上层 OKR/Project
4. **边做边拆** — 只详细写下一步，后续保持 draft
5. **Quality validation** — 每次拆解后验证质量
6. **Trust the hierarchy** — 每层只拆到下一层，不跳层

---

## Validation Report Schema

```json
{
  "form_score": "0-40 (auto)",
  "content_score": "0-60 (self-assessment)",
  "content_breakdown": {
    "title_quality": "0-15",
    "description_quality": "0-15",
    "layer_mapping": "0-15",
    "completeness": "0-15"
  },
  "total": "0-100 (form + content)",
  "passed": "total >= 90",
  "content_hash": "SHA256 of output.json",
  "timestamp": "ISO format"
}
```
