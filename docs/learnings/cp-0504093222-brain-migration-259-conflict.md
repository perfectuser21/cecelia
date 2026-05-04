## Migration 259 冲突修复（2026-05-04）

branch: cp-0504093222-brain-migration-259-conflict
pr: #2743
task-id: c8638840-0989-41c0-a502-ecea32c4e49b

### 根本原因

`migrate.js` 按文件名字母序排序，取 `file.split('_')[0]` 作为版本号写入 `schema_version` 表。两个文件同号 `259`：

- `259_account_usage_auth_fail_count.sql`（字母序靠前）→ 先执行，版本 `259` 写入 DB
- `259_license_system.sql`（字母序靠后）→ 版本 `259` 已存在，被幂等跳过

结果：`licenses` 和 `license_machines` 表从未被创建。

### 下次预防

- [ ] 创建新 migration 文件时，**必须先确认无同号文件**：`ls packages/brain/migrations/ | cut -d_ -f1 | sort | uniq -d` — 有输出则存在冲突
- [ ] PR review 时检查新 migration 编号是否与现有文件重复（可加 CI lint）
- [ ] 每次 EXPECTED_SCHEMA_VERSION 更新时，确认对应编号的 migration 文件存在且唯一
- [ ] migration 文件注释内的版本号（`-- Migration N:`）必须与文件名前缀一致
