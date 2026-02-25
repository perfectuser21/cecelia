---
name: okr
description: |
  OKR 统一拆解工具。支持 6 层层级识别（Global OKR → Area OKR → KR → Project → Initiative），
  自动判断输入层级，逐层拆解到 Initiative（Task 由 Brain 自动拆解，秋米不做这层）。
---

> **CRITICAL LANGUAGE RULE（语言规则）: 所有输出必须使用简体中文。包括步骤说明、状态更新、日志信息、错误报告。严禁使用日语、韩语或任何其他语言，即使在无头（headless）子进程中也必须遵守。**

# OKR Unified Decomposition

---

## ⛔ 铁律：信息收集门禁（所有拆解必须先过这道门）

**在任何一层的拆解开始前，必须严格执行以下 3 步。缺一不可。**

```
Step A: 现状探索（AI 主动执行，不等用户）
  → 查 Brain DB 已有的 Goals / Projects / Tasks
  → 查相关仓库代码的当前实现状态
  → 查已有 Capabilities
  → 目的：了解"我们现在在哪里"

Step B: 信息采集（如果有任何一项不清楚，必须问用户，不能自己猜）
  → 每个层级有固定的必问清单（见下方）
  → 问法：一次性列出所有问题，等用户回答
  → 不允许："我假设 X"、"可能是 Y"、"先按 Z 来"

Step C: 确认检查点（写入 DB 前必须展示计划，等用户确认）
  → 展示将要创建的完整内容列表
  → 明确说："以上内容确认后才执行写入，请确认？"
  → 用户说"确认"/"ok"/"go"/"继续" → 才开始写
  → 用户提出修改 → 修改后再展示，再确认
```

**⛔ 禁止跳过任何一步。信息不全 → 必须问，不能猜。**

---

## 各层级必问清单

### Layer 1 → 2（Global OKR → Area OKR）拆解前必问

| # | 必问问题 | 为什么不能猜 |
|---|---------|------------|
| 1 | 这个 O 的核心方向是什么？（用一句话定义成功） | 方向决定所有下层拆解 |
| 2 | 涉及哪些 Area？（Cecelia / ZenithJoy / 其他） | 决定拆几个 Area OKR |
| 3 | 哪些 Area 不在这个 O 的范围内？ | 防止范围蔓延 |
| 4 | 时间跨度是多少？（Q1 / 这个月 / 具体到哪天） | 影响 KR 的度量周期 |

### Layer 2 → 3（Area OKR → KR）拆解前必问

| # | 必问问题 | 为什么不能猜 |
|---|---------|------------|
| 1 | 这个 Area OKR 最关键的 2-3 个成果是什么？ | KR 要反映真正关键的东西 |
| 2 | 每个 KR 的当前基线是多少？（现在是 X） | 没基线的 KR 是废的 |
| 3 | 目标值是多少？（要到 Y） | 没目标值的 KR 是废的 |
| 4 | 怎么度量？谁来度量？多久度量一次？ | 不可验证的 KR 没意义 |

### Layer 3 → 4（KR → Project）拆解前必问

| # | 必问问题 | 为什么不能猜 |
|---|---------|------------|
| 1 | 这个 KR 涉及哪些仓库？ | 仓库范围决定 Project 边界 |
| 2 | 每个仓库现在做到什么程度了？（AI 先去查代码，用户补充） | 不了解现状拆出来是空中楼阁 |
| 3 | 有没有已有能力可以复用？（AI 查 capabilities） | 防止重复建设 |
| 4 | 预计需要几个 Project？分别覆盖哪块？ | 边界模糊的 Project 会失控 |

### Layer 4 → 5（Project → Initiative）拆解前必问

| # | 必问问题 | 为什么不能猜 |
|---|---------|------------|
| 1 | （AI 必须先读仓库代码）现在这块代码是什么状态？ | 不读代码不知道要改什么 |
| 2 | 这个 Project 最终交付的是什么？（DoD 是什么） | 没有终态，拆出来的 Initiative 方向错 |
| 3 | Initiative 之间有没有依赖顺序？ | 顺序错了执行会卡死 |
| 4 | 有没有不做的部分？（Out of Scope） | 边界不清会无限扩张 |

---

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
- 拆解方向: 创建 Initiative，Brain 自动拆解 Task
```

---

## Pre-flight Checks (拆解前强制检查)

**在开始任何拆解之前，必须执行以下检查（在完成上方"信息收集门禁"的 3 步之后）：**

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

### Layer 4 → Layer 5: Project → Initiative（秋米拆解止步于此）

**触发条件**: 识别为 Project（1-2 周功能模块）

**规则**:
1. 每个 Initiative 对应 1-2 小时的工作
2. **建议拆为 3-8 个 Initiative**（不强制，根据实际复杂度）
3. Initiative 之间可以有依赖（sequence 字段）
4. **Initiative 是秋米拆解的最小单位**——Task 由 Brain 的 "Initiative 拆解" 机制自动创建

**API 调用**:
```bash
# 创建 Initiative（parent_id → Project）
curl -X POST localhost:5221/api/brain/action/create-project -H 'Content-Type: application/json' \
  -d '{"name": "...", "type": "initiative", "parent_id": "<project_id>", "goal_id": "<kr_id>", "description": "..."}'
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
  "next_step": "Initiative 已入队，Brain tick 自动创建 Task 并调度执行"
}
```

**⛔ 秋米不创建 Task** — Task 由 Brain 的 Initiative 拆解机制负责。

---

## Stage 2: Decomposition Execution

**根据识别的层级，执行拆解。**

### 2.1 Query Existing Data

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

### 2.2 Auto-Link to Parent Layers

**拆解时自动关联到上层**：

```
用户说: "给 cecelia-core 加个可观测性 API"
    ↓
识别: Layer 5 (Initiative)
    ↓
自动查找:
  - 哪个 Project 包含 cecelia-core? → Project ID
  - 该 Project 关联哪个 KR? → KR ID
    ↓
创建 Initiative 时自动设置:
  - parent_id → Project ID
  - goal_id → KR ID
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

### 2.3 PR Plan Generation (Optional)

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
- Layer 3 (KR) scope evolves after first Project completes

### 6.2 Flow

```
秋米创建 Initiative
    ↓
Brain tick 创建 Task 并执行
    ↓
Task 结果反馈 → 秋米读取结果 → 调整剩余 Initiative
    ↓
Brain 继续拆解下一批 Task
    ↓
直到所有 Initiative 完成
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
创建 Initiative: "给 cecelia-core 加日志功能"（带完整描述）
    ↓
输出: 创建了 1 个 Initiative
      Brain tick 自动创建 Task 并调度
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
识别: Layer 5 (Initiative) — 单仓库具体改动，归为 Initiative
    ↓
创建 Initiative: "修复 tick.js 空指针"（含描述和复现步骤）
    ↓
输出: 创建了 1 个 Initiative
      Brain tick 自动创建 dev Task 并调度
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
2. **Stop at Initiative** — 秋米只拆到 Initiative，Task 由 Brain 自动创建
3. **Auto-link parents** — 自动关联到上层 OKR/Project
4. **Quality validation** — 每次拆解后验证质量
5. **Trust the hierarchy** — 每层只拆到下一层，不跳层

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
