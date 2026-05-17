---
id: instruction-book-readme
version: 1.0.0
created: 2026-03-10
updated: 2026-03-10
authority: USER_FACING
changelog:
  - 1.0.0: 初始版本，建立 instruction book 体系
---

# Cecelia Instruction Book

> 给使用者看的操作说明。解释系统有什么能力、怎么用、什么时候触发。

---

## 文档四层体系

```
docs/
  current/            ← 系统事实（source of truth）
  gaps/               ← 审计缺口
  instruction-book/   ← 用户操作说明（你在这里）
  runbooks/           ← 运维操作手册（待建）
```

| 层 | 受众 | 内容 |
|----|------|------|
| `current/` | 开发者、AI agent | 系统架构事实，只写代码里真实存在的 |
| `gaps/` | 开发者 | 缺口审计、技术债 |
| `instruction-book/` | **使用者** | 系统能做什么、怎么用 |
| `runbooks/` | 运维 | 操作步骤、故障处理 |

---

## 目录结构

```
instruction-book/
  README.md           ← 本文件
  skills/             ← 每个 /skill 的说明
    dev.md
    arch-review.md
    brain-register.md
    ...
  features/           ← 系统特性/功能的说明
    recurring-tasks.md
    ...
```

---

## Skills vs Features

- **skills/**：`/dev`、`/arch-review` 等可直接调用的命令
- **features/**：系统自动运行的能力（定时任务、事件触发等）

---

## 维护规则

**每次 `/dev` 新增用户可见功能时，自动追加或更新对应 entry。**

- 新增 skill → 在 `skills/` 创建 `<skill-name>.md`
- 新增 feature → 在 `features/` 创建 `<feature-name>.md`
- 更新已有功能 → 更新对应文件的版本号和内容

### Entry 标准格式

```markdown
## What it is
（一句话描述）

## Trigger
（什么时候会触发 / 如何调用）

## How to use
（具体用法，命令示例）

## Output
（会产出什么）

## Added in
PR #xxx
```
