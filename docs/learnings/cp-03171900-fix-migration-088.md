# Learning: 修复 088 migration ADD CONSTRAINT 不幂等

## 背景

023 migration 修复后，CI L3 smoke.test.js 仍然失败，原因变为 migration 088 的 `ADD CONSTRAINT` 报 `already exists`。

### 根本原因

PostgreSQL 的 `ALTER TABLE ... ADD CONSTRAINT` 不支持 `IF NOT EXISTS` 语法（不像 `CREATE INDEX IF NOT EXISTS`）。唯一的幂等实现方式是用 `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` 包裹。

CI PostgreSQL service 在多次测试运行间会保留状态，导致 migration 在同一 DB 上重复执行时报错。

### 解决方案

将 4 个裸 `ALTER TABLE ... ADD CONSTRAINT ...` 用 DO block 包裹：
```sql
DO $$ BEGIN
    ALTER TABLE ... ADD CONSTRAINT ... CHECK (...);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
```

### 下次预防

- [ ] 新 migration 中写 `ADD CONSTRAINT` 时，必须用 DO block 包裹
- [ ] `CREATE INDEX` → 用 `IF NOT EXISTS`
- [ ] `ADD CONSTRAINT` → 用 `DO $$ EXCEPTION WHEN duplicate_object THEN NULL; END $$`
- [ ] `CREATE TABLE` → 用 `IF NOT EXISTS`（已是惯例）
- [ ] migration 编写完成后，过一遍所有 DDL 检查幂等性
