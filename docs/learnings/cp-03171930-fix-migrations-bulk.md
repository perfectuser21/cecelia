# Learning: 批量修复 migration 013 和 112 不幂等

## 背景

连续修复 023、088 后，CI 每次仍失败在下一个不幂等的 migration。问题是系统性的：CI PostgreSQL service 在 runs 之间保留状态，migration 系统不会 re-apply 已成功的 migration，但对失败过的 migration 会重试，而重试时 DDL 报 already exists。

### 根本原因

**Migration 013**: `CREATE INDEX` 无 `IF NOT EXISTS`（早期编写时未考虑幂等性）

**Migration 112**: `ADD CONSTRAINT ... UNIQUE` 前无 `DROP CONSTRAINT IF EXISTS`。其他多数 migration 已正确使用 DROP IF EXISTS → ADD 模式，但 112 漏掉了。

### 解决方案

- **CREATE INDEX** → 加 `IF NOT EXISTS`
- **ADD CONSTRAINT** → 前面加 `ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...`（比 DO EXCEPTION 块更简洁）

### 下次预防

- [ ] 写新 migration 时，所有 DDL 必须幂等：
  - `CREATE TABLE` → `IF NOT EXISTS`
  - `CREATE INDEX` → `IF NOT EXISTS`
  - `ADD CONSTRAINT` → 前置 `DROP CONSTRAINT IF EXISTS`
- [ ] 在 CI 报错时，先看具体 FAIL 的 migration 类型，批量修而非单个修
- [ ] 考虑在 migration runner 中加检测：运行前扫描 SQL 中是否有不幂等模式
