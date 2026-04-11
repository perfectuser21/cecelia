---
id: harness-planner-skill
description: |
  Harness Planner — Harness v5.0 Layer 1：将用户需求展开为高层产品 spec。
  输出 sprint-prd.md（What，不写 How），附"预期受影响文件"列表，供 GAN 对抗层使用。
version: 5.0.0
created: 2026-04-08
updated: 2026-04-11
changelog:
  - 5.0.0: Step 0 增强（Brain API 业务上下文采集）、9 类歧义自检、PRD 模板 spec-kit 化（User Stories/GWT/FR-SC/假设/边界/OKR 对齐）
  - 4.1.0: 新增 Step 0 — 写 PRD 前先读取相关代码文件，PRD 末尾附"预期受影响文件"小节（路径可追溯）
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

**目的**：先建立业务上下文，再写 PRD。不探索代码实现细节，只读业务状态。

```bash
# 获取系统全景（OKR 进度 + 活跃任务 + 最近 PR + 有效决策）
curl localhost:5221/api/brain/context

# 如需了解特定 KR 进度
curl localhost:5221/api/brain/okr/current

# 如需查看活跃任务
curl "localhost:5221/api/brain/tasks?status=in_progress&limit=10"
```

**如何使用返回的上下文**：
- **OKR**：确认本次任务对应哪个 KR，当前进度是多少，写入 PRD 的 OKR 对齐章节
- **活跃任务**：避免与进行中任务重复，确认优先级与现有工作协调
- **最近 PR**：了解近期系统变更，避免冲突或重复
- **有效决策**：遵守已做出的架构/业务决策，不在 PRD 中推翻

**边界**：Step 0 只读业务上下文（OKR/任务/PR/决策），不读代码实现细节（代码细节留给 Proposer 处理）。

---

### Step 1: 读取任务描述

```bash
# TASK_ID 和 SPRINT_DIR 由 cecelia-run 通过 prompt 注入，直接使用：
# TASK_ID={TASK_ID}
# SPRINT_DIR={sprint_dir}（来自 task payload，注入到 prompt 上下文）
mkdir -p "$SPRINT_DIR"
```

---

### Step 2: 歧义自检（9 类扫描）

在撰写 PRD 前，对任务描述执行以下 9 类歧义扫描：

| # | 类别 | 检查内容 |
|---|------|---------|
| 1 | **功能范围** | 该做什么、不该做什么是否清晰？ |
| 2 | **数据模型** | 涉及哪些数据实体，字段结构是否已知？ |
| 3 | **UX 流程** | 用户操作路径是否明确，有无多种可能？ |
| 4 | **非功能需求** | 性能/安全/可用性要求是否已知？ |
| 5 | **集成点** | 依赖哪些外部系统/API，接口是否已定义？ |
| 6 | **边界情况** | 极端输入/失败场景是否需要特殊处理？ |
| 7 | **约束** | 技术栈/时间/资源限制是否影响方案选择？ |
| 8 | **术语** | 关键词语义是否明确，有无歧义？ |
| 9 | **完成信号** | 怎样算"完成"，验收标准是否可量化？ |

**处理规则**：
- 能从上下文推断的项 → 直接写入假设列表，格式：`[ASSUMPTION: {内容}]`
- 只有影响方向性决策的歧义才向用户提问（预期 0-1 个问题）
- 不影响方向的模糊点全部标注为 `[ASSUMPTION: ...]`，写入 PRD 假设列表

---

### Step 3: 写 sprint-prd.md

使用以下结构化模板：

```markdown
# Sprint PRD — {目标名称}

## OKR 对齐

- **KR 编号**: KR-{N}（{KR 描述}）
- **当前进度**: {X}%（来自 Brain API）
- **预期推进**: 完成后预计推进至 {Y}%（+{Z}pp）
- **备注**: {若对不上活跃 KR，在假设列表中标注 [ASSUMPTION: 本任务暂无对应活跃 KR]}

## 背景

{为什么做这件事，来自 Brain 上下文}

## 目标

{用一句话描述用户希望实现什么}

## User Stories

按优先级排列：

### US-001（高）: {用户故事标题}

作为 {角色}，我希望 {功能}，以便 {价值}。

**验收场景**:

- **场景 1**: {场景描述}
  - Given {前置条件}
  - When {触发动作}
  - Then {期望结果}

### US-002（中）: {用户故事标题}

作为 {角色}，我希望 {功能}，以便 {价值}。

**验收场景**:

- **场景 1**: {场景描述}
  - Given {前置条件}
  - When {触发动作}
  - Then {期望结果}

## 功能需求

### FR-001: {功能需求名称}

**描述**: {功能行为描述}  
**关联 US**: US-001  
**优先级**: 高

### FR-002: {功能需求名称}

**描述**: {功能行为描述}  
**关联 US**: US-002  
**优先级**: 中

## 成功标准

### SC-001: {可量化验收条件}

{具体度量标准或验证方式}

### SC-002: {可量化验收条件}

{具体度量标准或验证方式}

## 显式假设

以下内容无法从现有信息完全推断，已标注为假设：

- [ASSUMPTION: {假设内容 1}]
- [ASSUMPTION: {假设内容 2}]

## 边界情况

### 包含的边界情况

- **{场景}**: {处理方式}

### 排除的边界情况

- **{场景}**: {排除理由}

## 范围限定

**在范围内**:
- {功能 1}
- {功能 2}

**不在范围内**:
- {功能 X}（原因）

## 预期受影响文件

（由 Proposer 在代码探索后补全，Planner 先列出预估路径）

- `{预估文件路径 1}`：{一句话说明为何受影响}
- `{预估文件路径 2}`：{一句话说明为何受影响}
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
