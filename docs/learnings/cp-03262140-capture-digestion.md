# Learning: feat(capture) — Capture Digestion 基础设施

**分支**: cp-03262140-capture-digestion
**日期**: 2026-03-26

## 完成了什么

1. 建立 `capture_atoms` 表（migration 199）— AI 拆解后的原子事件存储
2. 建立 `life_events` 表 — 生活事件（第 6 条路由线），避免与已有的 Web 分析 `events` 表冲突
3. 完整 CRUD API `/api/capture-atoms`（含 confirm/dismiss 操作）和 `/api/life-events`
4. 更新 EXPECTED_SCHEMA_VERSION 198→199

### 根本原因

数据库中已有 `events` 表用于 Web 分析（session tracking/page views），结构完全不同于生活事件需要的 schema。
直接用 `events` 表名会导致 `CREATE TABLE IF NOT EXISTS` 跳过建表，而后续 CREATE INDEX 引用不存在的列（date/area_id）失败。
这是因为同名异构表的存在性检查通过但结构不匹配——IF NOT EXISTS 只检查表名，不检查 schema 兼容性。
解决方案是将生活事件表命名为 `life_events`，API 路径为 `/api/life-events`，彻底避免命名冲突。

### 下次预防

- [ ] 建新表前先用 `\d <tablename>` 检查是否已存在同名表
- [ ] migration 文件中 CREATE INDEX 加 `IF NOT EXISTS` 防止重复创建失败
- [ ] Brain 测试中 EXPECTED_SCHEMA_VERSION 硬编码需同步更新（3个文件）
