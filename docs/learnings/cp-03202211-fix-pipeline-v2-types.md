## [2026-03-20] Pipeline v2 task_type 注册 + worktree-manage MAX_WORKTREES 修复

### 根本原因

1. **worktree-manage.sh MAX_WORKTREES**: 变量硬编码为 `local MAX_WORKTREES=8`，无法通过环境变量覆盖。当外部脚本在 `set -u` 模式下引用 `$MAX_WORKTREES` 时会触发 unbound variable 错误。
2. **Pipeline v2 task_type**: 新增的 Gate 类型（spec_review, code_review_gate, prd_review, initiative_review, initiative_execute）在 task-router.js 中已注册，但 PostgreSQL 的 `tasks_task_type_check` CHECK CONSTRAINT 未更新，导致插入这些类型的任务时数据库报错。

### 下次预防

- [ ] 添加新 task_type 到 task-router.js 时，同步创建 migration 更新 CHECK CONSTRAINT
- [ ] shell 脚本中的常量如需支持外部覆盖，使用 `${VAR:-default}` 模式
- [ ] E2E 测试覆盖新 task_type 的 INSERT 操作验证
