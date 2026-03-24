# Learning: OKR PR12 — DROP goals/projects 引发集成测试雪崩

**分支**: cp-03240317-55040d96-6393-4750-bb36-c00fd1
**日期**: 2026-03-24

---

### 根本原因

migration 185 执行 `DROP TABLE goals, projects, project_kr_links CASCADE` 后，测试数据库中旧表消失。
凡是直接 `INSERT INTO goals/projects/project_kr_links` 的集成测试全部崩溃（relation does not exist）。

受影响文件共 20 个，涉及 3 类问题：

1. **`INSERT INTO goals`** — 在测试 setup 中创建 KR，但 `goals` 已 DROP
2. **`INSERT INTO projects`** — 在测试 setup 中创建 project，但 `projects` 已 DROP
3. **`afterEach/afterAll`** 中 `DELETE FROM goals/projects` 未加 `.catch()`，导致整个 suite 崩溃

另有一个隐藏问题：migration 185 本身因 `goal_evaluations` 表中存在 1,359 条孤儿行（`goal_id` 在 `goals` 中存在但不在 `key_results` 中）导致 FK 约束迁移失败，需在 ADD CONSTRAINT 前先 DELETE 孤儿。

---

### 修复策略

| 旧写法 | 新写法 |
|--------|--------|
| `INSERT INTO goals (title, type, priority, status, progress)` | `INSERT INTO key_results (title, priority, status)` |
| `INSERT INTO projects (name, repo_path, status)` | `INSERT INTO okr_projects (title, status)` 或 `(title, status, metadata)` |
| `INSERT INTO project_kr_links (project_id, kr_id)` | `INSERT INTO okr_projects (title, status, kr_id)` 直接绑定 |
| `DELETE FROM goals WHERE ...` | `DELETE FROM key_results WHERE ...` |
| `DELETE FROM projects WHERE ...` | `DELETE FROM okr_projects WHERE ...` |
| `SELECT ... FROM goals WHERE type = 'area_okr'` | `SELECT ... FROM key_results WHERE status IN ('active', 'in_progress', ...)` |

特殊情况：
- `okr_projects` 无 `repo_path` 列，改用 `metadata->>'repo_path'`
- `key_results` 无 `domain` 列，在 helper 函数中作为 JS 属性附加
- `project_kr_links` 的唯一约束测试改为测试 `okr_projects.kr_id` FK 约束
- migration 057 测试中 `projects.execution_mode/current_phase/dod_content` 列检测改为 `it.skip`（旧表已 DROP）

---

### 下次预防

- [ ] **DROP 旧表前先全局 grep 测试文件**：`grep -rn "INSERT INTO <table>" packages/brain/src/__tests__/` 找到所有受影响文件，在同一个 PR 中一起修复
- [ ] **`afterAll/afterEach` 中的 DELETE 必须加 `.catch(() => {})`**，或使用 `IF EXISTS` 语法，防止 schema 变更导致整个 suite 崩溃
- [ ] **migration 中 ALTER TABLE ADD CONSTRAINT FK 前必须先检查孤儿行**：
  ```sql
  -- 检查孤儿
  SELECT COUNT(*) FROM child_table WHERE fk_col NOT IN (SELECT id FROM parent_table);
  -- 清理孤儿
  DELETE FROM child_table WHERE fk_col NOT IN (SELECT id FROM parent_table);
  ```
- [ ] **在 worktree 环境中运行测试前先确认 worktree 是真实 git worktree**：`git worktree list` 验证，否则文件编辑不会持久化
