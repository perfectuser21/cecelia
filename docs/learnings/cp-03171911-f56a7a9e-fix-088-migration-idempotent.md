# Learning: migration ADD CONSTRAINT 幂等保护

## 根本原因

migration 088_progress_ledger.sql 中 4 个 `ADD CONSTRAINT` 语句缺少幂等保护。当 migration 重复执行时（CI 重跑、本地重置等），PostgreSQL 报 `constraint already exists` 错误导致 CI 失败。

## 修复方案

用 `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` 包裹每个 `ADD CONSTRAINT` 语句。

## 下次预防

- [ ] 所有 migration 中的 `ADD CONSTRAINT` 必须用 `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` 包裹
- [ ] 参考 migration 023 的 `CREATE INDEX IF NOT EXISTS` 模式：DDL 语句凡不支持 `IF NOT EXISTS` 的，都需要 DO/EXCEPTION 包裹
- [ ] Code review checklist 新增：migration 文件中是否有裸 `ALTER TABLE ... ADD CONSTRAINT`？
