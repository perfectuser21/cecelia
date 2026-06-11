# Capture-No-Assert Fixture — 裸 VAR=$(curl) 后无断言，curl-no-jq 应命中（不放水）

> 永久回归反例：捕获 curl 响应后 K 条逻辑语句内对 $RESP 无任何值断言（jq -e / grep -q / [ 比较 / case）
> → capture-then-assert 放行不成立，仍命中 weak-oracle/curl-no-jq，gate 应 FAIL（exit≠0）。

## BEHAVIOR 条目

- [ ] [BEHAVIOR] 取响应但从不校验字段（弱 oracle）
  Test: 见下方验收脚本

```bash
RESP=$(curl -sf "localhost:5221/api/health")
echo "request done"
```
