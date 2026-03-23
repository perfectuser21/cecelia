# Learning: PR3 — 迁移剩余业务代码到新 OKR 表

**Branch**: cp-03230556-ac25ef1b-5714-4970-b682-803f73
**Date**: 2026-03-23

## 变更概述

将 `packages/brain/src/` 下所有非测试文件中对旧表（`goals`、`projects`、`project_kr_links`）的 SQL 引用全部迁移到新 OKR 表体系：
- `goals.type='vision'/'mission'` → `visions` / `objectives`
- `goals.type IN ('area_kr','kr','global_kr')` → `key_results`
- `projects.type='project'` → `okr_projects`
- `projects.type='scope'` → `okr_scopes`
- `projects.type='initiative'` → `okr_initiatives`
- `project_kr_links` → `okr_projects.kr_id` 直接 FK

涉及文件 40+ 个，涵盖核心调度、路由、分析、评估等所有模块。

### 根本原因

OKR 数据模型重构（PR1/PR2）将旧的单表多类型设计（`goals.type` 区分层级，`projects.type` 区分 scope/initiative）替换为规范化的专用表。

PR3 的任务是清理遗留的 SQL 引用，确保所有业务代码使用新表（`objectives`/`key_results`/`okr_projects`/`okr_scopes`/`okr_initiatives`）。

业务逻辑层（~40 个 src/*.js 文件）的迁移与 routes 层迁移并行开展，两者对相同 routes 文件的改动导致 merge conflict，需 rebase 后取 main 版本解决。

### 关键迁移模式

1. **UNION ALL 替代类型过滤**：旧的 `FROM goals WHERE type IN ('area_kr','kr')` → `SELECT ... FROM key_results`（直接查专用表，无需 type 过滤）

2. **metadata jsonb 列**：新表没有 `progress`、`priority`、`weight`、`description`、`repo_path` 等直接列，均存于 `metadata` jsonb：
   - `progress` → `COALESCE((metadata->>'progress')::int, 0)`
   - `priority` → `COALESCE(metadata->>'priority', 'P1')`
   - `repo_path` → `metadata->>'repo_path'`

3. **FK 链变化**：
   - `project_kr_links` → `okr_projects.kr_id`（直接 FK）
   - `projects.parent_id` → `okr_initiatives.scope_id`、`okr_scopes.project_id`
   - `goals.parent_id` → `key_results.objective_id`、`objectives.vision_id`

4. **tasks 表列名**：`tasks.project_id` → `tasks.okr_initiative_id`（PR1/PR2 已迁移）

5. **progress UPDATE**：`UPDATE goals SET progress=$1` → `UPDATE key_results SET metadata=COALESCE(metadata,'{}')::jsonb||jsonb_build_object('progress',$1::int)`

### 注意事项

- grep 的 DoD 验证会匹配注释行，需要同步更新含旧表名的注释
- `validate-okr-structure.js` 中的递归 CTE 需要重写递归锚点和连接条件
- `planner.js` 中有多处复杂 JOIN 需要分别处理
- notion-full-sync.js 的 UPDATE 不能用分号拼接两条语句（node-postgres 不支持），需要两次 await

## 下次预防

- [ ] 新建迁移 SQL 时同步更新 GREP-BLOCKLIST：在 migration 文件注释中标注哪些 JS 引用需要同步清理
- [ ] 大规模 SQL 迁移建议用 Python 批处理脚本而非手动逐文件编辑，降低遗漏风险
- [ ] 复杂递归 CTE（如 validate-okr-structure.js）在重写后需要专项测试覆盖
- [ ] metadata jsonb 字段在 ORDER BY 中需要强制类型转换，否则排序结果不稳定
