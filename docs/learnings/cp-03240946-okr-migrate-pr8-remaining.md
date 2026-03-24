# Learning: OKR 业务代码迁移 PR8 — 剩余17个文件

**Branch**: cp-03240946-okr-migrate-pr8-remaining
**Date**: 2026-03-24

---

### 根本原因

OKR 表结构迁移（Migration 177-183）建立了7张新表，但业务代码中17个文件仍直接查询旧 `goals`/`projects` 表。主要根因：

1. **命名混淆**：旧系统把 `goals.type='area_okr'` 叫做"KR"，实际上在新架构中这些是 `objectives`（目标），真正的 `key_results` 对应旧 `goals.type='area_kr'`

2. **层级关系变化**：旧 `projects.parent_id` 直接链接 initiative→scope→project。新架构用 `okr_initiatives.scope_id → okr_scopes.project_id` 的明确 FK 替代

3. **特殊路径保留**：`notion-full-sync.js` 使用 `notion_id` 列，该列只在旧 `goals`/`projects` 表存在，不适合迁移到新表（需要为新表专门添加 notion 同步列）

4. **objectives 无 progress 列**：Migration 182 只为 `key_results` 添加了 `progress` 列，`objectives` 没有，迁移时需用 `0 AS progress` 占位

---

### 下次预防

- [ ] **迁移前确认新表 schema**：检查 migration 文件确认每张新表有哪些列，避免查询不存在的列
- [ ] **area_okr = objectives**：`goals.type='area_okr'`（系统"KR"的旧称）→ `objectives`；`goals.type='area_kr'` → `key_results`
- [ ] **parent_id → scope_id/project_id**：`projects.parent_id` 关系在新架构用显式 FK 表达，initiative 不再有 `parent_id`
- [ ] **Notion 同步模块特殊处理**：notion 相关列只在旧表，该模块不能简单迁移，需添加注释说明原因
- [ ] **task.project_id = okr_initiatives.id**：任务与 initiative 的 UUID 相同，可直接用 `task.project_id` JOIN `okr_initiatives.id`
- [ ] **KR 进度更新路径**：initiative → scope → okr_project → project_kr_links → objectives（通过 4 跳关联）

---

### 迁移规则速查

| 旧查询 | 新查询 |
|--------|--------|
| `FROM goals WHERE type='area_okr'` | `FROM objectives` |
| `FROM goals WHERE type='area_kr'` | `FROM key_results` |
| `FROM goals WHERE type='vision'` | `FROM visions` |
| `FROM projects WHERE type='project'` | `FROM okr_projects` |
| `FROM projects WHERE type='scope'` | `FROM okr_scopes` |
| `FROM projects WHERE type='initiative'` | `FROM okr_initiatives` |
| `projects WHERE parent_id=$1 AND type='initiative'` | `okr_initiatives WHERE scope_id IN (SELECT id FROM okr_scopes WHERE project_id=$1)` |
| `UPDATE goals SET status=...` | `UPDATE objectives SET status=...` |
| `projects.name` | `okr_*.title` |
