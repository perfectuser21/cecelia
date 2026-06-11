# Clean Fixture — 真实断言，无作弊

> 永久回归样本：含真实 `jq -e` 值校验 + psql 带时间窗 + 内容断言，gate 应全过（exit 0）。

## BEHAVIOR 条目

- [ ] [BEHAVIOR] 发布成功且 DB 有新记录（带时间窗）
  Test: manual:bash -c 'curl -s "$API/posts/1" | jq -e ".status == \"sent\"" && psql "$DB" -c "SELECT 1 FROM posts WHERE id=1 AND created_at > NOW() - interval '\''5 minutes'\''" | grep -q 1'
