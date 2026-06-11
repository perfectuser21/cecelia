# DB-No-Window Fixture — 声明 DB 写入但 SELECT 无时间窗

> 永久回归样本：psql 计数无 `created_at > NOW() - interval`，gate 应命中 domain/db-no-time-window。

## BEHAVIOR 条目

- [ ] [BEHAVIOR] 写库后计数（缺时间窗，旧记录会误判通过）
  Test: manual:bash -c 'psql "$DB" -c "SELECT count(*) FROM posts WHERE status = '\''sent'\''" | grep -q 1'
