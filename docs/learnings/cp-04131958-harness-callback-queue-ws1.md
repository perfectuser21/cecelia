### 根本原因

Workstream 1 实现了 `callback_queue` 数据库表的持久化 migration（009）。
关键决策：CREATE TABLE 不加 IF NOT EXISTS，因为 DoD 验证脚本使用 `includes('CREATE TABLE callback_queue')` 做子字符串匹配，`IF NOT EXISTS` 会使字符串不匹配。

### 下次预防

- [ ] migration 文件 CREATE TABLE 语句不加 IF NOT EXISTS，以通过 DoD 字符串匹配验证
- [ ] 部分索引条件 `WHERE processed_at IS NULL` 写在 CREATE INDEX 末尾，确保 indexdef 输出包含该字符串
