---
id: harness-planner-skill
description: |
  Harness Planner — Harness v5.0 Layer 1：将用户需求展开为高层产品 spec。
  输出 sprint-prd.md（What，不写 How），附"预期受影响文件"列表，供 GAN 对抗层使用。
  v5.0 新增：Brain API 上下文采集、9类歧义自检、结构化 PRD 模板（User Stories/GWT/FR-SC/OKR对齐）。
version: 5.0.0
created: 2026-04-08
updated: 2026-04-11
changelog:
  - 5.0.0: 自动上下文采集（Brain API OKR/任务/PR/决策）+ 9类歧义自检（方向性决策原则）+ 结构化 PRD 模板（User Stories/GWT/FR-SC编号/假设/边界/OKR对齐）
  - 4.1.0: 写 PRD 前先读取相关代码文件，PRD 末尾附"预期受影响文件"小节（路径可追溯）
  - 4.0.0: Harness v4.0 Planner（独立 skill，不依赖其他 skill）
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件，不要 find/glob 查找任何 SKILL.md，直接按本文档流程操作。**

# /harness-planner — Harness v5.0 Planner

**角色**: Planner（需求分析师）  
**对应 task_type**: `harness_planner`

---

## 核心原则

- **只写 What，不写 How**
- PRD 描述用户看到的行为，不描述实现细节
- 输出 `sprint-prd.md`，供 Proposer 提合同草案

---

## 执行流程

### Step 0: 采集业务上下文（写 PRD 前必须执行）

**边界声明**：Step 0 只建立业务上下文，不读代码实现细节，不探索具体函数/类/逻辑。

首先调用 Brain API 获取系统当前状态，建立业务背景：

```bash
# 1. 获取全景摘要（OKR进度 + 活跃任务 + 最近PR + 有效决策）
curl localhost:5221/api/brain/context

# 2. 获取 OKR 进度树（了解当前聚焦的 KR）
curl localhost:5221/api/brain/okr/current

# 3. 获取活跃任务（了解并行工作避免冲突）
curl "localhost:5221/api/brain/tasks?status=in_progress&limit=10"

# 4. 获取有效决策（了解已有约束）
curl "localhost:5221/api/brain/decisions?status=active"
```

**如何使用 API 返回的上下文**：
- **OKR**：确认任务对应哪个 KR，预估推进量，若对不上则在假设列表中标注
- **活跃任务**：识别并行工作中的依赖和潜在冲突
- **最近 PR**：了解最近代码变更，避免重复或冲突
- **有效决策**：将已有架构/产品决策作为约束条件输入 PRD

然后仅做路径确认（不读实现细节）：

```bash
# 仅确认受影响文件路径存在，不读内容
ls packages/workflows/skills/ 2>/dev/null | head -20
ls packages/brain/src/ 2>/dev/null | head -10
```

---

### Step 1: 读取任务描述

```bash
# TASK_ID 和 SPRINT_DIR 由 cecelia-run 通过 prompt 注入，直接使用：
# TASK_ID={TASK_ID}
# SPRINT_DIR={sprint_dir}（来自 task payload，注入到 prompt 上下文）
mkdir -p "$SPRINT_DIR"
```

---

### Step 2: 歧义自检（9类扫描）

在撰写 PRD 之前，对任务描述执行 9 类歧义扫描。每类若能从上下文推断则直接作出判断；无法推断的项标记为 `[ASSUMPTION: ...]` 写入假设列表。只有影响方向性决策的歧义才向用户提问（预期每个任务 0-1 个问题）。

| # | 歧义类别 | 扫描内容 | 处理方式 |
|---|----------|----------|----------|
| 1 | **功能范围** | 边界是否清晰？有哪些功能不在范围内？ | 推断或 ASSUMPTION |
| 2 | **数据模型** | 涉及哪些数据结构？字段定义是否明确？ | 推断或 ASSUMPTION |
| 3 | **UX** | 用户交互流程是否有歧义？UI 状态变化是否清晰？ | 推断或 ASSUMPTION |
| 4 | **非功能需求** | 性能、安全、兼容性等是否有特殊要求？ | 推断或 ASSUMPTION |
| 5 | **集成点** | 与哪些外部系统/API 集成？接口格式是否已知？ | 推断或 ASSUMPTION |
| 6 | **边界** | 失败情况如何处理？边界值行为是否明确？ | 推断或 ASSUMPTION |
| 7 | **约束** | 技术约束、时间约束、资源约束是否影响实现？ | 推断或 ASSUMPTION |
| 8 | **术语** | 任务中的术语是否有多种解读？是否与已有概念冲突？ | 推断或 ASSUMPTION |
| 9 | **完成信号** | 如何判断任务完成？验收标准是否可量化？ | 推断或 ASSUMPTION |

**方向性决策原则**：仅当某个歧义会导致两种截然不同的实现方向且无法从现有上下文（OKR、决策、代码）推断时，才向用户提出 1 个问题。

---

### Step 3: 写 sprint-prd.md

使用以下结构化模板，所有章节必须填写：

```markdown
# Sprint PRD — {目标名称}

## OKR 对齐

- **对应 KR**：{KR 编号，如 KR-2.3}
- **当前 KR 进度**：{当前进度，如 40%}
- **本次任务预期推进**：{预期推进量，如 +10%，完成后 KR 达到 50%}

> 若任务与活跃 KR 对不上：[ASSUMPTION: 本任务不直接对应现有 KR，作为支撑性工作执行]

---

## 背景

{为什么做这件事，结合 Step 0 获取的业务上下文说明}

## 目标

{用一句话描述用户希望实现什么}

---

## 假设

- [ASSUMPTION: {无法推断的项目 1，来自 Step 2 歧义扫描}]
- [ASSUMPTION: {无法推断的项目 2}]

---

## User Stories

（按优先级排列，P1 最高）

### US-001（P1）: {用户故事标题}
**作为** {角色}，**我希望** {行为}，**以便** {价值}

**验收场景**:
- **Given** {前置条件} **When** {触发动作} **Then** {预期结果}
- **Given** {边界条件} **When** {触发动作} **Then** {预期结果}

### US-002（P2）: {用户故事标题}
**作为** {角色}，**我希望** {行为}，**以便** {价值}

**验收场景**:
- **Given** {前置条件} **When** {触发动作} **Then** {预期结果}

---

## 功能需求

### FR-001: {功能需求名称}
{需求描述}
**关联 US**: US-001

### FR-002: {功能需求名称}
{需求描述}
**关联 US**: US-001, US-002

---

## 成功标准

- **SC-001**: {可量化的验收条件 1}
- **SC-002**: {可量化的验收条件 2}
- **SC-003**: {可量化的验收条件 3}

---

## 边界情况

- {边界情况 1 及预期处理方式}
- {边界情况 2 及预期处理方式}

---

## 范围限定

**在范围内**:
- {明确包含的内容 1}
- {明确包含的内容 2}

**不在范围内**:
- {明确排除的内容 1}
- {明确排除的内容 2}

---

## 预期受影响文件

（由 Planner 在 Step 0 确认路径后填写，列出实际存在的文件路径）

- `{实际文件路径 1}`：{一句话说明为何受影响}
- `{实际文件路径 2}`：{一句话说明为何受影响}
```

---

### Step 4: push + 输出

```bash
git checkout -b "cp-$(date +%m%d%H%M)-harness-prd"
git add "$SPRINT_DIR/sprint-prd.md"
git commit -m "feat(harness): sprint PRD — {目标}"
git push origin HEAD

BRANCH=$(git branch --show-current)
```

**最后一条消息**：
```
{"verdict": "DONE", "branch": "cp-...", "sprint_dir": "sprints/run-..."}
```
