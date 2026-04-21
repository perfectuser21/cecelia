# Evaluation Report — Round 1

**Sprint**: run-20260407-2353
**PR**: #1998
**Evaluator Round**: R1
**Verdict**: FAIL

---

## Feature 1: 按 sprint_dir 精确过滤

**状态**: FAIL

**问题**: `tasks` 表缺少 `sprint_dir` 列。

验证结果：
- `\d tasks` 无 `sprint_dir` 列
- `SELECT * FROM tasks WHERE sprint_dir = '...'` → 报错 `column "sprint_dir" does not exist`
- 带 `sprint_dir` 参数的 API 调用返回 HTTP 500

**必须修复**: 添加 DB migration：
```sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sprint_dir text;
```

Migration 文件命名规范：`packages/brain/migrations/221_tasks_sprint_dir.sql`

---

## Feature 2: 不传 sprint_dir 时零破坏

**状态**: 未验证（依赖 Feature 1 修复）

---

## Feature 3: 返回完整任务字段

**状态**: 未验证（依赖 Feature 1 修复）

---

## 修复要求

1. 新增 `packages/brain/migrations/221_tasks_sprint_dir.sql`：
   ```sql
   ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sprint_dir text;
   CREATE INDEX IF NOT EXISTS idx_tasks_sprint_dir ON tasks (sprint_dir);
   INSERT INTO schema_version (version, description, applied_at)
   VALUES ('221', 'tasks 表新增 sprint_dir 列用于 Harness sprint 过滤', NOW())
   ON CONFLICT (version) DO NOTHING;
   ```

2. 推送到 PR #1998 分支（`cp-04070924-7ba4eca1-3dd9-45ef-8787-60b507`），无需新开 PR

---

## 总结

路由代码（status.js）修改正确，只缺 DB 层支撑列。添加 migration 后应可通过全部 Feature 验收。
