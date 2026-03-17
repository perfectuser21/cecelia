# Learning: 修复 023 migration CREATE INDEX 不幂等

## 背景

CI L3 `coverage-baseline` job 在跑多次测试后，PostgreSQL service 中已存在 migration 023 创建的索引。重新启动 Brain server 时 migration 重复执行，报 `relation "idx_run_events_task_id" already exists` 并以 exit code 1 退出，导致 smoke.test.js 失败。

### 根本原因

`023_add_run_events_observability_v1.1.sql` 中所有 `CREATE INDEX` 语句缺少 `IF NOT EXISTS` 修饰符。`CREATE TABLE IF NOT EXISTS` 是幂等的，但同一个文件中的 `CREATE INDEX` 没有同等保护，导致 migration 在同一数据库中只能执行一次。

### 解决方案

将所有 `CREATE INDEX idx_*` 和 `CREATE UNIQUE INDEX idx_*` 改为带 `IF NOT EXISTS` 版本。PostgreSQL 9.5+ 支持 `CREATE INDEX IF NOT EXISTS`，不会影响功能，只是跳过已存在的索引。

共修改 16 条索引语句（run_events 表 13 条 + run_artifacts 表 3 条）。

### 下次预防

- [ ] 编写新 migration 时，所有 `CREATE INDEX` 语句必须加 `IF NOT EXISTS`
- [ ] 编写新 migration 时，检查所有 DDL 语句是否幂等（INDEX/TABLE/VIEW/FUNCTION 都有对应的 IF NOT EXISTS / OR REPLACE 语法）
- [ ] CI review migration 文件时，grep `CREATE INDEX` 确认都有 `IF NOT EXISTS`
- [ ] migration 的整体设计原则：任何 migration 在同一数据库上执行两次都不应该报错
