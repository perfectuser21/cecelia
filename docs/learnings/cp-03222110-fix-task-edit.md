# Learning: 修复任务路由编辑 — UPSERT + 全C类可编辑

**Branch**: cp-03222110-fix-task-edit
**Task**: 62dfe49a-874c-45b1-97f9-8fbac99393fb

### 根本原因

`updateConfig` 只做 `UPDATE WHERE task_type = $1`，若该 task_type 不在 DB 里返回 0 行 → null → API 404。
前端也做了额外检查 `DYNAMIC_TASK_TYPES.has(...)` 只允许5个任务类型触发编辑。
双重限制导致只有 5 个任务能编辑。

### 解决方案

1. Backend：`updateConfig` 改为 UPSERT（`INSERT ... ON CONFLICT DO UPDATE`），任意 task_type 均可保存
2. Frontend：所有 C类任务设 `editable: true`，`isEditable` 只看 `task.editable` 不检查 DB 是否存在
3. 保存按钮 disabled 条件去掉 `editLocation === currentLocation`（允许重复保存同一位置）

### 下次预防

- [ ] 配置类功能设计时，保存端点应默认使用 UPSERT，不要假设记录一定存在
- [ ] 前端「可编辑」判断应基于业务逻辑（任务类别），不基于 DB 是否有记录
- [ ] 新增可编辑任务类型时，只改静态数据里的 `editable: true`，不需要改判断逻辑
