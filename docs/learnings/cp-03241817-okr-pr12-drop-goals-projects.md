# Learning: OKR PR12 — 清除旧表最终依赖 + DROP goals/projects

**分支**: cp-03241817-okr-pr12-drop-goals-projects
**日期**: 2026-03-24
**任务类型**: OKR 旧表清理

## 变更摘要

清除 `goals`、`projects`、`project_kr_links` 三张旧表在生产代码中的所有引用，并新建 migration 185 执行 DROP。

涉及 17 个生产文件 + 6 个测试文件，共修改/删除约 35 处旧表引用。

### 根本原因

**旧表（goals/projects）UUID 与新表（key_results/okr_projects）UUID 相同**，因此替换策略大多是直接替换表名，无需数据迁移。

`project_kr_links` 是旧桥接表，新表 `okr_projects` 直接含 `kr_id` 字段，替换规则统一：
- `FROM project_kr_links WHERE kr_id = $1` → `FROM okr_projects WHERE kr_id = $1`（SELECT id AS project_id）
- `FROM project_kr_links WHERE project_id = $1` → `FROM okr_projects WHERE id = $1`（SELECT kr_id）
- `JOIN project_kr_links pkl ON pkl.project_id = op.id` → 直接用 `op.kr_id`（okr_projects 已含）

### 关键发现

1. **analytics.js 的 goals.domain 字段**：`goals` 有 `domain` 字段，`key_results` 没有，需要额外 JOIN `areas` 表（`key_results → areas → domain`）
2. **initiative-closer.js 的 objectives.priority 排序**：旧代码 `LEFT JOIN objectives obj ON obj.id = pkl.kr_id` 是错误逻辑（kr_id 指向 key_results，非 objectives），已改为直接按 `oi.created_at ASC` 排序
3. **executor.js 的 prompt 字符串**：有两处 `project_kr_links` 在 Agent 提示词模板字符串中（非 SQL），需要同步更新

### 下次预防

- [ ] 替换旧表引用时，先全量扫描 `project_kr_links` 在注释和字符串中的出现，避免遗漏非 SQL 引用
- [ ] `goals.domain` 这类只在旧表存在的字段，替换前先确认新表是否有等价字段（或通过 JOIN 获取）
- [ ] 集成测试（planner.test.js 等）中 `beforeAll` 检查的表名，需要在 migration DROP 后同步更新

## 测试结果

- 改动文件相关测试：8 个文件，192 个测试全部通过
- planner 集成测试：19 个测试通过（已更新为使用 okr_projects 新表）
- JS 语法检查：15 个文件全部通过
