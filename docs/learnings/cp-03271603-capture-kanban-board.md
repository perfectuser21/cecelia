# Learning: GTDInbox Kanban Board + conversation-digest 写双表

**分支**: cp-03271603-capture-kanban-board
**日期**: 2026-03-27

## 背景

将 GTDInbox 从筛选列表改为 Kanban Board，同时让 conversation-digest 在写完 conversation_captures 后同步写入 captures 表。

## 遇到的问题

### 根本原因

1. **Cortex 返回字段名不一致**：代码中使用了 `analysis.key_insights`，但 Cortex 实际返回字段是 `analysis.ideas`。没有 DB schema 约束，字段名靠 Prompt 定义，容易漂移。

2. **Tailwind CSS 类 `columns` 无效**：`columns` 不是 Tailwind 的实际类名，应为 `flex flex-row`。IDE 没有 Tailwind 类名校验，只靠肉眼检查容易遗漏。

3. **branch-protect.sh 需要多个文件**：改 packages/ 代码需要 per-branch `.prd-` + `.dod-` 文件和 `tasks_created: true`，仅靠 Task Card 不够。

## 下次预防

- [ ] 使用 Cortex 返回字段前，检查 analyzeWithCortex 的 prompt 确认实际字段名
- [ ] Tailwind 布局类用 `flex flex-row` 或 `grid grid-cols-N` 而非 `columns`
- [ ] 改 packages/ 代码时提前创建 `.prd-<branch>.md`、`.dod-<branch>.md` 和写入 `tasks_created: true`，避免 branch-protect 多次阻断
