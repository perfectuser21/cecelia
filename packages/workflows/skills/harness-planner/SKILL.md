---
id: harness-planner-skill
description: |
  Harness Planner — Harness v5.0 Layer 1：将用户需求展开为高层产品 spec。
  输出 sprint-prd.md（What，不写 How），含 OKR 对齐、歧义自检、结构化 8 章节模板，供 GAN 对抗层使用。
version: 5.0.0
created: 2026-04-08
updated: 2026-04-11
changelog:
  - 5.0.0: Step 0 自动采集 Brain 上下文（OKR/任务/PR/决策）；PRD 模板 8 章节结构化；9 类歧义自检 + ASSUMPTION 标记；OKR 对齐章节（KR + 进度 + 推进 + fallback 假设）
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

### Step 0: 自动采集 Brain 上下文（写 PRD 前必须执行）

在写 PRD 之前，调用 Brain API 采集当前系统状态，无需用户提供额外信息：

```bash
curl localhost:5221/api/brain/context
```

从返回结果中提取四类信息：
- **OKR 进度**：当前 Objective、KR 编号和完成度
- **活跃任务**：进行中的任务列表，避免重复开发
- **最近 PR**：最近合并记录，了解系统最新状态
- **有效决策**：已做出的架构/产品决策，避免与现有决策矛盾

同时读取与任务相关的代码文件：

```bash
# 列出可能相关的目录，确认文件存在
ls packages/workflows/skills/ 2>/dev/null | head -20
ls packages/brain/src/ 2>/dev/null | head -10
```

**目的**：确认文件路径存在、了解当前实现，避免 Proposer 写出引用不存在路径的验证命令。

---

### Step 1: 歧义自检（写 PRD 前先扫描）

对任务描述执行 9 类歧义自检，无法推断的项标记 `[ASSUMPTION: ...]` 并写入假设列表：

| # | 类别 | 检查内容 |
|---|------|----------|
| 1 | 功能范围 | 功能边界是否清晰？哪些包含哪些不包含？ |
| 2 | 数据模型 | 涉及哪些数据实体？字段、格式、来源是否明确？ |
| 3 | UX 流程 | 用户操作路径是否明确？错误状态如何处理？ |
| 4 | 非功能需求 | 性能、安全、可用性有无隐含要求？ |
| 5 | 集成点 | 需要调用哪些外部 API/服务？依赖方是否就绪？ |
| 6 | 边界情况 | 极值、空值、并发、异常场景如何处理？ |
| 7 | 约束 | 技术栈、版本、时间、资源有无限制？ |
| 8 | 术语 | 领域词汇含义是否在团队内一致？ |
| 9 | 完成信号 | 如何判断该功能已完成？验收条件是什么？ |

**处理规则**：
- 可从上下文推断的歧义 → 直接写进 PRD，不打断流程
- 无法推断的项 → 标记 `[ASSUMPTION: 我假设 XXX，因为 YYY]` 写入假设列表
- 仅影响方向性决策的歧义才向用户提问（预期 0-1 个）

---

### Step 2: 读取任务描述

```bash
# TASK_ID 和 SPRINT_DIR 由 Brain 通过 prompt 注入，直接使用：
# TASK_ID={TASK_ID}
# SPRINT_DIR={sprint_dir}
mkdir -p "$SPRINT_DIR"
```

---

### Step 3: 写 sprint-prd.md（使用结构化 8 章节模板）

输出文件：`$SPRINT_DIR/sprint-prd.md`

模板如下：

```markdown
# Sprint PRD — {目标名称}

## OKR 对齐

- KR: {对应 KR 编号，如 KR-001}
- KR 当前进度: {从 Brain context 读取的当前完成度，如 30%}
- 本次推进预期: {本任务预计推进量，如 +10%}

> **fallback**：如果任务与活跃 KR 对不上，在假设列表中标注：
> [ASSUMPTION: 本任务未直接对应活跃 KR，假设属于技术基础设施投入，不直接推进 KR 进度]

## 背景

{为什么做这件事，来自 Brain context 的 OKR 背景和当前痛点}

## 目标

{用一句话描述用户希望实现什么}

## User Stories

以 Given-When-Then 格式定义验收场景（按优先级排序）：

**P1（必须）**
- Story 1: Given {前置条件}，When {用户操作}，Then {系统行为}

**P2（重要）**
- Story 2: Given {前置条件}，When {用户操作}，Then {系统行为}

**P3（可选）**
- Story 3: Given {前置条件}，When {用户操作}，Then {系统行为}

## 功能需求

- FR-001: {功能需求 1 描述}
- FR-002: {功能需求 2 描述}
- FR-003: {功能需求 3 描述}

## 成功标准

- SC-001: {可量化的验收条件 1}
- SC-002: {可量化的验收条件 2}

## 显式假设

无法从上下文推断的项，标记如下并汇总到假设列表：

- [ASSUMPTION: {假设内容 1}]
- [ASSUMPTION: {假设内容 2}]

> 假设列表在此处汇总所有无法推断的假设，Proposer 在写合同时需关注并在必要时向用户确认。

## 边界情况

| 场景 | 处理方式 |
|------|---------|
| {极值/空值场景} | {处理策略} |
| {并发场景} | {处理策略} |
| {异常场景} | {处理策略} |

## 范围

**在范围内**:
- {功能 1}
- {功能 2}

**不在范围内**:
- {排除项 1}
- {排除项 2}

## 预期受影响文件

（由 Planner 在 Step 0 读取代码后填写，列出实际存在的文件路径）

- `{实际文件路径 1}`：{一句话说明为何受影响}
- `{实际文件路径 2}`：{一句话说明为何受影响}
```

---

### Step 4: Push + 输出

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
