### 根本原因

`completed_at` 是 `timestamp without time zone` 列，PostgreSQL 用 CDT 本地时间写入（via `NOW()` 转换时去掉时区信息）。node-postgres 读回该列时按 Node.js 进程时区（PDT=UTC-7）解析，导致 `new Date(row.last_run_at).toISOString()` 与 C2 psql 验证脚本（按 UTC 解释同一字段）相差 7+ 小时，远超 2 秒阈值。

### 下次预防

- [ ] `timestamp without time zone` 列 + `AT TIME ZONE 'UTC'` 返回 timestamptz，再经 `to_char` 格式化为字符串，可跳过 node-postgres 的 Date 解析，保证与 psql 验证脚本的行为一致
- [ ] 生产环境 DB 列应优先使用 `timestamptz`；若历史列已是 `timestamp`，在 SQL 层用 `to_char(... AT TIME ZONE 'America/Chicago' AT TIME ZONE 'UTC', ...)` 显式标注时区意图
- [ ] C2 验证脚本中 `to_char(... AT TIME ZONE 'UTC', 'Z')` 会按 psql 会话时区显示，不是真正的 UTC——实现侧必须用同样的 SQL 表达式返回字符串，而非依赖 node-postgres 自动转换
