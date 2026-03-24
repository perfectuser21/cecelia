---
branch: cp-03241720-okr-pr11-cleanup-old-tables
date: 2026-03-24
task: OKR PR11 — 清理旧表残留收尾
---

# Learning: OKR 旧表引用清理

## 变更摘要

删除 Brain 源码中最后 4 处旧表（goals/projects）实际读写残留：
- `actions.js`：删除 updateGoal fallback `UPDATE goals SET`，改为返回 `{ success: false, error: 'Goal not found' }`
- `planner.js`：删除先查旧 `projects` 表的逻辑，改为直接 UNION ALL 查三新表（okr_projects/okr_scopes/okr_initiatives），repo_path 从 `metadata->>'repo_path'` 读取
- `services/memory-service.js`：getDetail 改为查新 OKR 表 UNION ALL
- `project-compare.js`：两处 `FROM projects` 迁移至新表 UNION ALL，okr_scopes/okr_initiatives 无 kr_id 字段需用 `NULL::uuid AS kr_id` 填充

### 根本原因

Migration 181/182 在旧 `projects` 表上设置了 `AFTER INSERT/UPDATE trigger`（`sync_project_to_okr_tables`），该 trigger 只在 `NEW.type = 'project'` 时才向 `okr_projects` 同步数据。测试用例之前没有设置 `type='project'`，导致 trigger 不执行，okr_projects 中没有数据，planner 新代码抛出 'Project not found'。

### 下次预防

- [ ] 测试用例插入 projects 表数据时，若依赖 trigger 同步到新表，必须设置 `type='project'/'scope'/'initiative'`
- [ ] UNION ALL 查询跨表时，注意列对齐：okr_scopes/okr_initiatives 无 kr_id，需写 `NULL::uuid AS kr_id`
- [ ] code_review_gate 有效发现了 project-compare.js 中的 UNION ALL 列不一致问题（kr_id 缺失），blocker 在代码合并前修复
- [ ] 清理临时 `console.log('[xxx-debug]')` 行应在 Stage 2 完成前处理，不要留到 Stage 3
