# Learning: OKR 业务代码迁移批次2 — 14个 SIMPLE 文件

**日期**: 2026-03-24
**分支**: cp-03240824-okr-migrate-batch2-pr5
**PR**: #1485

---

### 根本原因

旧系统将所有 OKR 层级（Vision/Objective/KR/Project）混存在 `goals` 和 `projects` 两张表中。
Migration 179 将其拆分为 `visions`/`objectives`/`key_results`/`okr_projects`/`okr_initiatives` 五张新表，
但业务代码仍引用旧表名，导致在新 OKR 结构下查询失败。

### 主要迁移规则

1. **`goals`(KR类型)** → `key_results`，状态需加 `'active'`（旧表无此状态）
2. **`goals`(Objective类型)** → `UNION ALL key_results/objectives`（混合层级查询）
3. **`projects`** → `okr_projects`/`okr_initiatives`；字段 `name` → `title`，无直接 `repo_path` 列需走 `metadata->>'repo_path'`
4. **`goals.domain`** → 需要额外 `LEFT JOIN areas ar ON ar.id = g.area_id` 再用 `ar.name`
5. **UUID 相同**：Migration 179 保留了所有 ID，外键关联无需变更

### 下次预防

- [ ] 新 OKR 迁移任务开始前，先 grep 确认哪些文件引用了旧表（避免遗漏）
- [ ] UNION ALL 查询中 `ORDER BY/LIMIT` 必须在最外层，不能在子查询中
- [ ] `area-scheduler.js` 类型的 `domain` 字段替换需同时加 `JOIN areas` 表，不能只替换字段名
- [ ] 测试 mock 中 `FROM goals` 的判断条件要随实现同步更新为 `FROM key_results`
- [ ] 并行 agent 执行同批次迁移时，需要明确每个 agent 负责的文件范围，避免重叠
