# Learning: T6 两轴衔接——JSONB 可空列 merge 的 NULL 吞写坑 + UUID 列 ANY 的脏数据 500

### 根本原因
1. objectives/key_results 的 metadata 列是可空无 DEFAULT 的 jsonb，照抄 custom_props 的
   `col || $n::jsonb` 写法在 NULL 行上得 NULL，写入被静默吞掉——SQL 语义坑而非代码 bug。
2. `uuid_col = ANY($1)` 收到含格式非法字符串的数组时 Postgres 直接抛
   invalid input syntax for type uuid，整个请求 500——对"暴露坏引用"为本职的对账端点，
   脏数据应分流进 missing 列表而非炸掉视图。

### 下次预防
- [ ] 对可空 jsonb 列做 merge 一律 `COALESCE(col, '{}'::jsonb) || $n::jsonb`（kr-verifier/okr-tick 已有惯例）
- [ ] 同一列存在 merge 与整体覆盖两种 PATCH 路径时，在端点注释写明互斥使用规则
- [ ] JSONB 里存的 id 数组进 uuid 列查询前先正则分流，非法值走业务兜底不进 SQL
