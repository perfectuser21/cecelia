# PRD - <功能名>

> Product Requirements Document - 功能需求文档
>
> 此模板用于 Claude Code / Claude Desktop 与人类对齐需求
> N8N 可解析 `## Checkpoints` 部分自动调度 Cecilia 执行

---

## 元信息

| 字段 | 值 |
|------|-----|
| 项目 | `<项目名>` |
| 功能分支 | `feature/<功能名>` |
| 创建时间 | `YYYY-MM-DD HH:MM` |
| 状态 | `draft` / `approved` / `in_progress` / `done` |

---

## 背景

<!-- 为什么要做这个功能？解决什么问题？ -->

## 目标

<!-- 这个功能要达成什么？可量化的目标 -->

## 非目标

<!-- 明确不做什么，避免范围蔓延 -->

---

## 功能描述

<!-- 详细描述功能的行为、输入输出、边界条件 -->

### 用户场景

<!-- 用户如何使用这个功能？ -->

### 技术方案

<!-- 简要的技术实现思路 -->

---

## Checkpoints

> **N8N 解析区域** - 每个 checkpoint 对应一个 cp-* 分支
>
> 格式：`- [ ] CP-<序号>: <名称> | <类型> | <依赖>`

- [ ] CP-001: <checkpoint 名称> | code | none
- [ ] CP-002: <checkpoint 名称> | code | CP-001
- [ ] CP-003: <checkpoint 名称> | test | CP-002

### Checkpoint 详情

#### CP-001: <名称>

**类型**: `code` / `test` / `config` / `docs`
**依赖**: `none` / `CP-XXX`
**预计工作量**: `small` / `medium` / `large`

**任务描述**:
<!-- 这个 checkpoint 具体要做什么 -->

**完成标准**:
- [ ] 标准 1
- [ ] 标准 2

**验证命令**:
```bash
# 如何验证这个 checkpoint 完成
```

---

#### CP-002: <名称>

<!-- 同上格式 -->

---

## 验收标准

<!-- 整体功能的验收标准，引用 DoD -->

参考: [DoD 模板](./DOD-TEMPLATE.md)

---

## 风险与依赖

| 风险/依赖 | 影响 | 缓解措施 |
|----------|------|---------|
| | | |

---

## 附录

<!-- 参考资料、设计图、API 文档链接等 -->
