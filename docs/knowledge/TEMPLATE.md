---
version: 1.0.0
created: 2026-03-15
type: knowledge-page-template
---

# 知识页模板（所有页面统一格式）

每一个知识页对应系统中一个**功能单元**（有名字、有职责、会出错的东西）。
Codex 生成页面时严格按此模板填写，不能缺项。

---

## 文件命名规则

```
docs/knowledge/{模块}/{单元名}.md

例：
docs/knowledge/brain/tick-loop.md
docs/knowledge/engine/dev-step-0-worktree.md
docs/knowledge/workflows/skills/autumnrice.md
```

---

## 页面模板

```markdown
---
id: {module}-{unit-name}
title: {中文标题}
module: {brain | engine | workflows | ci | system}
status: draft | reviewed
source_files:
  - packages/brain/src/xxx.js
  - packages/engine/skills/dev/steps/00-xxx.md
generated: YYYY-MM-DD
---

# {中文标题}

> {一句话说明：这个东西是干什么的，对用户有什么意义}

---

## 做什么

{白话描述这个单元的职责，1-3段。不用技术名词，说人话。}

---

## 为什么需要它

{解释如果没有这个单元，会发生什么。让读者理解"存在的意义"。}

---

## 怎么工作（机制）

{说明内部工作机制。可以用步骤列表或流程图。
 白话为主，必要时用术语但立刻解释。}

### 子机制1（如果有）
...

### 子机制2（如果有）
...

---

## 完成标志 / 正常状态

{描述这个单元正常工作时，你能看到什么现象}

---

## 常见失败 & 解决方法

| 失败现象 | 原因 | 解决方法 |
|---------|------|---------|
| {白话描述症状} | {原因} | {怎么修复} |

---

## 和其他单元的关系

- **依赖**：{这个单元需要谁才能工作}
- **被依赖**：{谁需要这个单元}
- **触发**：{什么情况触发这个单元}
- **触发后**：{这个单元完成后，接下来发生什么}

---

## 真实案例 / 历史教训

{如果有真实事故或调试经历，简短记录。帮助读者理解为什么这么设计。}

---

## 技术细节（可选，给需要深入的人）

**主要文件**：{source_files}
**关键配置**：{重要的常量或环境变量}
**接口**：{对外暴露的API或函数签名}
```

---

## Codex 生成说明

1. 读 BACKLOG.yaml 找到 `status: todo` 的条目
2. 读对应的源代码文件
3. 按上面模板生成 `.md` 文件
4. 把 BACKLOG.yaml 里该条目的 status 改为 `done`
5. 每次处理 3-5 个条目
