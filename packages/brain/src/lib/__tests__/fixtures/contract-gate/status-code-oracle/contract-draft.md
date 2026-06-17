# Status-Code-Oracle Fixture — curl -w %{http_code} 状态码断言（盲区 B）

> 永久回归样本：取自生产 run c0e2546b（notion-mapping-fix 合同 cleanup 块）。
> `curl -s -o /dev/null -w "%{http_code}"` 刻意丢弃 body、只捕获 HTTP 状态码，后续
> `[ "$HTTP_CODE" = "200" ]` 即合法 oracle，jq 不适用 → 不应误报 weak-oracle/curl-no-jq。

## BEHAVIOR 条目

- [ ] [BEHAVIOR] 归档清理页面：状态码断言为 oracle（body 刻意丢弃）
  Test:
```bash
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "https://api.notion.com/v1/pages/$PAGE_ID" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{"archived": true}')
[ "$HTTP_CODE" = "200" ] && echo "  archived page $PAGE_ID" \
  || echo "  [WARN] 清理页面 $PAGE_ID 返回 HTTP $HTTP_CODE（可手动归档）"
```
