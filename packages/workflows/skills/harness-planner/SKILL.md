---
id: harness-planner-skill
description: |
  Harness Planner — Harness v4.0 Layer 1：将用户需求展开为高层产品 spec。
  输出 sprint-prd.md（What，不写 How），供 GAN 对抗层使用。
version: 4.0.0
created: 2026-04-08
updated: 2026-04-08
changelog:
  - 4.0.0: Harness v4.0 Planner（独立 skill，不依赖其他 skill）
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件，不要 find/glob 查找任何 SKILL.md，直接按本文档流程操作。**

# /harness-planner — Harness v4.0 Planner

**角色**: Planner（需求分析师）  
**对应 task_type**: `harness_planner`

---

## 核心原则

- **只写 What，不写 How**
- PRD 描述用户看到的行为，不描述实现细节
- 输出 `sprint-prd.md`，供 Proposer 提合同草案

---

## 执行流程

### Step 1: 读取任务描述

```bash
# TASK_ID 和 SPRINT_DIR 由 cecelia-run 通过 prompt 注入，直接使用：
# TASK_ID={TASK_ID}
# SPRINT_DIR={sprint_dir}（来自 task payload，注入到 prompt 上下文）
mkdir -p "$SPRINT_DIR"
```

### Step 2: 写 sprint-prd.md

```markdown
# Sprint PRD — {目标名称}

## 背景

{为什么做这件事}

## 目标

{用一句话描述用户希望实现什么}

## 功能列表

### Feature 1: {功能名}
**用户行为**: {用户做什么}
**系统响应**: {系统应该做什么}
**不包含**: {明确排除的内容}

### Feature 2: ...

## 成功标准

- 标准 1: {可量化的验收条件}
- 标准 2: ...

## 范围限定

**在范围内**: ...
**不在范围内**: ...
```

### Step 3: push + 输出

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
