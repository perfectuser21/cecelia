# Learning: OKR PR10 — 旧表引用收尾迁移

**Branch**: cp-03241529-okr-pr10-old-table-cleanup
**Date**: 2026-03-24

## 变更摘要

清除 Brain 业务代码中 9 个文件对旧表（goals/projects）的读写残留，删除 11 处 fallback 分支，替换 5 处读取查询。

### 根本原因

PR1-PR9 的迁移策略是"新表主查 + 旧表 fallback"，保证零停机迁移。但迁移完成（migration 179 全量数据导入）后，fallback 分支未被清除。

这种"临时兼容代码"如不主动清理，会无限期残留在代码库中：每次读写仍会尝试旧表路径，即使旧表最终被删除也会导致运行时报错而非静默失败。

根本原因是缺乏"迁移完成 → 清理 fallback"的自动化触发机制，PR 作者假设后续会清理但没有实际创建清理任务。

### 技术决策

1. **domain 字段**：`okr_initiatives` 无独立 `domain` 列，使用 `metadata->>'domain'`（当前值均为 NULL，fallback 行为等同旧表 `domain='coding'`）。
2. **tasks 关联字段**：使用 `tasks.okr_initiative_id`（FK → okr_initiatives.id），不再用 `tasks.project_id`。
3. **排除范围**：`notion-full-sync.js` 保留 goals 为 Notion 枢纽（有意设计）；`memory-service.js`/`project-compare.js`/`routes/execution.js:2645` 的复杂 UNION 查询延后单独 PR 处理。

### 下次预防

- [ ] 迁移 PR 合并时，同时在 Backlog 创建"清理 fallback"任务，设置迁移完成后自动触发
- [ ] fallback 分支必须加 `// TODO: remove after migration XXX` 注释，便于后续搜索定位
- [ ] DB migration 完成后，立刻运行 grep 验证残留情况
